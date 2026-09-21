/****************************************************************************
 * SensorsWaveBridge.ets
 *
 * HarmonyOS Next (OpenHarmony) 端设备信息桥接。
 *
 * 集成步骤：
 *   1. 把本文件 cp 到 <entry>/src/main/ets/cocos/
 *   2. 在 <entry>/src/main/ets/workers/cocos_worker.ets 顶部加 import：
 *        import { injectSensorsWaveAppInfo, setSensorsWaveFilesDir } from '../cocos/SensorsWaveBridge';
 *   3. 在 cocos_worker.ets 里 uiPort.on("onXCLoad", () => { ... }) 回调内、
 *      renderContext.nativeEngineInit() 之后调用：
 *        injectSensorsWaveAppInfo(cocos.evalString);
 *      ⚠️ 必须传 cocos.evalString（bridge 不直接 import cocos，cocos/ 子目录下
 *        import 行为会让 bridge 模块加载失败），需要 worker 把 evalString 引用透传
 *      ⚠️ 必须在 nativeEngineInit 之后调，否则 SIGSEGV
 *   4. 沙箱路径转发（崩溃记录 / deviceId 落盘依赖它）：
 *      - 主线程 <entry>/src/main/ets/pages/index.ets 的 XComponent onLoad 回调里：
 *          this.workPort.postMessage("swFilesDir", getContext(this).filesDir);
 *      - worker 侧 cocos_worker.ets 顶层：
 *          uiPort.on("swFilesDir", (dir: string) => { setSensorsWaveFilesDir(dir); });
 *      ⚠️ classic worker 里 getContext() 会抛错（真机实证），preferences 不可用；
 *        bridge 改用 @ohos.file.fs + 主线程转发的 filesDir 落盘（无 Context 架构适配）
 *   5. 注册 JS→ArkTS 通道 glue（cocos_worker.ets 顶层，import 之后任意位置）：
 *        cocos.getContext(ContextType.ENGINE_UTILS).registerFunction(
 *          'executeMethodSync',
 *          (callFunc: (p: string) => string, paramStr: string): string => callFunc(paramStr));
 *      ⚠️ registerFunction 只在 getContext(ENGINE_UTILS) 返回对象上（引擎
 *        NapiHelper.cpp case ENGINE_UTILS），libcocos 模块顶层没有
 *      游戏 JS 侧 new JavaScriptArkTsBridge().callStaticMethod(模块路径, 方法名,
 *      参数, true) 依赖这个注册（Cocos 3.8+ OHOS 引擎内置的 JS→ArkTS 通道，
 *      引擎源码 bindings/manual/JavaScriptArkTsBridge.cpp，详见 onJsCommand 注释）
 *   6. 业务方在 init() 之后用 sensorswave.registerCommonProperties({ $app_name: 'xxx' })
 *      设置 $app_name（bridge 拿不到 appInfo.label，详见下文）
 *   7. （可选，仅调试）fatal 通道验证：游戏 JS 调
 *        new JavaScriptArkTsBridge().callStaticMethod(
 *          'entry/src/main/ets/cocos/SensorsWaveBridge', 'onJsCommand',
 *          '{"cmd":"raiseTestCrash"}', true)
 *      worker 经 evalString 调 jsb.swRaiseTestNativeCrash()（native abort，
 *      CPP_CRASH）→ 下次启动补报（见 onJsCommand / raiseTestCrash 注释；
 *      ⚠️ 未捕获 ArkTS 异常在 classic worker 里不杀进程，不能用作崩溃源）
 *
 * 启动后会在 JS 引擎 globalThis 上注入：
 *   - globalThis.__sensorswave_app_info__：{ appId, appName, appVersion, region,
 *     model, brand, manufacturer, deviceId }
 *   - globalThis.__sensorswave_network_type__：'LAN' | 'WWAN' | 'NONE'
 *   - globalThis.__sensorswave_pending_crashes__：上次崩溃记录数组（fatal 补报数据源）
 *
 * ⚠️ appName 永远为空字符串：Stage 模型下 appInfo.label 是 "$string:app_name"
 *   资源引用，解析需要 UIAbilityContext（cocos worker 拿不到，架构限制）。
 *   业务方用 sensorswave.registerCommonProperties({ $app_name: 'xxx' }) 覆盖即可。
 ****************************************************************************/

import bundleManager from '@ohos.bundle.bundleManager';
import deviceInfo from '@ohos.deviceInfo';
import i18n from '@ohos.i18n';
import connection from '@ohos.net.connection';
import fs from '@ohos.file.fs';
import util from '@ohos.util';
import { hiAppEvent } from '@kit.PerformanceAnalysisKit';
import hilog from '@ohos.hilog';

// 不在本文件 import libcocos.so：cocos napi 模块在本文件所在的
// `entry/.../ets/cocos/` 子目录中 import 行为跟 cocos_worker.ets 父模块不一样，
// 会导致整个 bridge 模块加载失败。bridge 不直接调 cocos.evalString，
// 由 cocos_worker.ets 把 evalString 函数引用通过 injectSensorsWaveAppInfo(evalJs) 传进来。

