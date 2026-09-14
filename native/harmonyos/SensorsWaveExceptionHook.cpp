/****************************************************************************
 Copyright (c) 2026 SensorsWave. All rights reserved.

 鸿蒙（jsvm JSB 后端）未捕获 JS 异常 → SDK 的桥接 hook。

 背景（引擎源码实证，Cocos Creator 3.8.8）：
   - v8 / sm 后端在未捕获异常时会调用游戏 JS 的 globalThis.__errorHandler，
     SDK 的 exception 插件靠包装它采集 Error 级 $Exception；
   - jsvm 后端没有这条通道：异常只走 C++ 侧
       logJsException (jswrapper/jsvm/Utils.cpp)
         → ScriptEngine::getExceptionCallback()
         → CocosApplication::init 里设置的默认 handler（只 CC_LOG_ERROR）。
     __errorHandler 与 jsb.onError 在 jsvm 下都是死 API。

 方案（唯一非侵入挂点）：
   libcocos.so 链接期用 -Wl,--wrap=_Z24jsb_register_all_modulesv 接管
   CocosApplication::init() 对 jsb_register_all_modules() 的调用：
     1. 先跑真身（引擎全部绑定照常注册，jsb 对象在 se->start() 时定义）；
     2. 再把我们自己的注册回调 addRegisterCallback 插到队尾——此刻
        ScriptEngine 实例已存在、尚未 start()，回调会在 start() 时随引擎
        回调一起执行，往 jsb 对象上 defineFunction("swInstallExceptionHook")。
   游戏 JS（SDK exception 插件）特性探测到该函数后调用它：
     - 保存 JS handler（root 防 GC）；
     - 用 setExceptionCallback 换掉 CocosApplication::init 设的默认槽位
       （init 先 setExceptionCallback 再 jsb_register_all_modules，
        所以我们的换槽必然发生在其后、start() 之前，后者胜出）；
   异常发生时把 jsvm 的 3 参 (location, message, stack) 补成与 v8
   __errorHandler 相同的 4 元组 (location, linenum=0, message, stack)
   转发给 JS handler——exception.ts 复用同一条 normalizeCocosErrorHandler。

 集成：本文件由 demo/fix-native-bridge.sh 复制到
   demo/native/engine/harmonyos-next/ 并通过 CMakeLists.txt 的
   CC_PROJ_SOURCES 编入 libcocos.so（见该脚本与 CMakeLists 注释）。

 ⚠️ --wrap 的符号名是 Itanium C++ 修饰名（c++filt 可验证）：
      _Z24jsb_register_all_modulesv → jsb_register_all_modules()
    若wrap 失败（引擎升级改名），链接不报错、jsb 函数不出现，
    SDK 侧特性探测失败仅记录日志跳过——优雅降级，不会崩溃。
****************************************************************************/

#include "cocos/bindings/jswrapper/SeApi.h"

#include "base/Log.h"

