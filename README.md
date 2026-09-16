# SensorsWave Cocos Creator SDK

SensorsWave Cocos Creator SDK 是一款面向 Cocos Creator 游戏的多端数据采集 SDK，提供事件埋点、用户属性管理、A/B 测试、UTM 渠道追踪等核心能力。

SDK 基于 Cocos Creator 的跨平台构建能力，一套代码自动适配三大平台：

- **App 端**：iOS、Android（3.x 额外支持 OpenHarmony）
- **小游戏端**：微信小游戏、抖音小游戏、百度小游戏等
- **H5 端**：Web 浏览器

## 平台支持矩阵

| Cocos Creator 版本 | 接入方式                                                     | App 端原生桥                     |
| ---------------- | -------------------------------------------------------- | ---------------------------- |
| **3.x**          | `npm install @sensorswave/cocoscreator-sdk`              | iOS / Android / HarmonyOS    |
| **2.x**        | 下载 `bundle.js` 放到 `assets/scripts/sensorswave/bundle.js` | iOS / Android（不支持 HarmonyOS） |

> Cocos Creator 2.x SDK 不支持鸿蒙系统（OpenHarmony），如需鸿蒙原生构建，请使用 Cocos Creator 3.x SDK。

如果你还没有 SensorsWave 账号，请前往 [sensorswave.com](http://sensorswave.com/) 注册。

***

## 1. Cocos Creator 3.x 接入

### 1.1 安装

```bash
# 在 Cocos Creator 3.x 项目根目录
npm install @sensorswave/cocoscreator-sdk
```

### 1.2 初始化

在游戏入口脚本（如 `assets/scripts/main.ts`）中：

```typescript
import Sensorswave from '@sensorswave/cocoscreator-sdk';

Sensorswave.init('your-source-token', {
  apiHost: 'https://your-api-host.com',
  debug: false,
  autoCapture: true,
});
```

### 1.3 iOS 集成

> Cocos Creator 3.x 用 CMake 管理源文件，`build-templates/ios/Classes/*.mm` 不会被自动加到 Compile Sources，必须**显式注册到** **`CMakeLists.txt`** **的** **`CC_PROJ_SOURCES`**。

**前置**：先在 Cocos Creator 编辑器里 Build → iOS 一次，生成 `native/engine/ios/` 目录。

#### 步骤 1：复制桥接文件

```bash
# 业务方项目根目录
mkdir -p native/engine/ios/Classes
cp node_modules/@sensorswave/cocoscreator-sdk/native/ios/SensorsWaveBridge.mm \
   native/engine/ios/Classes/
```

文件最终位置：`你的项目/native/engine/ios/Classes/SensorsWaveBridge.mm`

#### 步骤 2：注册到 CMakeLists.txt

打开 `native/engine/ios/CMakeLists.txt`，做两处修改：

**修改 1**：在 `include(${CC_PROJECT_DIR}/../common/CMakeLists.txt)` 这一行**后面**添加：

```cmake
# SensorsWave SDK: register bridge .mm in CC_PROJ_SOURCES
list(APPEND CC_PROJ_SOURCES
    ${CMAKE_CURRENT_LIST_DIR}/Classes/SensorsWaveBridge.mm
)
```

**修改 2**：在 `add_executable(${EXECUTABLE_NAME} ${CC_ALL_SOURCES})` 这一行**后面**添加：

```cmake
target_link_libraries(${EXECUTABLE_NAME} "-framework Network")
```

> ⚠️ 关键陷阱：`"-framework Network"` 必须是**单字符串**（一个 CMake 参数），不能写成 `"-framework" "Network"`（双参数）。后者会被 CMake 拆成两个独立参数，在生成 Xcode 工程时退化成 `-lNetwork`（报 "Framework not found -lNetwork"）。

#### 步骤 3：清除缓存 + 重新构建

```bash
rm -rf build
# 在 Cocos Creator 里 Build iOS
# 用 Xcode 打开 build/ios/proj/ 编译运行
```

#### 验证

启动 App 后，业务方触发一个事件，上报数据里 `$app_id` / `$app_name` / `$app_version` / `$region` / `$network_type` / `$wifi` 不再为空。

***

### 1.4 Android 集成

> 重要：把 `.java` 放到 gradle 实际编译的目录 `native/engine/android/app/src/...`，
> 放到 `build-templates/android/src/...` 是无效的（gradle 不会扫这个目录）。

**前置**：先在 Cocos Creator 编辑器里 Build → Android 一次，生成 `native/engine/android/app/` 目录。

#### 步骤 1：复制桥接文件

```bash
# 业务方项目根目录
mkdir -p native/engine/android/app/src/com/sensorswave/cocoscreator/
cp node_modules/@sensorswave/cocoscreator-sdk/native/android/SensorsWaveBridge.java \
   native/engine/android/app/src/com/sensorswave/cocoscreator/
```

#### 步骤 2：注册 ContentProvider

编辑 `native/engine/android/app/AndroidManifest.xml`，在 `</application>` 前插入：

```xml
<provider
    android:name="com.sensorswave.cocoscreator.SensorsWaveBridge"
    android:authorities="${applicationId}.sensorswave.bridge"
    android:exported="false"
    android:initOrder="9999" />
```

#### 步骤 3：清除缓存 + 重新构建

```bash
rm -rf build
# 在 Cocos Creator 里 Build Android
# 用 Android Studio 打开 build/android/proj/ 编译 APK
```

#### 验证

业务方触发一个事件，上报数据里 `$app_id` / `$app_name` / `$app_version` / `$region` / `$model` / `$brand` / `$manufacturer` 不再为空。

***

### 1.5 HarmonyOS 集成

> ```typescript
> Sensorswave.init(sourceToken, { apiHost: 'https://...' });
> Sensorswave.registerCommonProperties({
>   $app_name: '我的游戏名',  // 跟 src/main/resources/base/element/string.json 的 app_name 一致
> });
> ```

**前置**：先在 Cocos Creator 编辑器里 Build → HarmonyOS Next 一次，生成 `native/engine/harmonyos-next/entry/` 目录。

#### 步骤 1：复制桥接文件

```bash
# 业务方项目根目录
mkdir -p native/engine/harmonyos-next/entry/src/main/ets/cocos/
cp node_modules/@sensorswave/cocoscreator-sdk/native/harmonyos/SensorsWaveBridge.ets \
   native/engine/harmonyos-next/entry/src/main/ets/cocos/
```

#### 步骤 2：在 `cocos_worker.ets` 注册导入 + 调用入口

打开 `native/engine/harmonyos-next/entry/src/main/ets/workers/cocos_worker.ets`，做三处修改：

**修改 1**：在 `import '../cocos/oh-adapter/sys-ability-polyfill';` 后面加 import：

```typescript
import '../cocos/oh-adapter/sys-ability-polyfill';
import { injectSensorsWaveAppInfo, setSensorsWaveFilesDir } from '../cocos/SensorsWaveBridge';
```

**修改 2**：在 `uiPort.on("onXCLoad", () => { ... })` 回调内、**`renderContext.nativeEngineInit()`** **之后**调用：

```typescript
uiPort.on("onXCLoad", () => {
  const renderContext = cocos.getContext(ContextType.NATIVE_RENDER_API);
  renderContext.nativeEngineInit();
  // [SensorsWave] 必须在 nativeEngineInit 之后调用！必须传 cocos.evalString
  // （bridge 不直接 import cocos，cocos/ 子目录下 import 会让 bridge 模块加载失败）
  injectSensorsWaveAppInfo(cocos.evalString);
  renderContext.nativeEngineStart();
});
```

**修改 3**（`enableCrashTrack` 需要）：在 `uiPort.on("onXCLoad", ...)` **之前**注册沙箱路径监听：

```typescript
// [SensorsWave] 主线程转发的沙箱路径。classic worker 里 getContext() 会抛错
// （preferences 不可用），崩溃记录 / deviceId 落盘（@ohos.file.fs）只能用
// 主线程经 UiPort 转发进来的 filesDir
uiPort.on("swFilesDir", (dir: string): void => {
  setSensorsWaveFilesDir(dir);
});
```

对应地，在 `entry/src/main/ets/pages/index.ets` 的 XComponent `.onLoad((context) => { ... })` 里、`this.workPort.postMessage("onXCLoad");` 之后加一行：

```typescript
.onLoad((context) => {
  this.workPort.postMessage("onXCLoad");
  // [SensorsWave] 转发沙箱 filesDir 给 worker（崩溃记录 / deviceId 落盘用）
  this.workPort.postMessage("swFilesDir", getContext(this).filesDir);
})
```

> ⚠️ 不做修改 3 时 `enableCrashTrack` **静默失效**（崩溃记录无法落盘，启动日志有 filesDir warn），其余功能不受影响。

#### 步骤 3（`enableErrorTrack` 需要）：集成 C++ 异常 hook

Cocos 3.8.x 的 OHOS 构建使用 **jsvm** JSB 后端，**没有** iOS / Android 走的引擎 `__errorHandler` 通道。不集成本步骤时，鸿蒙上 JS 未捕获异常**不会**产生 `$Exception`（error 级）事件——SDK 特性探测不到只会记录日志跳过（静默降级，不影响其他功能）。

复制 hook 源文件到 OHOS 工程根目录：

```bash
cp node_modules/@sensorswave/cocoscreator-sdk/native/harmonyos/SensorsWaveExceptionHook.cpp \
   native/engine/harmonyos-next/
```

编辑 `native/engine/harmonyos-next/CMakeLists.txt`，加两行：

```cmake
set(CC_LIB_NAME cocos)
set(CC_PROJ_SOURCES)
# [SensorsWave] jsvm 异常 hook（原理见该 cpp 头部注释）
list(APPEND CC_PROJ_SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/SensorsWaveExceptionHook.cpp)
```

```cmake
add_library(${CC_LIB_NAME} SHARED ${CC_ALL_SOURCES})
# [SensorsWave] 链接期接管 jsb_register_all_modules（jsvm 异常通道）
target_link_options(${CC_LIB_NAME} PRIVATE "-Wl,--wrap=_Z24jsb_register_all_modulesv")
```

> 原理：`--wrap` 在链接 `libcocos.so` 时接管引擎对 `jsb_register_all_modules()` 的调用，把 `jsb.swInstallExceptionHook` 注册进游戏 JS 引擎，SDK 据此接管 jsvm 的异常回调槽位。`-Wl,--wrap=` 后面是 Itanium C++ 修饰名（`c++filt _Z24jsb_register_all_modulesv` 可验证）；若引擎升级改名导致 wrap 失效，链接不报错、jsb 函数不出现，SDK 侧优雅降级，不会崩溃。

#### 步骤 4：直接 DevEco Studio 编译 HAP

#### 验证

启动 App 后，业务方触发一个事件，上报数据里 `$app_id` / `$app_version` / `$region` / `$model` / `$brand` / `$manufacturer` / `$network_type` / `$wifi` 不再为空。

`$Exception` 通道验证：`hilog` 应能看到 `crash watcher installed`、`filesDir ready (crash store enabled)`、`[Exception] OHOS jsvm exception hook installed` 三条日志（对应步骤 2 / 步骤 3 的集成结果）。

***

## 2. Cocos Creator 2.x 接入

### 2.1 安装

Cocos Creator 2.x 的 plugin-script 加载器（`jsb-adapter` 内的 `downloadScript`）**写死**了 SDK 脚本路径：只识别 `assets/scripts/sensorswave/bundle.js` 这一固定路径下的脚本，且不解析 `require("../xxx")` 相对路径。所以 SDK 必须以**单文件 + 固定路径**形式集成：

- **固定路径**：`assets/scripts/sensorswave/bundle.js` —— 文件名必须是 `bundle.js`，放在这个固定目录下。改名 / 改路径都会报 `Cannot find module '..'`

接入步骤：

1. 从 [GitHub Releases](https://github.com/sensorswave/cocoscreator-sdk/releases) 下载 `bundle.js`（**文件名直接就是** **`bundle.js`，不用改名**）
2. 放到项目 `assets/scripts/sensorswave/` 目录下：

```bash
mkdir -p assets/scripts/sensorswave
mv bundle.js assets/scripts/sensorswave/bundle.js
```

> 💡 **关于 GitHub Release 上的文件名**：本仓库发布时的资产路径是 `build/2.x/bundle.js`，下载下来就是 `bundle.js`，业务方不用改。**。
>
> 💡 **关于 bundle 体积**：发布到 GitHub Release 的 `bundle.js` 已经过 **terser 压缩**（mangle + 2 passes），从约 118 KB 压缩到约 **60 KB**（约 48% 缩减），加载更快、不影响运行时行为。

### 2.2 初始化

#### 业务代码用全局 `Sensorswave`

```javascript
// 任意 cc.Component / 普通脚本
Sensorswave.init('your-source-token', {
  apiHost: 'https://your-api-host.com',
  autoCapture: true,
});
Sensorswave.trackEvent('Login', { method: 'wechat' });
```

#### 集成步骤

1. 把 `build/2.x/bundle.js` 下载到 `assets/scripts/sensorswave/bundle.js`
2. 在 Cocos Creator 编辑器右侧 **属性检查器** 勾选 **"导入为插件"**
3. 业务代码里直接用全局 `Sensorswave`

#### 需要尽早 init 时（可选）

新建 `assets/scripts/SdkManager.js`（也**勾选"导入为插件"**），实现"selfInit + 100ms 轮询 fallback"模式。bundle 加载后自动调 `Sensorswave.init()`。

### 2.3 iOS 集成

> 2.x **不**走 CMake `CC_PROJ_SOURCES`，而是直接生成 Xcode 工程。桥接文件需要手动加到 Xcode 工程（拖入 + 链 framework），**不**改 `CMakeLists.txt`，也**不**用 `build-templates`。
>
> 2.x 没有 `native/engine/ios/`（那是 3.x 才有的概念），原生工程**直接**在 `build/` 下面，具体路径取决于 Build 面板选的模板（`jsb-link` / `jsb-default`），下面用 `jsb-link` 演示。
>

**前置**：先在 Cocos Creator 编辑器里 Build → iOS 一次（Template 选 `jsb-link`，不要改），生成 `build/jsb-link/frameworks/runtime-src/proj.ios_mac/` 目录。

#### 步骤 1：复制桥接文件到 Xcode 工程

```bash
mkdir -p build/jsb-link/frameworks/runtime-src/proj.ios_mac/ios/Classes
cp node_modules/@sensorswave/cocoscreator-sdk/native/ios/SensorsWaveBridge.mm \
   build/jsb-link/frameworks/runtime-src/proj.ios_mac/ios/Classes/
```

#### 步骤 2：把 `.mm` 加到 Compile Sources + 链 Network.framework

用 Xcode 打开工程：

```bash
open build/jsb-link/frameworks/runtime-src/proj.ios_mac/demo2.xcodeproj
```

在 Xcode UI 里做两件事：

1. 把左侧 `ios/Classes/SensorsWaveBridge.mm` **拖**到 `demo2-mobile` target 的 **Build Phases → Compile Sources** phase
2. **Build Phases → Link Binary With Libraries** → `+` → 添加 `Network.framework`

#### 步骤 3：用 Xcode 编译运行

```bash
# Xcode: ⇧⌘K (Clean Build Folder) → ⌘R (Build & Run)
# 不需要再回 Cocos Creator Build 了
```

#### 验证

启动 App 后，业务方触发一个事件，上报数据里 `$app_id` / `$app_name` / `$app_version` / `$region` / `$network_type` / `$wifi` 不再为空。

***

### 2.4 Android 集成

**前置**：先在 Cocos Creator 编辑器里 Build → Android 一次（Template 选 `jsb-link`），生成 `build/jsb-link/frameworks/runtime-src/proj.android-studio/app/` 目录。

#### 步骤 1：复制桥接文件（**注意是 android-2.x 目录**）

```bash
mkdir -p build/jsb-link/frameworks/runtime-src/proj.android-studio/app/src/com/sensorswave/cocoscreator/
cp node_modules/@sensorswave/cocoscreator-sdk/native/android-2.x/SensorsWaveBridge.java \
   build/jsb-link/frameworks/runtime-src/proj.android-studio/app/src/com/sensorswave/cocoscreator/
```

> ⚠️ **必须用** **`android-2.x/`** **目录**，不能用 `android/` 目录。3.x 用的 `org.cocos2dx.javascript` 包路径，2.x 用的是 `org.cocos2dx.lib`，import 路径不同。

#### 步骤 2：注册 ContentProvider

编辑 `build/jsb-link/frameworks/runtime-src/proj.android-studio/app/AndroidManifest.xml`，在 `</application>` 前插入：

```xml
<provider
    android:name="com.sensorswave.cocoscreator.SensorsWaveBridge"
    android:authorities="${applicationId}.sensorswave.bridge"
    android:exported="false"
    android:initOrder="9999" />
```

#### 步骤 3：清缓存 + 重新构建

```bash
rm -rf build
# 在 Cocos Creator 里 Build Android
# 用 Android Studio 打开 build/jsb-link/frameworks/runtime-src/proj.android-studio/ 编译 APK
```

#### 验证

业务方触发一个事件，上报数据里 `$app_id` / `$app_name` / `$app_version` / `$region` / `$model` / `$brand` / `$manufacturer` 不再为空。

***

> ⚠️ 2.x 不支持 HarmonyOS 端。

***

## 3. 通用 API

### 3.1 配置选项

| 选项                  | 类型                                                    | 默认值      | 说明                                                                                                                     |
| ------------------- | ----------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `apiHost`           | string                                                | **必填**   | 数据上报服务器地址                                                                                                              |
| `debug`             | boolean                                               | `false`  | 是否启用调试日志（开启后输出 init / 上报 post body data 两类日志）                                                                          |
| `autoCapture`       | boolean                                               | `true`   | 是否自动采集生命周期事件（`$AppStart` / `$AppEnd` / `$MPLaunch` / `$MPShow` / `$MPHide` / `$PageView` / `$PageLoad` / `$PageLeave`） |
| `batchSend`         | boolean                                               | `false`  | 是否启用批量发送                                                                                                               |
| `enableAB`          | boolean                                               | `false`  | 是否启用 A/B 测试功能                                                                                                          |
| `abRefreshInterval` | number                                                | `600000` | A/B 测试配置刷新间隔（毫秒，默认 10 分钟，最小 30 秒）                                                                                      |
| `enableShareTrack`  | boolean                                               | `true`   | 是否自动采集小游戏分享事件（仅小游戏端生效）                                                                                                 |
| `enableCrashTrack`  | boolean                                               | `false`  | 是否采集 App 原生崩溃（`$Exception` 事件，`$exception_level = 'fatal'`，下次启动补报）。仅 App 端（iOS / Android / HarmonyOS）生效，且需集成原生桥文件（HarmonyOS 另需 filesDir 转发，见 1.5 步骤 2 修改 3；其余见 4.4） |
| `enableErrorTrack`  | boolean                                               | `false`  | 是否自动采集 JS 未捕获异常与 Promise rejection（`$Exception` 事件，`$exception_level = 'error'`）。App / 小游戏 / H5 全端生效（HarmonyOS 需集成 C++ hook 且不采集 Promise rejection，见 1.5 步骤 3）                    |
| `optOutCapturing`   | boolean                                               | `false`  | 【合规】初始化即禁用采集。SDK 启动后处于静默状态：不写本地标识符、不发任何事件与请求，等用户授权后调用 `optInCapturing()` 开启                |
| `persistOptOut`     | boolean                                               | `false`  | 【合规】是否将 opt-out 状态持久化到本地存储。`true` 时状态跨会话保留（重启后恢复）；`false` 时仅存内存，重启后回到采集开启                |

### 3.2 事件追踪

#### `trackEvent(eventName, properties?)`

追踪一个自定义事件，可附带事件属性。

```typescript
Sensorswave.trackEvent('LevelComplete', {
  level: 5,
  score: 1200,
  time_used: 65,
});
```

| 参数           | 类型                    | 必填 | 说明   |
| ------------ | --------------------- | -- | ---- |
| `eventName`  | string                | ✓  | 事件名称 |
| `properties` | `Record<string, any>` | ✗  | 事件属性 |

#### `track(eventData)`

追踪一个完整结构的事件，可指定用户属性和主体属性。适用于需要同时上报用户属性的场景。

```typescript
Sensorswave.track({
  event: 'VIPUpgraded',
  properties: {
    vip_level: 2,
    upgrade_type: 'purchase',
  },
  user_properties: {
    $set: { vip_level: 2 },
    $increment: { total_recharge: 30 },
  },
});
```

`eventData` 字段：

- `event`（string，必填）：事件名称
- `properties`（Record\<string, any>，可选）：事件属性
- `user_properties`（object，可选）：用户属性操作，支持 `$set` / `$set_once` / `$increment` / `$append` / `$union` / `$unset` / `$delete`
- `subject_properties`（Record\<string, any>，可选）：主体属性

#### `trackException(throwable, properties?)`

手动上报一个已捕获的异常（`$Exception` 事件，`$exception_level` 固定为 `error`）。
适用于业务方在 `try/catch` 中上报不影响主流程的异常。**不受** `enableErrorTrack` / `enableCrashTrack` 开关限制；opt-out 期间不上报；永不抛异常。

```typescript
try {
  riskyOperation();
} catch (e) {
  Sensorswave.trackException(e, { scene: 'battle' });
}
```

| 参数           | 类型                    | 必填 | 说明                                                                                                                    |
| ------------ | --------------------- | -- | --------------------------------------------------------------------------------------------------------------------- |
| `throwable`  | unknown               | ✓  | `Error` 对象、`"Uncaught TypeError: xxx"` 形态字符串或任意值（防御式规范化，不会抛异常）                                         |
| `properties` | `Record<string, any>` | ✗  | 附加属性（5 个 `$exception_*` 专属属性优先级更高，同名用户 key 会被覆盖）                                                       |

### 3.3 用户标识

| 方法                    | 说明                                                            |
| --------------------- | ------------------------------------------------------------- |
| `identify(loginId)`   | 设置用户登录 ID，并发送 `$Identify` 事件关联匿名行为与登录用户。**登录 ID 未变化则不会重复发送**。 |
| `setLoginId(loginId)` | 设置用户登录 ID，**不发送**关联事件。适用于恢复登录状态等场景。                           |
| `reset(resetAnonId?)` | 用户登出时调用，解除登录 ID 与设备的绑定。默认保留匿名 ID；传 `true` 同时重置匿名 ID。同时清除 AB 实验缓存。**不发送**任何事件。 |
| `getLoginId()`        | 获取当前登录 ID，返回 `string`。                                        |
| `getAnonId()`         | 获取当前匿名 ID（SDK 初始化时自动生成并持久化），返回 `string`。                      |
| `getSessionId()`      | 获取当前会话 ID（UUIDv7，SDK 自动生成并注入所有事件的 `$session_id`），返回 `string`；init 前或 opt-out（禁用采集）期间返回空字符串。 |

```typescript
// 登录
Sensorswave.identify('user_12345');

// 恢复登录状态（不发送事件）
Sensorswave.setLoginId('user_12345');

// 用户登出时
Sensorswave.reset();  // 默认保留匿名 ID

// 如果需要同时重置匿名 ID（如公共设备场景）
Sensorswave.reset(true);
```

> 说明：
> - `reset()` 仅清除登录 ID；`reset(true)` 会生成**新的匿名 ID**（下次 `getAnonId()` 时惰性生成），此前的匿名 ID 不再使用。
> - 两种形式均会清除 AB 实验缓存（实验分组与用户身份绑定，登出后不沿用登录用户的分组结果）。
> - init 前调用为空操作；opt-out（禁用采集）期间为空操作。
> - `getSessionId()` 返回的会话在超过 30 分钟无事件活动、持续超过 12 小时或调用 `reset()` 后轮转为新会话；同一浏览器的多个标签页/窗口共享同一会话。

### 3.4 用户属性

| 方法                             | 说明                                       |
| ------------------------------ | ---------------------------------------- |
| `profileSet(properties)`       | 设置用户属性，已存在的属性将被覆盖。                       |
| `profileSetOnce(properties)`   | 设置用户属性，**仅在属性不存在时生效**（首次设置），已存在的属性不会被覆盖。 |
| `profileIncrement(properties)` | 对数值型用户属性递增（可为负数）。仅支持数值类型。                |
| `profileAppend(properties)`    | 向列表型用户属性追加值，**不去重**。                     |
| `profileUnion(properties)`     | 向列表型用户属性追加值，**自动去重**。                    |
| `profileUnset(keys)`           | 将指定用户属性设置为 null（等效于删除）。                  |
| `profileDelete()`              | 删除当前用户的所有属性数据，**不可撤销**。                  |

```typescript
Sensorswave.profileSet({
  nickname: '玩家一号',
  vip_level: 2,
  server: 'cn-east',
});

Sensorswave.profileSetOnce({
  first_launch_date: '2024-01-15',
  initial_channel: 'app_store',
});

sensorsSensorswavewave.profileIncrement({
  total_recharge: 30,
  login_count: 1,
  total_play_time: 65,
});

Sensorswave.profileUnion({
  purchased_items: ['sword', 'shield'],
  achievements: ['first_kill'],
});

Sensorswave.profileUnset(['temp_flag', 'expired_promo']);
Sensorswave.profileDelete();
```

### 3.5 公共属性

#### `registerCommonProperties(properties)`

注册公共属性，附加到后续所有事件。支持静态值和动态函数（每次发送事件时求值）。

```typescript
Sensorswave.registerCommonProperties({
  server_id: 'cn-east-1',
  game_version: '1.0.0',
  current_level: () => getPlayerLevel(),
});
```

> 说明：会话 ID 无需手动注册——SDK 已自动在所有事件中注入 `$session_id`（见预置属性文档「会话相关属性」）。如需读取当前会话 ID，调用 `Sensorswave.getSessionId()`。

#### `clearCommonProperties(keys?)`

移除已注册的公共属性。`keys` 不传则清除全部。

```typescript
Sensorswave.clearCommonProperties(['temp_promo', 'debug_flag']);
Sensorswave.clearCommonProperties();
```

### 3.6 A/B 测试

> 使用 A/B 测试前，需在初始化时设置 `enableAB: true`。

| 方法                      | 返回                                     | 说明                                |
| ----------------------- | -------------------------------------- | --------------------------------- |
| `checkFeatureGate(key)` | `Promise<boolean>`                     | 检查功能开关（Feature Gate）是否对当前用户开启     |
| `getFeatureConfig(key)` | `Promise<Record<string, any>>`         | 获取功能配置（Feature Config），未找到返回 `{}` |
| `getExperiment(key)`    | `Promise<Record<string, any>>` | 获取实验（Experiment）变体配置，未找到返回 `{}` |

```typescript
Sensorswave.checkFeatureGate('new_battle_ui')
  .then(isEnabled => {
    if (isEnabled) showNewBattleUI();
    else showOldBattleUI();
  });

const config = await Sensorswave.getFeatureConfig('difficulty_config');
if (Object.keys(config).length > 0) {
  const { enemy_hp_multiplier, drop_rate } = config;
  applyDifficulty(enemy_hp_multiplier, drop_rate);
}

const experiment = await Sensorswave.getExperiment('theme_exp');
if (Object.keys(experiment).length > 0) {
  const { theme_color, layout } = experiment;
  applyTheme(theme_color, layout);
}
```

### 3.7 合规采集开关（opt-out）

满足隐私合规场景（如 GDPR / 用户授权采集）：在拿到用户授权前禁用采集，授权后再开启。

> 默认行为（`optOutCapturing` 不设或为 `false`）：SDK 一启动即采集，无需调用本节 API。

#### 初始化即禁用（推荐）

```typescript
Sensorswave.init('your-source-token', {
  apiHost: 'https://your-api-host.com',
  optOutCapturing: true, // 启动即静默，等用户授权
});

// 用户同意《隐私政策》后，业务方主动开启采集
Sensorswave.optInCapturing();
```

#### 状态持久化（跨会话保留）

默认情况下 opt-out 状态仅存内存，App 重启后回到「采集开启」。若希望用户的选择跨会话保留，设置 `persistOptOut: true`：

```typescript
Sensorswave.init('your-source-token', {
  apiHost: 'https://your-api-host.com',
  optOutCapturing: true, // 首次启动默认禁用
  persistOptOut: true,   // 用户授权后，opt-in 状态持久化；重启后保持已授权
});
```

> 开启 `persistOptOut` 后，`optOutCapturing()` / `optInCapturing()` 会将状态写入本地存储（`sw_opt_out`），下次 `init` 自动恢复，**业务方无需自行维护用户授权状态**。

#### API

| 方法                      | 返回       | 说明                                                            |
| ----------------------- | -------- | ------------------------------------------------------------- |
| `optOutCapturing()`     | `void`   | 禁用采集。调用后 SDK 静默：不读隐私、不写本地、不发任何事件/请求。可在 `init()` 前调用（仅置内存标记）。 |
| `optInCapturing()`      | `void`   | 允许采集。恢复上报；若初始化时处于 opt-out 且初始 UTM 的 `$UserSet` 尚未发送，则补发一次（多次调用只补发一次）。 |
| `hasOptedOutCapturing()` | `boolean` | 返回当前是否处于禁用采集状态。                                              |

```typescript
// 主动禁用（例如用户撤回授权）
Sensorswave.optOutCapturing();
Sensorswave.hasOptedOutCapturing(); // true

// 恢复采集
Sensorswave.optInCapturing();
Sensorswave.hasOptedOutCapturing(); // false
```

***

## 4. 自动采集事件

当 `autoCapture: true` 时，SDK 会根据当前运行平台自动采集以下事件。

### 4.1 App 端（iOS / Android / HarmonyOS，3.x）

| 事件            | 触发时机         | 特殊属性                        |
| ------------- | ------------ | --------------------------- |
| `$AppInstall` | 首次启动（检测到新安装） | —                           |
| `$AppStart`   | 应用从后台切到前台    | —                           |
| `$AppEnd`     | 应用从前台切到后台    | `$event_duration`（前台停留时长，秒） |

### 4.2 小游戏端

| 事件          | 触发时机                               | 特殊属性                        |
| ----------- | ---------------------------------- | --------------------------- |
| `$MPLaunch` | 小游戏冷启动                             | —                           |
| `$MPShow`   | 小游戏从后台切到前台                         | —                           |
| `$MPHide`   | 小游戏从前台切到后台                         | `$event_duration`（前台停留时长，秒） |
| `$MPShare`  | 用户触发分享（需 `enableShareTrack: true`） | —                           |

### 4.3 H5 端

| 事件           | 触发时机   | 特殊属性                                  |
| ------------ | ------ | ------------------------------------- |
| `$PageView`  | 页面初始化  | —                                     |
| `$PageLoad`  | 页面加载完成 | `$page_load_time`（加载耗时，毫秒）            |
| `$PageLeave` | 用户离开页面 | `$event_duration`（页面停留时长，秒，上限 432000） |

### 4.4 异常捕获（全端）

上报 `$Exception` 事件

| 属性                  | 说明                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------- |
| `$exception_level`  | `fatal`（未捕获异常导致进程终止 / App crash，均为下次启动补报）/ `error`（其他）                          |
| `$exception_type`   | 异常类全名（JS：`TypeError` / `ReferenceError` 等；原生：`java.lang.NullPointerException` / `NSException` 等；iOS 信号兜底为信号名 `SIGSEGV` / `SIGABRT` 等） |
| `$exception_message` | 仅 message，不含堆栈                                                                        |
| `$exception_frames` | 结构化帧数组（最多 30 帧，最外层在前）；帧含 `platform`（`web:javascript` / `java` / `cocoa` / `native` 多端路由；iOS 原生帧归 `cocoa`，服务端据此选 dSYM 符号化器）、`filename`（清洗后路径）、`function`（匿名为 `"?"`）、`lineno`/`colno`（数字；Java/iOS 无 colno）、`abs_path`（仅 web，清洗前原始 URL）、`module`（Java 全限定类名 / iOS 镜像名 / native so 基名）、`instruction_addr`（仅 cocoa/native 帧，运行时指令地址，16 位补零小写 hex，服务端符号化 key）、`image_addr`（仅 iOS，镜像运行时基址，服务端 dSYM 符号化入参）、`debug_id`（仅 iOS 主二进制帧，LC_UUID）字段，详见预置属性定义 |

**平台矩阵与开关**（两开关均独立于 `autoCapture`，默认关闭）：

| 端           | `enableErrorTrack`（error 级自动采集）                    | `enableCrashTrack`（fatal 级崩溃补报）                    |
| ----------- | -------------------------------------------------- | -------------------------------------------------- |
| App（iOS / Android） | ✓ JS 未捕获异常（引擎 `__errorHandler`）+ Promise rejection | ✓ 原生未捕获异常 + iOS 信号级崩溃（下次启动补报）                          |
| App（HarmonyOS） | ✓ JS 未捕获异常（jsvm 无 `__errorHandler`，**必须集成 C++ hook**，见 1.5 步骤 3）；✗ Promise rejection（平台限制，见限制 1） | ✓ 系统 `APP_CRASH` / `APP_FREEZE` 补报（**必须集成 filesDir 转发**，见 1.5 步骤 2 修改 3） |
| 小游戏        | ✓ `onError` + `onUnhandledRejection`（按平台探测）        | —（忽略）                                             |
| H5          | ✓ `window.onerror` + `unhandledrejection`             | —（忽略）                                             |

**fatal 补报机制（App 端）**：

1. 原生桥捕获崩溃并落盘（最多 10 条，30 天过期）：iOS `NSSetUncaughtExceptionHandler`（NSException）+ 信号兜底（`sigaction` 接管 `SIGABRT` / `SIGSEGV` / `SIGBUS` / `SIGILL` / `SIGFPE` / `SIGTRAP`，**落盘后链式重抛**——恢复崩溃前 handler 重投递原信号，进程按默认行为终止，系统崩溃报告照常生成，不影响第三方崩溃 SDK）/ Android `Thread.setDefaultUncaughtExceptionHandler`（**链式调用**原 handler，不影响第三方崩溃 SDK）；HarmonyOS 用 `hiAppEvent` watcher 订阅系统 `APP_CRASH` / `APP_FREEZE` 故障事件——**不拦截**未捕获异常，进程保持默认崩溃退出，系统 faultlogger 采集故障，下次启动 watcher 收到补报事件（含 native 崩溃与卡死，鸿蒙无需额外权限）
2. 下次启动原生桥把落盘记录注入 JS（`globalThis.__sensorswave_pending_crashes__`），SDK init 时按 JS 侧**水位线**（`sw_last_crash_ts`）过滤补报——原生永不删除已注入记录，三端统一、零数据丢失。HarmonyOS 故障补报异步到达，SDK init 后还会安排少量重检兜底（水位线保证零重复）
3. 手动上报用 `trackException(throwable, properties?)`（见 3.2），不受开关限制
4. **符号化前提（集成方需配合归档发布产物）**：服务端按帧 `debug_id`（iOS，LC_UUID）/ `module` + `instruction_addr` 还原符号。iOS 每次构建产生的 dSYM（UUID 与构建一一对应）需在发布后归档并按平台要求提供；Android 混淆构建需保留 `mapping.txt`。未提供时帧保持地址形态（`instruction_addr` / `image_addr`），仍可按版本聚合

**防洪水**：自动采集同 `type + message` 30 秒去重窗口；单会话（自动 + 手动合计）上限 20 条，超出丢弃；每次上报后立即 flush。

**限制（如实声明）**：

1. App 端 JS 未捕获异常（`__errorHandler` 触发时进程通常未终止）只报 error 级；JS 异常最终致进程终止且未经原生 handler 的 fatal 会丢失。HarmonyOS（jsvm 后端）没有 `__errorHandler`，error 级采集依赖 C++ hook（见 1.5 步骤 3）；**Promise rejection 在鸿蒙不采集**——jsvm 的微任务 rejection 不经过 JS↔native 调用边界，无钩子可挂（真机实证）
2. Android 不覆盖信号级崩溃（SIGSEGV / SIGABRT）、ANR、JNI 内 native crash；iOS 信号兜底采集的帧**未符号化**——仅主二进制帧携带镜像名（SDK 按崩溃时刻镜像表回填 `image_addr` / `debug_id`），系统帧 `module` 为 `unknown`，需服务端 dSYM 符号化；HarmonyOS 的 native 崩溃（`CPP_CRASH`）与卡死（`APP_FREEZE`）由 hiAppEvent 覆盖
3. 小游戏部分平台无 `offError` / `offUnhandledRejection`，destroy 无法完全卸载钩子
4. **App 端 fatal 能力要求业务方更新到新版原生桥文件**；旧桥下静默降级（读不到注入，不报错）。HarmonyOS 旧桥（errorManager / preferences 方案）升级后行为变更：未捕获 ArkTS 异常不再被拦截（进程按系统默认行为崩溃退出；另经真机实证，classic worker 里的未捕获 ArkTS 异常本就不会杀死进程），且崩溃记录落盘改用 `@ohos.file.fs`——必须完成 1.5 步骤 2 修改 3 的 filesDir 转发，否则补报静默失效
5. 补报事件 `time` 为补报时刻而非崩溃发生时刻（崩溃发生时刻随原生落盘记录的时间戳参与水位线去重，不作为事件属性上报）

***

## 7. UTM 渠道追踪

SDK 自动提取以下 UTM 参数并附加到所有事件中：

| 参数             | 说明   |
| -------------- | ---- |
| `utm_source`   | 流量来源 |
| `utm_medium`   | 媒介   |
| `utm_campaign` | 活动名称 |
| `utm_content`  | 内容   |
| `utm_term`     | 关键词  |

- **首次 UTM**：记录为 `$initial_utm_*`，仅记录一次
- **当次 UTM**：附加到本次会话的所有事件中
- **获取来源**：小游戏端从启动参数获取，App 端从 Deep Link 获取

***

## 8. 常见问题

### Q1: 集成 SDK 后没有数据上报？

1. **App 端**：确认 `SensorsWaveBridge` 已复制到原生工程目录，且已注册（CMakeLists / AndroidManifest / cocos\_worker.ets）
2. **2.x 端**：确认 `bundle.js` 在 `assets/scripts/sensorswave/bundle.js` 路径下，文件名不能改
3. **小游戏端**：检查 `apiHost` 域名是否在小程序后台 request 合法域名列表
4. 打开 `debug: true` 看 init 是否成功，看是否有数据上报

### Q2: 部分预置属性为空？
1. 确认 Native Bridge 已完整的集成。

### Q3: Cocos Creator 2.x 报 `Cannot find module '..'`？

`bundle.js` 路径必须是 `assets/scripts/sensorswave/bundle.js`，plugin-script loader 写死这个路径。

### Q4: HarmonyOS 端 `$app_name` 一直为空？

这是已知架构限制。bridge 拿不到 `appInfo.label`（`$string:app_name` 资源引用），请用 `registerCommonProperties({ $app_name: 'xxx' })` 覆盖。

***

## 9. 许可证

Apache License 2.0