const TAG = 'SensorsWaveBridge';
const DOMAIN = 0xA001;
// 持久化 store 文件名（相对沙箱 filesDir；内容为 Record<string,string> 的 JSON）
const STORE_FILE_NAME = 'sensorswave_store.json';
const KEY_DEVICE_ID = '__sensorswave_device_id__';
const APP_INFO_KEY = '__sensorswave_app_info__';
const NET_TYPE_KEY = '__sensorswave_network_type__';

// ---- Crash Capture（$Exception fatal 补报数据源，与 iOS/Android 三端统一约定）----
// 采集源：hiAppEvent watcher 订阅 domain.OS 的 APP_CRASH / APP_FREEZE（参照 harmony-sdk）。
// 未捕获异常保持系统默认行为——进程崩溃退出，系统 faultlogger 采集故障，下次启动
// watcher 收到补报事件（携带故障原始时刻），落盘文件 store 后注入 JS 补报。
// JS global key 与 store 存储 key（水位线机制：原生永不删除已注入记录）
const PENDING_CRASHES_KEY = '__sensorswave_pending_crashes__';
const KEY_PENDING_CRASHES = '__sensorswave_pending_crashes_pref__';
const MAX_CRASH_RECORDS = 10;
const CRASH_EXPIRY_MS = 7 * 24 * 3600 * 1000;
// watcher 名系统约束：仅小写字母 / 数字 / 下划线
const CRASH_WATCHER_NAME = 'sw_exception_watcher';
// 补报轮询：hiAppEvent 故障事件异步到达（晚于 boot 的一次性注入），worker 线程
// 每轮检测版本号变化后重注入；2s × 30 轮 ≈ 60s 窗口（补报通常在注册后数秒内到达）
const CRASH_POLL_INTERVAL_MS = 2000;
const CRASH_POLL_MAX_ROUNDS = 30;

// evalJs 是 cocos_worker.ets 在 uiPort.on("onXCLoad") 回调里传进来的 cocos.evalString
// 引用。必须 module-level（不是 class 成员），让 setTimeout / network 回调里也能拿到。
let evalJsFn: ((code: string) => void) | null = null;

type NetworkType = 'LAN' | 'WWAN' | 'NONE';

interface AppInfoJson {
  appId: string;
  appName: string;
  appVersion: string;
  region: string;
  model: string;
  brand: string;
  manufacturer: string;
  deviceId: string;
}

interface BundleInfoResult {
  appId: string;
  appVersion: string;
}

interface DeviceInfoResult {
  model: string;
  brand: string;
  manufacturer: string;
  osVersion: string;
}

let injected = false;
let netConn: connection.NetConnection | null = null;
let crashWatcherInstalled = false;

// ---- 文件 store（worker 无 Context，preferences 不可用的替代方案）----
// 主线程经 UiPort 把沙箱 filesDir 转发进来（setSensorsWaveFilesDir）；
// 经典 worker 里 getContext() 抛错（真机实证 2026-09-14），preferences 全链路不可用。
let sandboxFilesDir: string | null = null;
/** 内存缓存的 store（loadStore 首读后常驻；写路径 persistStore 落盘） */
let cachedStore: Record<string, string> | null = null;
// hiAppEvent onReceive（HiAppEvent 回调线程）每成功落盘一批故障记录 +1；
// lastInjectedVersion 由 worker 线程在注入前记录，两者不等说明有新记录待注入
let pendingVersion = 0;
let lastInjectedVersion = -1;

/** 崩溃记录的落盘结构（与 iOS/Android 三端统一） */
interface CrashRecordJson {
  type: string;
  message: string;
  stack: string;
  timestamp: number;
}

/** RFC4122 v4 UUID。ArkTS 不支持 crypto.randomUUID，自己实现一份。 */
function generateUUID(): string {
  const hex = '0123456789abcdef';
  const out: string[] = [];
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out.push('-');
    } else if (i === 14) {
      out.push('4');
    } else if (i === 19) {
      out.push(hex.charAt(((Math.random() * 16) | 0) & 0x3 | 0x8));
    } else {
      out.push(hex.charAt((Math.random() * 16) | 0));
    }
  }
  return out.join('');
}

/** 读 deviceInfo 字段并保护 ArkTS 严格模式（不允许任何 cast）。 */
function tryGetDeviceField(fieldName: string): string {
  try {
    let v = '';
    if (fieldName === 'productModel') v = deviceInfo.productModel || '';
    else if (fieldName === 'deviceType') v = deviceInfo.deviceType || '';
    else if (fieldName === 'brand') v = deviceInfo.brand || '';
    else if (fieldName === 'manufacture') v = deviceInfo.manufacture || '';
    else if (fieldName === 'displayVersion') v = deviceInfo.displayVersion || '';
    else if (fieldName === 'osFullName') v = deviceInfo.osFullName || '';
    else if (fieldName === 'product') return '';
    else if (fieldName === 'vendor') return '';
    return v;
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `deviceInfo.${fieldName} threw: ${JSON.stringify(e)}`);
    return '';
  }
}

/** sdkApiVersion 类型是 number，必须独立函数。 */
function tryGetDeviceApiVersion(): number {
  try {
    return deviceInfo.sdkApiVersion;
  } catch (e) {
    return 0;
  }
}

