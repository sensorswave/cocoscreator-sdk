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

打开 `native/engine/harmonyos-next/entry/src/main/ets/workers/cocos_worker.ets`，做两处修改：

**修改 1**：在 `import '../cocos/oh-adapter/sys-ability-polyfill';` 后面加 import：

```typescript
import '../cocos/oh-adapter/sys-ability-polyfill';
import { injectSensorsWaveAppInfo } from '../cocos/SensorsWaveBridge';
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

#### 步骤 3：直接 DevEco Studio 编译 HAP

#### 验证

启动 App 后，业务方触发一个事件，上报数据里 `$app_id` / `$app_version` / `$region` / `$model` / `$brand` / `$manufacturer` / `$network_type` / `$wifi` 不再为空。

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

新建 `assets/scripts/SdkManager.js`（也**勾选"导入为插件"**），实现"selfInit + 100ms 轮询 fallback"模式。bundle 加载后自动调 `Sensorswave.init()`，业务代码进 page 时 `SdkManager.ensureSDKInitialized()` 兜底。

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

### 3.3 用户标识

| 方法                    | 说明                                                            |
| --------------------- | ------------------------------------------------------------- |
| `identify(loginId)`   | 设置用户登录 ID，并发送 `$Identify` 事件关联匿名行为与登录用户。**登录 ID 未变化则不会重复发送**。 |
| `setLoginId(loginId)` | 设置用户登录 ID，**不发送**关联事件。适用于恢复登录状态等场景。                           |
| `getLoginId()`        | 获取当前登录 ID，返回 `string`。                                        |
| `getAnonId()`         | 获取当前匿名 ID（SDK 初始化时自动生成并持久化），返回 `string`。                      |

```typescript
// 登录
Sensorswave.identify('user_12345');

// 恢复登录状态（不发送事件）
Sensorswave.setLoginId('user_12345');
```

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
  session_id: () => getSessionId(),
});
```

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
