/****************************************************************************
 * SensorsWaveBridge.ets
 *
 * HarmonyOS Next (OpenHarmony) 端设备信息桥接。
 *
 * 集成步骤：
 *   1. 把本文件 cp 到 <entry>/src/main/ets/cocos/
 *   2. 在 <entry>/src/main/ets/workers/cocos_worker.ets 顶部加 import：
 *        import { injectSensorsWaveAppInfo } from '../cocos/SensorsWaveBridge';
 *   3. 在 cocos_worker.ets 里 uiPort.on("onXCLoad", () => { ... }) 回调内、
 *      renderContext.nativeEngineInit() 之后调用：
 *        injectSensorsWaveAppInfo(cocos.evalString);
 *      ⚠️ 必须传 cocos.evalString（bridge 不直接 import cocos，cocos/ 子目录下
 *        import 行为会让 bridge 模块加载失败），需要 worker 把 evalString 引用透传
 *      ⚠️ 必须在 nativeEngineInit 之后调，否则 SIGSEGV
 *   4. 业务方在 init() 之后用 sensorswave.registerCommonProperties({ $app_name: 'xxx' })
 *      设置 $app_name（bridge 拿不到 appInfo.label，详见下文）
 *
 * 启动后会在 JS 引擎 globalThis 上注入：
 *   - globalThis.__sensorswave_app_info__：{ appId, appName, appVersion, region,
 *     model, brand, manufacturer, deviceId }
 *   - globalThis.__sensorswave_network_type__：'LAN' | 'WWAN' | 'NONE'
 *
 * ⚠️ appName 永远为空字符串：Stage 模型下 appInfo.label 是 "$string:app_name"
 *   资源引用，解析需要 UIAbilityContext（cocos worker 拿不到，架构限制）。
 *   业务方用 sensorswave.registerCommonProperties({ $app_name: 'xxx' }) 覆盖即可。
 ****************************************************************************/

import bundleManager from '@ohos.bundle.bundleManager';
import deviceInfo from '@ohos.deviceInfo';
import i18n from '@ohos.i18n';
import connection from '@ohos.net.connection';
import preferences from '@ohos.data.preferences';
import hilog from '@ohos.hilog';

// 不在本文件 import libcocos.so：cocos napi 模块在本文件所在的
// `entry/.../ets/cocos/` 子目录中 import 行为跟 cocos_worker.ets 父模块不一样，
// 会导致整个 bridge 模块加载失败。bridge 不直接调 cocos.evalString，
// 由 cocos_worker.ets 把 evalString 函数引用通过 injectSensorsWaveAppInfo(evalJs) 传进来。

const TAG = 'SensorsWaveBridge';
const DOMAIN = 0xA001;
const PREF_FILE_NAME = '__sensorswave_pref__';
const KEY_DEVICE_ID = '__sensorswave_device_id__';
const APP_INFO_KEY = '__sensorswave_app_info__';
const NET_TYPE_KEY = '__sensorswave_network_type__';

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
let cachedPref: preferences.Preferences | null = null;

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
 * 持久化 deviceId 到 preferences，跨启动稳定。
 * ArkTS 适配：getPreferences 返回类型是 Promise<Preferences>，需要断言为 Preferences。
 */
async function getOrCreateDeviceId(): Promise<string> {
  try {
    if (!cachedPref) {
      // worker 里调用 getContext() 会拿到 application context。
      // HarmonyOS Next 中此 API 在 classic worker 内可能抛错，外层 catch 兜底为内存 UUID。
      const ctx = getContext();
      const p = await preferences.getPreferences(ctx, PREF_FILE_NAME);
      cachedPref = p as preferences.Preferences;
    }
    if (!cachedPref) {
      return generateUUID();
    }
    const cached = await cachedPref.get(KEY_DEVICE_ID, '');
    if (cached && typeof cached === 'string' && cached.length > 0) {
      return cached;
    }
    const id = generateUUID();
    await cachedPref.put(KEY_DEVICE_ID, id);
    await cachedPref.flush();
    return id;
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `getOrCreateDeviceId failed: ${JSON.stringify(e)}`);
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

/**
 * 业务方入口：幂等，重复调用只生效一次。
 *
 * 先**同步**注入一次（deviceId 临时生成），保证 SDK 启动期间就能从 globalThis
 * 读到完整 appInfo；然后异步把持久化的 deviceId 注入一次替换。
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
    injectWithRetrySync();
  } catch (e) {
    hilog.warn(DOMAIN, TAG, `injectSensorsWaveAppInfo threw: ${JSON.stringify(e)}`);
  }
}