/**
 * 注入数据到 v8 JS 引擎的 globalThis。
 *
 * ets worker 的 globalThis 和 v8 JS 引擎的 globalThis 是两个独立的 v8 Context。
 * 唯一可靠的桥是 cocos.evalString(code)，由 cocos_worker.ets 在
 * nativeEngineInit 之后把 cocos.evalString 引用透传进来。
 *
 * 没传 evalJs 时 fallback 到 ets globalThis 直接赋值（v8 端看不到，ets 端可见）。
 */
function safeGlobalSet(
  key: string,
  value: AppInfoJson | NetworkType | string,
): void {
  try {
    if (evalJsFn) {
      const json = JSON.stringify(value);
      const jsCode = `globalThis.${key} = ${json};`;
      evalJsFn(jsCode);
    } else {
      if (key === APP_INFO_KEY) {
        globalThis.__sensorswave_app_info__ = value as AppInfoJson;
      } else if (key === NET_TYPE_KEY) {
        globalThis.__sensorswave_network_type__ = value as NetworkType;
      }
      hilog.warn(DOMAIN, TAG, `evalJs not provided, fell back to ets globalThis (v8 cannot see this)`);
    }
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `safeGlobalSet ${key} failed: ${JSON.stringify(e)}`);
  }
}

/**
 * 把异常对象格式化成带真实 message 的字符串。
 * ⚠️ 不能只用 JSON.stringify(e)：JSON.stringify(Error) 恒为 '{}'，
 * 会把真实错误吞掉（真机排查 ensurePreferences 失败时踩过这个坑）。
 */
function fmtErr(e: Object | null | undefined): string {
  try {
    const err = e as Error;
    if (err && (err.message || err.name)) {
      return `${err.name ?? 'Error'}: ${err.message ?? '(no message)'}`;
    }
    const s = JSON.stringify(e);
    return s === undefined || s === null ? String(e) : s;
  } catch {
    return String(e);
  }
}

/**
 * 主线程 → worker 转发的沙箱 filesDir 落地点（见集成步骤 4）。
 * 幂等：只接受首次设置（filesDir 进程内不变）。
 */
export function setSensorsWaveFilesDir(dir: string | null): void {
  if (sandboxFilesDir) return;
  sandboxFilesDir = typeof dir === 'string' && dir.length > 0 ? dir : null;
  if (sandboxFilesDir) {
    hilog.info(DOMAIN, TAG, `filesDir ready (crash store enabled)`);
  }
}

/**
 * 等 filesDir 就绪（主线程的 swFilesDir 消息与 boot 注入是并发到达的）。
 * 超时返回 null：调用方降级（不落盘 / 不注入），与原 preferences 失败同语义。
 */
function ensureFilesDir(timeoutMs: number = 5000): Promise<string | null> {
  if (sandboxFilesDir) {
    return Promise.resolve(sandboxFilesDir);
  }
  return new Promise<string | null>((resolve: (v: string | null) => void) => {
    let waited = 0;
    const step = 100;
    const tick = (): void => {
      if (sandboxFilesDir) {
        resolve(sandboxFilesDir);
        return;
      }
      waited += step;
      if (waited >= timeoutMs) {
        hilog.warn(DOMAIN, TAG, `filesDir not provided (uiPort "swFilesDir"), store disabled`);
        resolve(null);
        return;
      }
      setTimeout(tick, step);
    };
    tick();
  });
}

/**
 * 读文件 store（首次读后缓存进 cachedStore）。
 * 返回 null：filesDir 未就绪 / 读取失败——调用方按"无数据"降级，绝不抛出。
 */
async function loadStore(): Promise<Record<string, string> | null> {
  try {
    if (cachedStore) return cachedStore;
    const dir = await ensureFilesDir();
    if (!dir) return null;
    const path = dir + '/' + STORE_FILE_NAME;
    if (!fs.accessSync(path)) {
      cachedStore = {};
      return cachedStore;
    }
    const stat = fs.statSync(path);
    if (stat.size <= 0) {
      cachedStore = {};
      return cachedStore;
    }
    const file = fs.openSync(path, fs.OpenMode.READ_ONLY);
    const buf = new ArrayBuffer(stat.size);
    fs.readSync(file.fd, buf);
    fs.closeSync(file);
    // 栈里含中文等非 ASCII：必须走 TextDecoder（String.fromCharCode 会按字节错解 UTF-8）
    const decoder = util.TextDecoder.create('utf-8');
    const text = decoder.decodeToString(new Uint8Array(buf));
    const parsed = JSON.parse(text) as Record<string, string>;
    cachedStore = parsed && typeof parsed === 'object' ? parsed : {};
    return cachedStore;
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `loadStore failed: ${fmtErr(e)}`);
    return null;
  }
}

/**
 * 把 cachedStore 原子落盘：写 <file>.tmp 后 rename 替换
 * （写一半崩溃不会留半截 JSON 毁掉整个 store）。
 */
async function persistStore(): Promise<boolean> {
  if (!cachedStore || !sandboxFilesDir) return false;
  const path = sandboxFilesDir + '/' + STORE_FILE_NAME;
  const tmp = path + '.tmp';
  try {
    const file = fs.openSync(tmp, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    fs.writeSync(file.fd, JSON.stringify(cachedStore));
    fs.closeSync(file);
    fs.renameSync(tmp, path);
    return true;
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `persistStore failed: ${fmtErr(e)}`);
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore：tmp 清理失败无所谓
    }
    return false;
  }
}