namespace {

/** 游戏 JS 注册进来的 handler（root 持有，SDK 生命周期 = 进程生命周期） */
se::Value g_swExceptionHandler;

/** 重入门闩：handler 自身再抛异常时 jsvm 会回调本槽位，无此门闩将无限递归 */
bool g_swHookInFlight = false;

/**
 * jsvm 异常 → 游戏 JS handler。
 * 与引擎 v8 侧 __errorHandler 的调用约定一致：4 元组
 * (location, linenum, message, stack)；handler 抛异常只记日志不上抛。
 */
void swDispatchExceptionToJs(const char *location, const char *message, const char *stack) {
    if (g_swHookInFlight) {
        SE_LOGE("SensorsWave: exception handler re-entered, skip (possible throw inside handler)\n");
        return;
    }
    if (!g_swExceptionHandler.isObject() || !g_swExceptionHandler.toObject()->isFunction()) {
        return;
    }

    g_swHookInFlight = true;
    se::ValueArray args;
    args.emplace_back(se::Value(location ? location : ""));
    args.emplace_back(se::Value(0));
    args.emplace_back(se::Value(message ? message : ""));
    args.emplace_back(se::Value(stack ? stack : ""));
    if (!g_swExceptionHandler.toObject()->call(args, nullptr)) {
        // handler 自身抛异常：jsvm 会把 pending exception 再次送回本槽位，
        // 由上方 g_swHookInFlight 门闩截断递归
        SE_LOGE("SensorsWave: exception handler threw\n");
    }
    g_swHookInFlight = false;
}

/**
 * jsb.swInstallExceptionHook(handler)：
 * 游戏 JS（SDK exception 插件）注册异常 handler 并接管 jsvm 异常回调槽位。
 * 幂等：重复安装先 unroot 旧 handler 再替换（不泄漏、不悬垂）。
 */
bool js_sw_install_exception_hook(se::State &s) {
    const auto &args = s.args();
    if (args.empty() || !args[0].isObject() || !args[0].toObject()->isFunction()) {
        s.rval().setBoolean(false);
        SE_LOGE("SensorsWave: swInstallExceptionHook expects a function argument\n");
        return true;
    }

    se::Object *handler = args[0].toObject();
    if (g_swExceptionHandler.isObject() && g_swExceptionHandler.toObject() != nullptr) {
        g_swExceptionHandler.toObject()->unroot();
    }
    handler->root(); // 防 GC（SDK 单例持有到进程结束）
    g_swExceptionHandler = se::Value(handler);

    se::ScriptEngine::getInstance()->setExceptionCallback(
        [](const char *location, const char *message, const char *stack) {
            // 接管 CocosApplication::init 设置的默认槽位（只打日志）；
            // 未就绪/自身异常时退回引擎默认行为，日志不丢
            if (!g_swHookInFlight) {
                CC_LOG_ERROR("ERROR: Uncaught JS exception: %s", message ? message : "(null)");
            }
            swDispatchExceptionToJs(location, message, stack);
        });

    CC_LOG_INFO("SensorsWave: swInstallExceptionHook installed (jsvm exception channel)");
    s.rval().setBoolean(true);
    return true;
}
SE_BIND_FUNC(js_sw_install_exception_hook)

/**
 * jsb.swRaiseTestNativeCrash()：【仅调试】故意制造 native 崩溃（SIGABRT），
 * 验证 fatal 补报链路。
 *
 * ⚠️ 为什么必须 native 崩溃（真机实证 2026-09-14）：classic worker 线程的
 * 未捕获 ArkTS 异常**不会**杀死进程——ArkCompiler 只触发 HandleUncaughtException
 * 记日志，进程和 worker 都活着（faultlogger 无从采集，补报链路无源）。
 * native abort 产生 CPP_CRASH，系统 faultlogger 必然采集，下次启动 watcher
 * 收到补报事件 → $Exception(level=fatal)。
 */
bool js_sw_raise_test_native_crash(se::State &s) {
    CC_LOG_ERROR("SensorsWave: raising test native crash (abort) — fatal channel verification");
    abort();
    return true;
}
SE_BIND_FUNC(js_sw_raise_test_native_crash)

/**
 * 注册回调：se->start() 时由引擎调用（队尾，此时引擎已定义 jsb 对象）。
 */
bool sw_register_exception_hook(se::Object *global) {
    se::Value jsbVal;
    if (!global->getProperty("jsb", &jsbVal) || !jsbVal.isObject()) {
        // 引擎未定义 jsb（理论上不会）：静默放弃，SDK 侧特性探测不到即跳过
        return true;
    }
    jsbVal.toObject()->defineFunction("swInstallExceptionHook", _SE(js_sw_install_exception_hook));
    jsbVal.toObject()->defineFunction("swRaiseTestNativeCrash", _SE(js_sw_raise_test_native_crash));
    return true;
}

} // namespace

// --wrap 接管点：CocosApplication::init() 里
//   se->setExceptionCallback(默认 handler)  ← 先执行
//   jsb_register_all_modules()              ← 被本包装函数接管
//   se->start()                             ← 注册回调在这里执行
// 时序保证：我们的 addRegisterCallback 发生在换槽之前、start() 之前。
extern "C" bool __real__Z24jsb_register_all_modulesv();
extern "C" bool __wrap__Z24jsb_register_all_modulesv() {
    const bool ok = __real__Z24jsb_register_all_modulesv();
    se::ScriptEngine *se = se::ScriptEngine::getInstance();
    if (se != nullptr) {
        se->addRegisterCallback(sw_register_exception_hook);
    }
    return ok;
}