/**
 * 持久化 deviceId 到文件 store，跨启动稳定。
 */
async function getOrCreateDeviceId(): Promise<string> {
  try {
    const store = await loadStore();
    if (!store) {
      return generateUUID();
    }
    const cached = store[KEY_DEVICE_ID];
    if (cached && typeof cached === 'string' && cached.length > 0) {
      return cached;
    }
    const id = generateUUID();
    store[KEY_DEVICE_ID] = id;
    await persistStore();
    return id;
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `getOrCreateDeviceId failed: ${fmtErr(e)}`);
    return generateUUID();
  }
}

/**
 * 读取 appId（bundle name）和 appVersion。
 * appName 不解析（见文件头说明），由业务方 registerCommonProperties 覆盖。
 */
function readBundleInfo(): BundleInfoResult {
  const empty: BundleInfoResult = {
    appId: '',
    appVersion: '',
  };
  try {
    const flag = bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION;
    const info = bundleManager.getBundleInfoForSelfSync(flag);
    const appId = info.name || '';
    const appVersion = info.versionName || '';
    return { appId, appVersion };
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `readBundleInfo failed: ${JSON.stringify(e)}`);
    return empty;
  }
}

/**
 * 读取设备硬件信息。$os_version 优先 displayVersion（语义对齐 iOS/Android），
 * 回退到 osFullName 去前缀，再回退到 sdkApiVersion。
 */
function readDeviceInfo(): DeviceInfoResult {
  const osVersion = resolveOsVersion();
  const model = tryGetDeviceField('productModel') || tryGetDeviceField('product') || tryGetDeviceField('deviceType');
  const brand = tryGetDeviceField('brand');
  const manufacturer = tryGetDeviceField('manufacture') || tryGetDeviceField('vendor') || brand;
  return { model, brand, manufacturer, osVersion };
}

function resolveOsVersion(): string {
  const display = tryGetDeviceField('displayVersion');
  if (display) {
    return display;
  }
  const fullName = tryGetDeviceField('osFullName');
  if (fullName) {
    // 去掉 "OpenHarmony-" / "HarmonyOS " 等前缀，保证 $os_version 不和 $os 重复
    const stripped = fullName
      .replace(/^OpenHarmony[\s-]*/i, '')
      .replace(/^HarmonyOS[\s-]*/i, '')
      .trim();
    if (stripped) return stripped;
    return fullName;
  }
  const api = tryGetDeviceApiVersion();
  if (api > 0) {
    return String(api);
  }
  return '';
}

function readRegion(): string {
  try {
    return i18n.System.getSystemRegion() || '';
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `getSystemRegion failed: ${JSON.stringify(e)}`);
    return '';
  }
}

/**
 * 映射 connection bearer types 到业务网络类型：
 *   WiFi / Ethernet / VPN → LAN
 *   Cellular               → WWAN
 *   其它 / 无网络          → NONE
 *
 * ArkTS 适配：getNetCapabilitiesSync() 必须传 NetHandle（先用 getDefaultNetSync 拿）。
 */
function readNetworkType(): NetworkType {
  try {
    const handle = connection.getDefaultNetSync();
    if (!handle) return 'NONE';
    const netCap = connection.getNetCapabilitiesSync(handle);
    if (!netCap) return 'NONE';
    const bearers: connection.NetBearType[] = netCap.bearerTypes || [];
    for (let i = 0; i < bearers.length; i++) {
      const b = bearers[i];
      if (
        b === connection.NetBearType.BEARER_WIFI ||
        b === connection.NetBearType.BEARER_ETHERNET ||
        b === connection.NetBearType.BEARER_VPN
      ) {
        return 'LAN';
      }
      if (b === connection.NetBearType.BEARER_CELLULAR) {
        return 'WWAN';
      }
    }
    return 'NONE';
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `readNetworkType failed: ${JSON.stringify(e)}`);
    return 'NONE';
  }
}

/**
 * 同步构造 AppInfoJson。deviceId 先用内存 UUID；持久化的 deviceId 会在
 * async 阶段回来后再注入一次替换。
 */
function buildAppInfoSync(deviceId: string): AppInfoJson {
  const bundle = readBundleInfo();
  const dev = readDeviceInfo();
  const region = readRegion();
  return {
    appId: bundle.appId,
    appName: '',
    appVersion: bundle.appVersion,
    region,
    model: dev.model,
    brand: dev.brand,
    manufacturer: dev.manufacturer,
    deviceId,
  };
}

function injectAppInfoSync(deviceId: string): boolean {
  try {
    const info = buildAppInfoSync(deviceId);
    safeGlobalSet(APP_INFO_KEY, info);
    return true;
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `injectAppInfoSync failed: ${JSON.stringify(e)}`);
    return false;
  }
}

function injectNetworkType(type: NetworkType): void {
  safeGlobalSet(NET_TYPE_KEY, type);
}

/**
 * 启动网络监听：先吐一次当前值，再注册 connection 回调热更新。
 * connection 走系统 binder 线程，回调里直接对 globalThis 赋值是线程安全的。
 */
function startNetworkMonitor(): void {
  if (netConn) return;
  try {
    injectNetworkType(readNetworkType());
    netConn = connection.createNetConnection();
    netConn.on('netCapabilitiesChange', () => {
      injectNetworkType(readNetworkType());
    });
    netConn.on('netLost', () => {
      injectNetworkType('NONE');
    });
    netConn.register(() => {
      hilog.info(DOMAIN, TAG, 'network connection registered');
    });
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `startNetworkMonitor failed: ${JSON.stringify(e)}`);
  }
}

/**
 * 主动重试注入：connection / 某些设备的 bundleManager 偶发首调失败，
 * 间隔 1s 重试，最多 5 次。仅对同步注入失败的兜底，正常情况不会进 retry。
 */
function injectWithRetrySync(): void {
  const tryOnce = (): void => {
    const tempId = generateUUID();
    const ok = injectAppInfoSync(tempId);
    if (ok) {
      getOrCreateDeviceId().then((persistentId) => {
        if (persistentId && persistentId !== tempId) {
          injectAppInfoSync(persistentId);
        }
      });
      startNetworkMonitor();
      return;
    }
    let attempt = 0;
    const maxRetry = 5;
    const tick = (): void => {
      attempt++;
      if (attempt > maxRetry) {
        hilog.warn(DOMAIN, TAG, `gave up injecting after ${maxRetry} retries`);
        return;
      }
      const retryOk = injectAppInfoSync(generateUUID());
      if (retryOk) {
        getOrCreateDeviceId().then((persistentId) => {
          if (persistentId) injectAppInfoSync(persistentId);
        });
        startNetworkMonitor();
      } else {
        setTimeout(tick, 1000);
      }
    };
    setTimeout(tick, 1000);
  };
  tryOnce();
}

// 模块加载即打的日志：用于确认 bridge 文件被 import 了。
// 如果 hilog 里看不到这一行，说明 cocos_worker.ets 没 import 本模块。
hilog.info(DOMAIN, TAG, `module loaded`);

// ---- Crash Capture 实现 ----

/**
 * 读取文件 store 中的待补报崩溃记录。
 * boot 裁剪：丢弃 >7 天的过期记录。逐条防御式校验（timestamp 必须是有限数字，
 * JS 侧水位线过滤依赖其单调可比）。
 * ⚠️ 水位线机制：原生**永不**因"已注入/已上报"删除记录（JS 侧用 localStorage
 * 水位线过滤），裁剪只防存储无限增长（上限 10 条在 append 时保证）。
 */
async function readPendingCrashRecords(): Promise<CrashRecordJson[]> {
  const out: CrashRecordJson[] = [];
  try {
    const store = await loadStore();
    if (!store) return out;
    const raw = store[KEY_PENDING_CRASHES];
    if (typeof raw !== 'string' || raw.length === 0) return out;
    const parsed = JSON.parse(raw) as CrashRecordJson[];
    if (!Array.isArray(parsed)) return out;
    const cutoff = Date.now() - CRASH_EXPIRY_MS;
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (!item || typeof item !== 'object') continue;
      const ts = item.timestamp;
      if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
      if (ts < cutoff) continue;
      out.push({
        type: typeof item.type === 'string' ? item.type : 'Unknown',
        message: typeof item.message === 'string' ? item.message : '',
        stack: typeof item.stack === 'string' ? item.stack : '',
        timestamp: ts,
      });
    }
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `readPendingCrashRecords failed: ${JSON.stringify(e)}`);
  }
  return out;
}

async function writePendingCrashRecords(records: CrashRecordJson[]): Promise<void> {
  try {
    const store = await loadStore();
    if (!store) return;
    store[KEY_PENDING_CRASHES] = JSON.stringify(records);
    await persistStore();
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `writePendingCrashRecords failed: ${fmtErr(e)}`);
  }
}

/**
 * 批量追加崩溃记录：一个 onReceive 批次只做一次 read-modify-write
 * （同批可能含多条历史故障，如 crash loop 连续崩溃）。
 */
async function appendPendingCrashRecords(records: CrashRecordJson[]): Promise<void> {
  if (records.length === 0) return;
  try {
    const existing = await readPendingCrashRecords();
    for (let i = 0; i < records.length; i++) {
      existing.push(records[i]);
    }
    while (existing.length > MAX_CRASH_RECORDS) {
      existing.shift();
    }
    await writePendingCrashRecords(existing);
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `appendPendingCrashRecords failed: ${JSON.stringify(e)}`);
  }
}

// ---- hiAppEvent 故障事件解析（映射到三端统一 CrashRecordJson）----

/** 防御式读取 params 中的嵌套对象（exception 等），未命中返回空对象 */
function readEventObject(params: Record<string, Object>, keys: string[]): Record<string, Object> {
  const empty: Record<string, Object> = {};
  try {
    for (let i = 0; i < keys.length; i++) {
      const v = params[keys[i]];
      if (v !== null && v !== undefined && typeof v === 'object') {
        return v as Record<string, Object>;
      }
    }
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `readEventObject failed: ${JSON.stringify(e)}`);
  }
  return empty;
}

/** 防御式读取字符串字段（取第一个非空 string），未命中返回 '' */
function readEventString(params: Record<string, Object>, keys: string[]): string {
  try {
    for (let i = 0; i < keys.length; i++) {
      const v = params[keys[i]];
      if (typeof v === 'string' && (v as string).length > 0) {
        return v as string;
      }
    }
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `readEventString failed: ${JSON.stringify(e)}`);
  }
  return '';
}

/** 防御式读取正数字段（time 等），未命中返回 0 */
function readEventNumber(params: Record<string, Object>, keys: string[]): number {
  try {
    for (let i = 0; i < keys.length; i++) {
      const v = params[keys[i]];
      if (typeof v === 'number' && Number.isFinite(v) && (v as number) > 0) {
        return v as number;
      }
    }
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `readEventNumber failed: ${JSON.stringify(e)}`);
  }
  return 0;
}

/** 防御式读取对象数组字段（exception.frames 等），未命中返回 [] */
function readEventObjectArray(params: Record<string, Object>, keys: string[]): Object[] {
  try {
    for (let i = 0; i < keys.length; i++) {
      const v = params[keys[i]];
      if (v !== null && v !== undefined && Array.isArray(v)) {
        return v as Object[];
      }
    }
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `readEventObjectArray failed: ${JSON.stringify(e)}`);
  }
  return [];
}

/**
 * 故障时刻归一为毫秒：faultlog time 可能是秒（<1e12）或毫秒。
 * 超出合理窗（早于 2020-01-01 / 晚于明天）视为非法返回 0，由调用方兜底 Date.now()——
 * JS 侧水位线过滤是严格大于，timestamp ≤ 0 的记录永远无法补报，必须有兜底。
 */
function normalizeEventTimeMs(raw: number): number {
  if (raw <= 0) return 0;
  const ms = raw < 1e12 ? raw * 1000 : raw;
  const minMs = 1577836800000; // 2020-01-01
  if (ms < minMs || ms > Date.now() + 24 * 3600 * 1000) return 0;
  return ms;
}

/**
 * 结构化原生帧（exception.frames[{file, symbol, pc, offset}]）格式化为
 * faultlogger 文本行（每帧一行 `#nn pc 0xPC file(symbol+offset)`），
 * 与 JS 侧 $exception_frames 的 native 帧解析器（exception-frames.ts）约定一致。
 */
function formatNativeFrames(frames: Object[]): string {
  const lines: string[] = [];
  try {
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f === null || f === undefined || typeof f !== 'object') continue;
      const rec = f as Record<string, Object>;
      const file = typeof rec['file'] === 'string' ? rec['file'] as string : '';
      const symbol = typeof rec['symbol'] === 'string' ? rec['symbol'] as string : '';
      const offset = typeof rec['offset'] === 'number' ? rec['offset'] as number : -1;
      // pc 兼容 number 与 "0x..." 字符串两种形态
      let pcHex = '';
      const pc = rec['pc'];
      if (typeof pc === 'number' && Number.isFinite(pc) && (pc as number) > 0) {
        pcHex = (pc as number).toString(16);
      } else if (typeof pc === 'string' && (pc as string).length > 0) {
        pcHex = (pc as string).replace(/^0x/i, '');
      }
      if (file.length === 0 || pcHex.length === 0) continue;
      let line = `#${i.toString().padStart(2, '0')} pc 0x${pcHex} ${file}`;
      if (symbol.length > 0) {
        line += offset >= 0 ? `(${symbol}+${offset})` : `(${symbol})`;
      }
      lines.push(line);
    }
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `formatNativeFrames failed: ${JSON.stringify(e)}`);
  }
  return lines.join('\n');
}

/**
 * 把 hiAppEvent 故障事件（APP_CRASH / APP_FREEZE）params 映射为三端统一的
 * CrashRecordJson。crash_type 判别（旧版本键名兜底）：
 *   - NativeCrash → type='CPP_CRASH'，结构化帧格式化为 faultlogger 文本
 *   - JsError → type/message/stack 取 exception.name/message/stack（V8 形态，
 *     JS 侧 web:javascript 帧解析器直接消化）
 *   - 其它（APP_FREEZE 等）→ type 取 exception.name（如 THREAD_BLOCK_6S），
 *     退化到事件名
 * timestamp 取故障 time（秒/毫秒自动归一），缺失兜底 Date.now()。
 */
function buildCrashRecordFromEvent(
  name: string,
  params: Record<string, Object>,
): CrashRecordJson | null {
  try {
    const exception = readEventObject(params, ['exception', 'EXCEPTION']);
    const crashType = readEventString(params, ['crash_type', 'CRASH_TYPE', 'fault_type', 'FAULT_TYPE']);
    const isNative = crashType === 'NativeCrash' || crashType === 'CPP_CRASH';
    const isJs = crashType === 'JsError' || crashType === 'JS_CRASH';

    let type = '';
    let message = '';
    let stack = '';

    if (isNative) {
      type = 'CPP_CRASH';
      message = readEventString(exception, ['message', 'msg']);
      const frames = readEventObjectArray(exception, ['frames']);
      stack = frames.length > 0 ? formatNativeFrames(frames) : '';
    } else if (isJs) {
      type = readEventString(exception, ['name']);
      message = readEventString(exception, ['message', 'msg']);
      stack = readEventString(exception, ['stack']);
    } else {
      type = readEventString(exception, ['name']);
      message = readEventString(exception, ['message', 'msg']);
    }

    // 兜底链：type 退化 crash_type → 事件名；message / stack 退化旧版顶层字段
    if (type.length === 0) {
      type = crashType.length > 0 ? crashType : name;
    }
    if (message.length === 0) {
      message = readEventString(params, ['REASON', 'reason', 'MSG', 'msg', 'MESSAGE', 'message']);
    }
    if (stack.length === 0) {
      stack = readEventString(params, ['STACK', 'stack']);
    }

    const ts = normalizeEventTimeMs(readEventNumber(params, ['time', 'TIME', 'happen_time', 'HAPPEN_TIME']));
    const record: CrashRecordJson = {
      type,
      message,
      stack,
      timestamp: ts > 0 ? ts : Date.now(),
    };
    return record;
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `buildCrashRecordFromEvent failed: ${JSON.stringify(e)}`);
    return null;
  }
}

/**
 * 注册 hiAppEvent 故障 watcher（幂等），订阅 domain.OS 的 APP_CRASH / APP_FREEZE。
 *
 * 不使用 errorManager：注册 errorManager 会拦截未捕获异常，改变系统默认行为——
 * 进程不退出、faultlog 不落盘，游戏带坏状态继续运行。hiAppEvent 模型下进程保持
 * 默认崩溃退出，系统 faultlogger 采集故障，下次启动 watcher 收到补报事件
 * （上次启动的崩溃 + 卡死，含故障原始时刻）。
 *
 * ⚠️ onReceive 在 HiAppEvent 回调线程执行：只解析 + 写文件 store（唯一安全
 * sink），绝不碰 evalString（跨线程调 evalString 会破坏 v8 isolate）。写入完成后
 * 递增 pendingVersion，由 worker 线程的轮询（startCrashInjectionPoll）检测变化后
 * 重注入——所有 evalString 都留在 worker 线程。
 */
export function installSensorsWaveCrashWatcher(): void {
  if (crashWatcherInstalled) return;
  crashWatcherInstalled = true;
  try {
    const watcher: hiAppEvent.Watcher = {
      name: CRASH_WATCHER_NAME,
      appEventFilters: [
        {
          domain: hiAppEvent.domain.OS,
          names: [hiAppEvent.event.APP_CRASH, hiAppEvent.event.APP_FREEZE],
        },
      ],
      onReceive: (domain: string, appEventGroups: Array<hiAppEvent.AppEventGroup>): void => {
        try {
          const records: CrashRecordJson[] = [];
          for (let g = 0; g < appEventGroups.length; g++) {
            const infos = appEventGroups[g].appEventInfos;
            for (let i = 0; i < infos.length; i++) {
              const record = buildCrashRecordFromEvent(
                infos[i].name,
                infos[i].params as Record<string, Object>,
              );
              if (record !== null) {
                records.push(record);
              }
            }
          }
          if (records.length > 0) {
            appendPendingCrashRecords(records).then(() => {
              // 落盘完成再递增版本号，保证轮询注入时文件 store 已含新记录
              pendingVersion++;
            });
          }
        } catch (e) {
          hilog.warn(DOMAIN, TAG, `hiAppEvent onReceive failed: ${JSON.stringify(e)}`);
        }
      },
    };
    hiAppEvent.addWatcher(watcher);
    startCrashInjectionPoll();
    hilog.info(DOMAIN, TAG, 'crash watcher installed');
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `install crash watcher failed: ${JSON.stringify(e)}`);
  }
}

/**
 * worker 线程轮询 pendingVersion 变化并重注入（自续 setTimeout 链，约 60s 窗口）。
 * hiAppEvent 故障补报异步到达，晚于 boot 的一次性注入；重注入是幂等的——
 * JS 侧水位线过滤已上报记录，重复注入零重复上报。
 */
function startCrashInjectionPoll(): void {
  let round = 0;
  const tick = (): void => {
    round++;
    if (round > CRASH_POLL_MAX_ROUNDS) return;
    if (lastInjectedVersion !== pendingVersion) {
      injectPendingCrashes();
    }
    setTimeout(tick, CRASH_POLL_INTERVAL_MS);
  };
  setTimeout(tick, CRASH_POLL_INTERVAL_MS);
}

/**
 * 把落盘的崩溃记录注入 JS global（JSON 数组文本直接当 JS array literal 嵌入）。
 * 注入的记录保留在文件 store 里——JS 侧水位线保证不重复上报。
 * 注入前先记录当前版本号：此后 onReceive 新落盘的批次会再递增版本号，
 * 触发轮询的下一轮重注入。
 */
async function injectPendingCrashes(): Promise<void> {
  try {
    lastInjectedVersion = pendingVersion;
    const records = await readPendingCrashRecords();
    if (records.length === 0) return;
    if (!evalJsFn) {
      // evalJs 未就绪（调用时序错误）：不注入也不删记录，下次启动重试
      hilog.warn(DOMAIN, TAG, 'evalJs not provided, skip injecting pending crashes');
      return;
    }
    const json = JSON.stringify(records);
    evalJsFn(`globalThis.${PENDING_CRASHES_KEY} = ${json};`);
    hilog.info(DOMAIN, TAG, `injected ${records.length} pending crashes`);
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `injectPendingCrashes failed: ${JSON.stringify(e)}`);
  }
}

/**
 * 业务方入口：幂等，重复调用只生效一次。
 *
 * 先**同步**注入一次（deviceId 临时生成），保证 SDK 启动期间就能从 globalThis
 * 读到完整 appInfo；然后异步把持久化的 deviceId 注入一次替换。
 * 同时安装崩溃捕获并把上次落盘的崩溃记录注入（fatal 补报数据源）。
 *
 * @param evalJs  可选：cocos.evalString 引用，由 cocos_worker.ets 在
 *                uiPort.on("onXCLoad") 回调内、nativeEngineInit 之后传入。
 */
export function injectSensorsWaveAppInfo(evalJs?: ((code: string) => void) | null): void {
  if (injected) {
    // 重复调用时也更新 evalJs 引用（业务方可能在多次调用间切换）
    if (evalJs) evalJsFn = evalJs;
    return;
  }
  injected = true;
  if (evalJs) evalJsFn = evalJs;
  try {
    installSensorsWaveCrashWatcher();
    injectWithRetrySync();
    injectPendingCrashes();
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `injectSensorsWaveAppInfo threw: ${JSON.stringify(e)}`);
  }
}

/** 游戏 JS 经 JavaScriptArkTsBridge 调 onJsCommand 时传的 JSON 参数 */
interface JsCommandJson {
  cmd: string;
}

/**
 * 【调试用】游戏 JS → ArkTS 的统一命令入口（白名单分发）。
 *
 * 调用链（Cocos 3.8+ OHOS 引擎内置通道，引擎源码
 * bindings/manual/JavaScriptArkTsBridge.cpp + NapiHelper.cpp CallJsSync）：
 *   游戏 JS  new JavaScriptArkTsBridge().callStaticMethod(
 *              'entry/src/main/ets/cocos/SensorsWaveBridge', 'onJsCommand',
 *              '{"cmd":"raiseTestCrash"}', true)
 *   → native  napi_load_module_with_info 加载本模块，取出 onJsCommand 函数引用
 *   → worker  cocos_worker.ets 预先注册的 executeMethodSync glue 调
 *             onJsCommand(paramStr)，返回值（string）原路回传游戏 JS
 *
 * ⚠️ raiseTestCrash 必须 setTimeout(0) 异步执行：isSync=true 时游戏线程阻塞等
 *   本函数返回，同步执行崩溃动作会落在 native CallJsSync 的调用栈上
 *   （与 Android ExceptionClear / iOS @try@catch 同一条纪律）。
 *
 * @param paramJson JSON 字符串，如 '{"cmd":"raiseTestCrash"}'（也容错裸命令串）
 * @returns 命令回执（'ok' / 错误说明），原样回传游戏 JS
 */
export function onJsCommand(paramJson: string): string {
  let cmd = '';
  try {
    const parsed = JSON.parse(paramJson) as JsCommandJson;
    cmd = typeof parsed?.cmd === 'string' ? parsed.cmd : '';
  } catch (e) {
    // 容错：JSON 解析失败，退回裸命令字符串（'raiseTestCrash'）
    hilog.warn(DOMAIN, TAG, `onJsCommand paramJson not JSON: ${JSON.stringify(e)}`);
    cmd = (paramJson ?? '').trim();
  }
  if (cmd === 'raiseTestCrash') {
    setTimeout(() => raiseTestCrash(), 0);
    return 'ok';
  }
  return 'unknown cmd: ' + cmd;
}

/**
 * 【调试用】制造一次真崩溃，验证 fatal 补报通道。
 *
 * 常规入口是游戏 JS 经 onJsCommand 下发（见上）；通道不可用时
 * （旧引擎 / executeMethodSync glue 未注册）也可在 cocos_worker.ets
 * 挂临时定时器：setTimeout(() => raiseTestCrash(), 10000)。
 *
 * ⚠️ 必须走 native 崩溃（真机实证 2026-09-14）：classic worker 里未捕获的
 * ArkTS 异常**不会**杀死进程——ArkCompiler 只触发 HandleUncaughtException
 * 记日志，进程和 worker 都活着，faultlogger 无从采集，补报链路无源。
 * 这里经 evalString 调 C++ hook 暴露的 jsb.swRaiseTestNativeCrash()
 * （SensorsWaveExceptionHook.cpp，abort → CPP_CRASH）→ faultlogger 采集
 * → 下次启动 watcher 收到补报事件 → $Exception(level=fatal)。
 * native hook 未集成时退回 ArkTS throw（仅破坏 worker，不产生崩溃事件）。
 */
export function raiseTestCrash(): void {
  hilog.error(DOMAIN, TAG, 'raiseTestCrash: raising native crash to verify fatal channel');
  if (evalJsFn) {
    evalJsFn('if (globalThis.jsb && typeof jsb.swRaiseTestNativeCrash === "function") { jsb.swRaiseTestNativeCrash(); }');
    return;
  }
  throw new Error('SensorsWave fatal 通道验证崩溃（native hook 不可用，退回 ArkTS throw）');
}
