//
//  SensorsWaveBridge.mm
//  SensorsWave SDK - Cocos Creator 设备信息桥接
//
//  集成步骤：
//  1. 把本文件拖到 Xcode 工程的 Compile Sources phase（必须加，否则 .o 会被静态库 strip）
//  2. Build Phases → Link Binary With Libraries → + Network.framework
//  3. SDK 启动后自动注入 globalThis.__sensorswave_app_info__ 和
//     globalThis.__sensorswave_network_type__，无需在 AppController.mm 写任何代码
//
//  兼容 Cocos Creator 2.4.x 和 3.x（两者都用 v8 jswrapper）
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <Network/Network.h>
#import <mach-o/dyld.h>
#import <mach-o/loader.h>
#import <signal.h>
#import <execinfo.h>
#import <fcntl.h>
#import <unistd.h>

// Cocos Creator 3.x 不同小版本的 se::ScriptEngine 头文件路径不同，依次尝试
#if __has_include("cocos/bindings/jswrapper/SeApi.h")
#include "cocos/bindings/jswrapper/SeApi.h"
#endif
#if __has_include("cocos/scripting/js-bindings/jswrapper/SeApi.h")
#include "cocos/scripting/js-bindings/jswrapper/SeApi.h"
#endif
#if __has_include("jswrapper/SeApi.h")
#include "jswrapper/SeApi.h"
#endif

using namespace std;

#define IsNullOrEmpty(s) ((s) == nil || [(s) length] == 0)

// 崩溃 handler（C 函数，位于 @interface 之前）需要调用类方法，ObjC++ 需前置声明
@class SensorsWaveBridge;

#pragma mark - Crash Capture（$Exception fatal 补报数据源）

/**
 * 未捕获异常处理器链：NSSetUncaughtExceptionHandler 接收的是 C 函数指针（不是 block），
 * 所以用文件级静态函数 + 静态变量保存原 handler。
 * ⚠️ 崩溃上下文里只做文件写入，绝不碰 JS 引擎（evalString / v8 global 都不行）。
 */
static NSUncaughtExceptionHandler *sPreviousUncaughtExceptionHandler = NULL;

/** NSException handler 已落盘标记：其链式返回后运行时 abort() 会再触发 SIGABRT，
 *  信号兜底 handler 据此避免同一次崩溃写两条记录 */
static volatile sig_atomic_t sSWCrashRecordWritten = 0;

static void sensorswaveUncaughtExceptionHandler(NSException *exception) {
    @try {
        NSMutableDictionary *record = [NSMutableDictionary dictionary];
        record[@"type"] = exception.name ?: @"NSException";
        record[@"message"] = exception.reason ?: @"";
        record[@"stack"] = [[exception callStackSymbols] componentsJoinedByString:@"\n"];
        record[@"timestamp"] = @((long long)([[NSDate date] timeIntervalSince1970] * 1000));
        // iOS 镜像表（基址 + 主二进制 LC_UUID）：服务端 dSYM 符号化原料；采集失败时缺省该字段
        NSArray *images = [SensorsWaveBridge collectStackImages:exception];
        if (images) {
            record[@"images"] = images;
        }
        [SensorsWaveBridge appendPendingCrashRecord:record];
        // 本条已落盘：后续 abort()（链式返回后运行时终止）触发的 SIGABRT 不再重复写
        sSWCrashRecordWritten = 1;
    } @catch (NSException *e) {
        // 崩溃 handler 里绝不能再抛
    }
    // 链式调用原 handler（保持第三方崩溃 SDK / 系统默认行为）
    if (sPreviousUncaughtExceptionHandler) {
        sPreviousUncaughtExceptionHandler(exception);
    }
}

#pragma mark - 致命信号兜底（NSException handler 覆盖不到的崩溃形态）

/**
 * 为什么需要信号兜底：实测（iOS 26.5 模拟器 / Rosetta）[NSException raise:] 触发的
 * C++ 两阶段异常展开会在 _Unwind_RaiseException 内部直接 SIGSEGV（personality
 * 例程野跳），NSUncaughtExceptionHandler 根本来不及执行 → 无任何记录落盘。
 * 真机上同样存在绕过 NSException 通道的崩溃：abort()、野指针 SIGSEGV/SIGBUS、
 * 非法指令 SIGILL、算术 SIGFPE 等。对致命信号安装兜底 handler（KSCrash /
 * Breakpad 同款做法）是唯一能接住这些形态的通道。
 *
 * 写盘策略：信号 handler 内不能触碰 ObjC runtime / malloc（会死锁或二次崩溃），
 * 所以——
 *   - 记录写到独立 sidecar 文件（整文件覆盖写，open/write/fsync/close），
 *     下次启动 loadPendingCrashRecords 把 sidecar 记录并入返回值
 *   - 路径 / 主二进制 images JSON 片段在安装期预计算进静态缓冲
 *   - backtrace / snprintf 严格说不在 async-signal-safe 白名单内，但缓冲全部
 *     预分配，是 KSCrash 等成熟崩溃采集的一致实践
 * 落盘后恢复崩溃前的 handler 并重抛原信号：系统崩溃报告与第三方 SDK 行为不受影响。
 */

/** sidecar 文件名（信号 handler 专用落盘，boot 时并入主记录文件） */
#define SW_SIGNAL_CRASH_FILE_NAME @"sensorswave_pending_crashes_signal.json"

// 以下缓冲全部预分配（信号 handler 内不能 malloc）
static char sSWSignalSidecarPath[1024];
static char sSWImagesJsonPrefix[1024];   // 形如 ,"images":[{"name":...,"base":"0x...",...}]，缺省为空串
static char sSWMainBaseHex[32];          // 主二进制基址（ASLR 每次启动不同，安装期固化）
static char sSWMainImageName[128];       // 主二进制镜像名（callStackSymbols 同构帧行用）
static uint64_t sSWMainImageSize = 0;    // 主二进制 __TEXT vmsize（帧归属判定用）
static void *sSWBacktraceFrames[64];
static char sSWStackBuf[3584];
static char sSWRecordBuf[6144];

static const int kSWFatalSignals[] = {SIGABRT, SIGSEGV, SIGBUS, SIGILL, SIGFPE, SIGTRAP};
static const char *kSWFatalSignalNames[] = {"SIGABRT", "SIGSEGV", "SIGBUS", "SIGILL", "SIGFPE", "SIGTRAP"};
static struct sigaction sSWPreviousSignalActions[sizeof(kSWFatalSignals) / sizeof(kSWFatalSignals[0])];

static int swFatalSignalIndex(int sig) {
    for (size_t i = 0; i < sizeof(kSWFatalSignals) / sizeof(kSWFatalSignals[0]); i++) {
        if (kSWFatalSignals[i] == sig) return (int)i;
    }
    return -1;
}

static void sensorswaveSignalHandler(int sig, siginfo_t *info, void *uap) {
    if (sSWCrashRecordWritten == 0) {
        const int frameCount = backtrace(sSWBacktraceFrames, 64);
        const long long tsMs = (long long)time(NULL) * 1000LL;

        // 逐帧写成与 callStackSymbols 未符号化帧同构的行：
        //   `序号 镜像名 0x地址 0x地址 + 偏移`
        // JS 侧 parseIosFrame 只认 `序号 镜像名 0x地址` 三段——裸地址行五类帧正则
        // 全不匹配 → 帧全部丢失 → $exception_frames 缺失；enrichIosFrames 按
        // 镜像名回填 image_addr / debug_id，所以镜像名必须出现在行里。
        // 主二进制帧用安装期固化的基址 + __TEXT vmsize 精确判定归属（可符号化）；
        // 系统镜像在 handler 内拿不到可靠大小（dyld 无 size API），统一记 unknown
        // ——信号兜底是 backstop，系统帧符号化交给 NSException 通道 / 系统崩溃报告。
        size_t pos = 0;
        sSWStackBuf[0] = '\0';
        const uintptr_t mainBase =
            sSWMainBaseHex[0] ? (uintptr_t)strtoull(sSWMainBaseHex, NULL, 16) : 0;
        const BOOL mainRangeValid =
            sSWMainImageName[0] && sSWMainImageSize > 0 && mainBase != 0;
        for (int i = 0; i < frameCount; i++) {
            const uintptr_t addr = (uintptr_t)sSWBacktraceFrames[i];
            char line[128];
            int n;
            if (mainRangeValid && addr >= mainBase && addr < mainBase + sSWMainImageSize) {
                n = snprintf(line, sizeof(line),
                             "%d  %s 0x%016llx 0x%016llx + %llu", i, sSWMainImageName,
                             (unsigned long long)addr, (unsigned long long)addr,
                             (unsigned long long)(addr - mainBase));
            } else {
                n = snprintf(line, sizeof(line),
                             "%d  unknown 0x%016llx 0x%016llx + 0", i,
                             (unsigned long long)addr, (unsigned long long)addr);
            }
            if (n <= 0 || pos + (size_t)n >= sizeof(sSWStackBuf) - 2) break;
            memcpy(sSWStackBuf + pos, line, (size_t)n);
            pos += (size_t)n;
            memcpy(sSWStackBuf + pos, "\\n", 2);  // JSON 字符串内的转义换行
            pos += 2;
        }
        sSWStackBuf[pos] = '\0';

        const int idx = swFatalSignalIndex(sig);
        const char *sigName = (idx >= 0) ? kSWFatalSignalNames[idx] : "SIGUNKNOWN";
        const int len = snprintf(
            sSWRecordBuf, sizeof(sSWRecordBuf),
            "[{\"type\":\"%s\",\"message\":\"Fatal signal %d (si_code=0x%x) captured by signal backstop\","
            "\"stack\":\"%s\",\"timestamp\":%lld%s}]",
            sigName, sig, info ? info->si_code : 0, sSWStackBuf, tsMs, sSWImagesJsonPrefix);
        if (len > 0 && sSWSignalSidecarPath[0]) {
            const int fd = open(sSWSignalSidecarPath, O_WRONLY | O_CREAT | O_TRUNC, 0644);
            if (fd >= 0) {
                const ssize_t ignored = write(fd, sSWRecordBuf, (size_t)len);
                (void)ignored;
                fsync(fd);
                close(fd);
            }
        }
    }
    sSWCrashRecordWritten = 1;

    // 链式重抛：解除本信号的阻塞 → 恢复崩溃前的 handler → 重投递原信号。
    // 上一任是 SIG_DFL 时进程按原信号终止（系统崩溃报告照常生成）；
    // 上一任 handler 返回（进程还活着）则交默认动作终止，避免回到崩溃现场死循环。
    sigset_t mask;
    sigemptyset(&mask);
    sigaddset(&mask, sig);
    sigprocmask(SIG_UNBLOCK, &mask, NULL);
    const int prevIdx = swFatalSignalIndex(sig);
    if (prevIdx >= 0) {
        sigaction(sig, &sSWPreviousSignalActions[prevIdx], NULL);
    }
    raise(sig);
    signal(sig, SIG_DFL);
    raise(sig);
    _exit(128 + sig);
}

@interface SensorsWaveBridge : NSObject
+ (NSString *)pendingCrashFilePathWithName:(NSString *)fileName;
+ (void)installSignalBackstop;
@end

@implementation SensorsWaveBridge

+ (void)load {
    NSLog(@"[SensorsWaveBridge] +load triggered, will inject device info later");

    // 崩溃捕获要尽早安装（+load 是最早的钩子），否则引擎启动阶段的崩溃拿不到
    [SensorsWaveBridge installCrashHandler];

    se::ScriptEngine *engine = se::ScriptEngine::getInstance();
    if (engine) {
        engine->addAfterInitHook([]() {
            @autoreleasepool {
                [SensorsWaveBridge injectAppInfo];
                [SensorsWaveBridge injectAndMonitorNetwork];
                [SensorsWaveBridge injectPendingCrashes];
            }
        });
    }

    // 兜底：addAfterInitHook 因任何原因没跑时 retry 注入
    dispatch_async(dispatch_get_main_queue(), ^{
        [self injectAllDeviceInfoWithRetry];
    });
}

+ (void)injectAllDeviceInfoWithRetry {
    static int retryCount = 0;
    if (retryCount >= 30) {
        NSLog(@"[SensorsWaveBridge] GIVE UP: Cocos 引擎 5 秒内未就绪，请检查 SDK 集成");
        return;
    }

    se::ScriptEngine *engine = se::ScriptEngine::getInstance();
    if (!engine || !engine->isValid()) {
        retryCount++;
        if (retryCount == 1 || retryCount % 5 == 0) {
            NSLog(@"[SensorsWaveBridge] Cocos engine not ready, retry %d/30 in 150ms", retryCount);
        }
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.15 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{
            [self injectAllDeviceInfoWithRetry];
        });
        return;
    }

    NSLog(@"[SensorsWaveBridge] Cocos engine ready, injecting device info (after %d retries)", retryCount);
    [self injectAppInfo];
    [self injectAndMonitorNetwork];
    [self injectPendingCrashes];
}

+ (void)injectAllDeviceInfo {
    [self injectAllDeviceInfoWithRetry];
}

/**
 * 直接从 Info.plist 读取键值。
 * 部分 iOS 配置下 [[NSBundle mainBundle] bundleIdentifier] 会返回 nil/空，绕过它。
 */
+ (NSDictionary *)loadInfoPlistDict {
    static NSDictionary *cached = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        @autoreleasepool {
            NSString *plistPath = [[NSBundle mainBundle] pathForResource:@"Info" ofType:@"plist"];
            if (IsNullOrEmpty(plistPath)) {
                plistPath = [[NSBundle mainBundle] pathForResource:@"Info" ofType:@"plist" inDirectory:nil forLocalization:nil];
            }
            if (IsNullOrEmpty(plistPath)) {
                NSString *bundlePath = [[NSBundle mainBundle] bundlePath];
                plistPath = [bundlePath stringByAppendingPathComponent:@"Info.plist"];
            }
            if (!IsNullOrEmpty(plistPath)) {
                NSDictionary *raw = [NSDictionary dictionaryWithContentsOfFile:plistPath];
                cached = raw ? [[NSDictionary alloc] initWithDictionary:raw] : nil;
            }
        }
    });
    return cached ?: @{};
}

+ (void)injectAppInfo {
    NSMutableDictionary *info = [NSMutableDictionary dictionary];
    NSDictionary *plist = [self loadInfoPlistDict];

    NSString *appId = plist[@"CFBundleIdentifier"];
    if (IsNullOrEmpty(appId)) {
        appId = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleIdentifier"];
    }
    if (IsNullOrEmpty(appId)) {
        appId = [[NSBundle mainBundle] bundleIdentifier];
    }
    if (IsNullOrEmpty(appId)) {
        NSString *path = [[NSBundle mainBundle] bundlePath];
        if (!IsNullOrEmpty(path)) {
            appId = [path lastPathComponent];
            if ([appId hasSuffix:@".app"]) {
                appId = [appId substringToIndex:appId.length - 4];
            }
        }
    }
    if (!IsNullOrEmpty(appId)) info[@"appId"] = appId;

    NSString *appName = plist[@"CFBundleDisplayName"];
    if (IsNullOrEmpty(appName)) appName = plist[@"CFBundleName"];
    if (IsNullOrEmpty(appName)) appName = plist[@"CFBundleExecutable"];
    if (IsNullOrEmpty(appName) && !IsNullOrEmpty(appId)) appName = appId;
    if (!IsNullOrEmpty(appName)) info[@"appName"] = appName;

    NSString *appVersion = plist[@"CFBundleShortVersionString"];
    if (!IsNullOrEmpty(appVersion)) info[@"appVersion"] = appVersion;

    NSString *region = [[NSLocale currentLocale] countryCode];
    if (IsNullOrEmpty(region)) {
        region = [[NSLocale autoupdatingCurrentLocale] countryCode];
    }
    if (IsNullOrEmpty(region)) {
        NSArray *languages = [NSLocale preferredLanguages];
        if (languages.count > 0) {
            NSString *first = languages[0];
            NSArray *parts = [first componentsSeparatedByCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"_-"]];
            region = parts.count >= 2 ? [parts lastObject] : first;
        }
    }
    if (IsNullOrEmpty(region)) {
        region = [self regionFromTimezoneName:[[NSTimeZone localTimeZone] name]];
    }
    if (IsNullOrEmpty(region)) {
        NSString *localeId = [[NSLocale currentLocale] localeIdentifier];
        if (!IsNullOrEmpty(localeId)) {
            NSArray *parts = [localeId componentsSeparatedByCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"_-"]];
            if (parts.count >= 2) region = [parts lastObject];
        }
    }
    if (!IsNullOrEmpty(region) && region.length == 2) {
        info[@"region"] = region;
    }

    BOOL ok = [self setGlobalProperty:@"__sensorswave_app_info__" withDictionary:info];
    if (!ok) {
        NSError *err2 = nil;
        NSData *jsonData = [NSJSONSerialization dataWithJSONObject:info
                                                           options:0
                                                             error:&err2];
        NSString *jsonStr = jsonData ? [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding] : @"{}";
        NSString *script = [NSString stringWithFormat:
            @"globalThis.__sensorswave_app_info__ = %@;", jsonStr];
        ok = [self evalJS:script];
    }
    NSLog(@"[SensorsWaveBridge] Injected app info (ok=%d): %@", ok, info);
}

+ (NSString *)regionFromTimezoneName:(NSString *)tzName {
    if (IsNullOrEmpty(tzName)) return nil;
    static NSDictionary *map = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        // ⚠️ 同 pendingCrashesFilePath：本文件以 MRC 编译（模板未开 ARC），
        // 字面量字典是 autorelease 的，static 直存会在首个 pool 排空后变僵尸，
        // 下一次调用 messaging 僵尸直接 EXC_BAD_ACCESS。必须 retain 常驻。
        NSDictionary *m = @{
            @"Asia/Shanghai": @"CN", @"Asia/Hong_Kong": @"HK", @"Asia/Taipei": @"TW",
            @"Asia/Tokyo": @"JP", @"Asia/Seoul": @"KR", @"Asia/Singapore": @"SG",
            @"Asia/Bangkok": @"TH", @"Asia/Jakarta": @"ID", @"Asia/Manila": @"PH",
            @"Asia/Kolkata": @"IN", @"Asia/Dubai": @"AE", @"Asia/Karachi": @"PK",
            @"Europe/London": @"GB", @"Europe/Paris": @"FR", @"Europe/Berlin": @"DE",
            @"Europe/Madrid": @"ES", @"Europe/Rome": @"IT", @"Europe/Moscow": @"RU",
            @"America/New_York": @"US", @"America/Los_Angeles": @"US", @"America/Chicago": @"US",
            @"America/Toronto": @"CA", @"America/Mexico_City": @"MX", @"America/Sao_Paulo": @"BR",
        };
#if !__has_feature(objc_arc)
        map = [m retain];
#else
        map = m;
#endif
    });
    return map[tzName];
}

/**
 * 启动 nw_path_monitor 监听网络变化，实时更新 __sensorswave_network_type__。
 * update_handler 第一次会同步触发一次，不需要单独"先注入一次"。
 */
+ (void)injectAndMonitorNetwork {
    nw_path_monitor_t monitor = nw_path_monitor_create();
    nw_path_monitor_set_queue(monitor, dispatch_get_main_queue());

    nw_path_monitor_set_update_handler(monitor, ^(nw_path_t path) {
        nw_path_status_t status = nw_path_get_status(path);
        BOOL isWiFi = nw_path_uses_interface_type(path, nw_interface_type_wifi);
        NSString *type = [self nwPathStatusToType:status isWiFi:isWiFi];
        NSLog(@"[SensorsWaveBridge] Network changed: %@ (isWiFi=%d, status=%d)", type, isWiFi, (int)status);
        [self injectNetworkType:type];
    });

    nw_path_monitor_start(monitor);
}

+ (NSString *)nwPathStatusToType:(nw_path_status_t)status isWiFi:(BOOL)isWiFi {
    if (status == nw_path_status_satisfied) {
        return isWiFi ? @"LAN" : @"WWAN";
    }
    return @"NONE";
}

+ (void)injectNetworkType:(NSString *)type {
    if (IsNullOrEmpty(type)) return;

    BOOL ok = [self setGlobalString:@"__sensorswave_network_type__" withString:type];
    if (!ok) {
        NSError *err = nil;
        NSData *jsonData = [NSJSONSerialization dataWithJSONObject:@{@"n": type}
                                                           options:0
                                                             error:&err];
        NSString *jsonStr = jsonData ? [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding] : @"{}";
        NSString *script = [NSString stringWithFormat:
            @"globalThis.__sensorswave_network_type__ = %@.n;", jsonStr];
        ok = [self evalJS:script];
    }
    if (!ok) {
        NSLog(@"[SensorsWaveBridge] Injected network type failed: %@", type);
    }
}

+ (BOOL)evalJS:(NSString *)script {
    if (IsNullOrEmpty(script)) return NO;
    se::ScriptEngine *engine = se::ScriptEngine::getInstance();
    if (!engine || !engine->isValid()) {
        NSLog(@"[SensorsWaveBridge] evalJS failed: engine not valid, script=%@", script);
        return NO;
    }
    se::Value ret;
    BOOL ok = engine->evalString([script UTF8String], (int)[script length], &ret);
    if (!ok) {
        NSLog(@"[SensorsWaveBridge] evalJS failed: %@", script);
    }
    return ok;
}

/**
 * 把 NSDictionary 直接挂到 v8 global 的某个 key 上（绕过 evalString）。
 *
 * se::ScriptEngine::evalString 在 CC 2.4.5 iOS 上写到的 globalThis 跟 plugin 脚本
 * 读到的 globalThis 不是同一个 V8 对象，直接挂 v8 global 才能保证 plugin 脚本可见。
 * se::HandleObject / se::Value 必须在 se::AutoHandleScope 内构造。
 */
+ (BOOL)setGlobalProperty:(NSString *)key withDictionary:(NSDictionary *)dict {
    if (IsNullOrEmpty(key) || !dict) return NO;
    se::ScriptEngine *engine = se::ScriptEngine::getInstance();
    if (!engine || !engine->isValid()) return NO;

    se::AutoHandleScope hs;
    se::Object *global = engine->getGlobalObject();
    if (!global) return NO;

    se::HandleObject obj(se::Object::createPlainObject());
    for (NSString *k in dict) {
        id v = dict[k];
        const char *ck = [k UTF8String];
        // 一律转字符串再写入，避开 se::Value 数值构造的歧义
        if (v == nil || v == [NSNull null]) {
            obj->setProperty(ck, se::Value(""));
        } else if ([v isKindOfClass:[NSString class]]) {
            obj->setProperty(ck, se::Value([(NSString *)v UTF8String]));
        } else if ([v isKindOfClass:[NSNumber class]]) {
            obj->setProperty(ck, se::Value([[(NSNumber *)v stringValue] UTF8String]));
        } else {
            obj->setProperty(ck, se::Value([[v description] UTF8String]));
        }
    }

    global->setProperty([key UTF8String], se::Value(obj));
    return YES;
}

/** 在 global 上挂一个字符串字段（用于 __sensorswave_network_type__）。 */
+ (BOOL)setGlobalString:(NSString *)key withString:(NSString *)value {
    if (IsNullOrEmpty(key) || IsNullOrEmpty(value)) return NO;
    se::ScriptEngine *engine = se::ScriptEngine::getInstance();
    if (!engine || !engine->isValid()) return NO;

    se::AutoHandleScope hs;
    se::Object *global = engine->getGlobalObject();
    if (!global) return NO;

    global->setProperty([key UTF8String], se::Value([value UTF8String]));
    return YES;
}

#pragma mark - Crash Capture 实现

/**
 * 读主二进制 Mach-O 的 LC_UUID（dSYM 匹配键，wire 侧 debug_id）。
 * _dyld_get_image_header(0) 即主执行文件；纯内存遍历 load commands，无文件 IO，
 * NSException handler 上下文安全（Foundation 可用，与现有 JSON 落盘同级）。
 * NSUUID.UUIDString 输出 36 位大写连字符，对齐 wire 规范。
 */
+ (NSString *)mainBinaryUuid {
    const struct mach_header_64 *header =
        (const struct mach_header_64 *)_dyld_get_image_header(0);
    if (!header || header->magic != MH_MAGIC_64) return nil;

    uintptr_t cursor = (uintptr_t)header + sizeof(struct mach_header_64);
    for (uint32_t i = 0; i < header->ncmds; i++) {
        const struct load_command *lc = (const struct load_command *)cursor;
        if (lc->cmdsize < sizeof(struct load_command)) break;
        if (lc->cmd == LC_UUID) {
            const struct uuid_command *uc = (const struct uuid_command *)cursor;
            return [[NSUUID alloc] initWithUUIDBytes:uc->uuid].UUIDString;
        }
        cursor += lc->cmdsize;
    }
    return nil;
}

/**
 * 主二进制 __TEXT 段运行时映射大小（信号兜底帧归属判定用）：
 * 遍历 load commands 找名为 __TEXT 的 LC_SEGMENT_64（链接顺序上第一段必为 __TEXT），
 * 取 vmsize。信号 handler 内无 dyld size API，此值在安装期预计算固化。
 * ⚠️ 不能用 seg->vmaddr == 镜像头地址 判定：vmaddr 是文件态地址，运行时加了
 * ASLR slide（_dyld_get_image_vmaddr_slide），两者只在 slide=0 时相等。
 * 解析失败返回 0（handler 退化为全部帧记 unknown，记录仍可落盘）。
 */
+ (uint64_t)mainBinaryTextSize {
    const struct mach_header_64 *header =
        (const struct mach_header_64 *)_dyld_get_image_header(0);
    if (!header || header->magic != MH_MAGIC_64) return 0;

    uintptr_t cursor = (uintptr_t)header + sizeof(struct mach_header_64);
    for (uint32_t i = 0; i < header->ncmds; i++) {
        const struct load_command *lc = (const struct load_command *)cursor;
        if (lc->cmdsize < sizeof(struct load_command)) break;
        if (lc->cmd == LC_SEGMENT_64) {
            const struct segment_command_64 *seg = (const struct segment_command_64 *)cursor;
            if (strncmp(seg->segname, "__TEXT", sizeof(seg->segname)) == 0) return seg->vmsize;
        }
        cursor += lc->cmdsize;
    }
    return 0;
}

/**
 * 采集堆栈涉及镜像的运行时基址表（$exception_frames 的 image_addr / debug_id enrich 原料）：
 *   - 从 callStackSymbols 行解析镜像名（去重），逐个在 dyld 镜像列表中按 basename
 *     匹配；base = image header 运行时地址（即 `atos -l` 的入参形态，非 vmaddr slide）
 *   - 主二进制（dyld index 0）条目附带 LC_UUID（debug_id）；系统镜像不附——
 *     服务端以 debug_id 有无区分应用帧 / 系统帧
 *   - base 形态 0x + 16 位补零小写 hex，与 JS 侧 normalizeHexAddr 归一化一致
 * 返回 nil 表示无可用采集结果（record 缺省 images 字段，旧版 JS 解析天然兼容）。
 */
+ (NSArray *)collectStackImages:(NSException *)exception {
    NSMutableArray *images = [NSMutableArray array];
    @try {
        NSMutableSet *names = [NSMutableSet set];
        for (NSString *line in exception.callStackSymbols) {
            // 行形态：`0   ImageName 0xADDR symbol + off ...`（未符号化帧 symbol 段为 0xADDR）
            NSArray *parts = [line componentsSeparatedByCharactersInSet:
                              [NSCharacterSet whitespaceCharacterSet]];
            if (parts.count >= 3) {
                NSString *name = parts[1];
                if (!IsNullOrEmpty(name) && ![name hasPrefix:@"0x"]) {
                    [names addObject:name];
                }
            }
        }

        uint32_t imageCount = _dyld_image_count();
        for (uint32_t i = 0; i < imageCount && images.count < 32; i++) {
            const char *path = _dyld_get_image_name(i);
            if (!path) continue;
            NSString *basename = [[NSString stringWithUTF8String:path] lastPathComponent];
            if (![names containsObject:basename]) continue;

            uintptr_t base = (uintptr_t)_dyld_get_image_header(i);
            if (base == 0) continue;

            NSMutableDictionary *image = [NSMutableDictionary dictionary];
            image[@"name"] = basename;
            image[@"base"] = [NSString stringWithFormat:@"0x%016llx", (unsigned long long)base];
            if (i == 0) {
                NSString *uuid = [self mainBinaryUuid];
                if (!IsNullOrEmpty(uuid)) {
                    image[@"debug_id"] = uuid;
                }
            }
            [images addObject:image];
            [names removeObject:basename];
            if (names.count == 0) break;
        }
    } @catch (NSException *e) {
        // 崩溃 handler 里绝不能再抛；失败退化为已采集部分（或 nil）
        return images.count > 0 ? images : nil;
    }
    return images.count > 0 ? images : nil;
}

/**
 * 待补报崩溃记录文件（Application Support）。
 * 不放 Library/Caches：Caches 会被系统在磁盘压力下清除，导致待补报崩溃静默丢失，
 * 与 Android filesDir / HarmonyOS preferences 的持久性不对齐。Application Support
 * 在 iOS 上默认不存在，首次访问时创建。
 */
+ (NSString *)pendingCrashesFilePath {
    return [self pendingCrashFilePathWithName:@"sensorswave_pending_crashes.json"];
}

/** 崩溃记录文件路径（fileName 区分主记录文件与信号兜底 sidecar，同一目录）。 */
+ (NSString *)pendingCrashFilePathWithName:(NSString *)fileName {
    static NSMutableDictionary *cachedPaths = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
#if !__has_feature(objc_arc)
        cachedPaths = [[NSMutableDictionary alloc] init];
#else
        cachedPaths = [NSMutableDictionary dictionary];
#endif
    });
    id cached = cachedPaths[fileName];
    if (cached) return cached;

    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *dir = [[fm URLsForDirectory:NSApplicationSupportDirectory
                                inDomains:NSUserDomainMask] firstObject].path;
    if (IsNullOrEmpty(dir)) {
        // 极端兜底：沙盒异常拿不到 Application Support 时退回 Caches（有总比没有好）
        dir = [NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES) firstObject];
    } else {
        BOOL isDir = NO;
        if (![fm fileExistsAtPath:dir isDirectory:&isDir] || !isDir) {
            [fm createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
        }
    }
    if (IsNullOrEmpty(dir)) return nil;

    // ⚠️ 本文件以 MRC 编译（模板 xcodeproj 未开 CLANG_ENABLE_OBJC_ARC）。
    // static 指针不会保住返回的 autorelease 对象——首个 pool 排空后变僵尸，
    // 第二次调用（hook + retry 双路径必经）就 EXC_BAD_ACCESS，App 启动必闪退。
    // 必须显式 retain 常驻（ARC 下 __strong static 自动保住，无需处理）。
#if !__has_feature(objc_arc)
    NSString *path = [[dir stringByAppendingPathComponent:fileName] retain];
#else
    NSString *path = [dir stringByAppendingPathComponent:fileName];
#endif
    cachedPaths[fileName] = path;
#if !__has_feature(objc_arc)
    [path release];
#endif
    return path;
}

/**
 * 读取已落盘的崩溃记录。boot 时做两级裁剪：
 *   - 丢弃 >30 天的过期记录
 *   - 只保留最新 10 条
 * ⚠️ 水位线机制：原生**永不**因"已注入/已上报"删除记录（JS 侧用 localStorage
 * 水位线过滤），这里的裁剪只防文件无限增长。
 */
+ (NSArray *)loadPendingCrashRecords {
    NSString *path = [self pendingCrashesFilePath];
    NSTimeInterval cutoff = [[NSDate date] timeIntervalSince1970] - 30 * 24 * 3600;
    NSMutableArray *kept = [NSMutableArray array];

    NSData *data = [NSData dataWithContentsOfFile:path];
    if (data) {
        id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if ([parsed isKindOfClass:[NSArray class]]) {
            for (id item in (NSArray *)parsed) {
                if (![item isKindOfClass:[NSDictionary class]]) continue;
                NSNumber *ts = ((NSDictionary *)item)[@"timestamp"];
                if (![ts isKindOfClass:[NSNumber class]]) continue;
                if ([ts doubleValue] / 1000.0 < cutoff) continue;
                [kept addObject:item];
            }
        }
    }

    // 信号兜底 sidecar（信号 handler 内只能整文件覆盖写）：记录并入返回值统一裁剪。
    // sidecar 不删除、主文件不回写——记录可能同时存在于两处，但 JS 侧按时间戳水位线
    // 补报，天然去重。sidecar 内容损坏（写入被中断的半截 JSON）解析失败即视为空。
    NSString *sidecarPath = [self pendingCrashFilePathWithName:SW_SIGNAL_CRASH_FILE_NAME];
    if (!IsNullOrEmpty(sidecarPath)) {
        NSData *sidecarData = [NSData dataWithContentsOfFile:sidecarPath];
        if (sidecarData) {
            id parsed = [NSJSONSerialization JSONObjectWithData:sidecarData options:0 error:nil];
            if ([parsed isKindOfClass:[NSArray class]]) {
                for (id item in (NSArray *)parsed) {
                    if (![item isKindOfClass:[NSDictionary class]]) continue;
                    NSNumber *ts = ((NSDictionary *)item)[@"timestamp"];
                    if (![ts isKindOfClass:[NSNumber class]]) continue;
                    if ([ts doubleValue] / 1000.0 < cutoff) continue;
                    [kept addObject:item];
                }
            }
        }
    }

    if (kept.count > 10) {
        [kept removeObjectsInRange:NSMakeRange(0, kept.count - 10)];
    }
    return kept;
}

/** 崩溃时追加一条记录（崩溃线程上同步写文件）。 */
+ (void)appendPendingCrashRecord:(NSDictionary *)record {
    @try {
        NSMutableArray *records = [[self loadPendingCrashRecords] mutableCopy];
        [records addObject:record];
        if (records.count > 10) {
            [records removeObjectsInRange:NSMakeRange(0, records.count - 10)];
        }
        NSData *json = [NSJSONSerialization dataWithJSONObject:records options:0 error:nil];
        if (json) {
            [json writeToFile:[self pendingCrashesFilePath] atomically:YES];
        }
    } @catch (NSException *e) {
        // ignore
    }
}

/** 安装未捕获 NSException 处理器（幂等）。 */
+ (void)installCrashHandler {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        sPreviousUncaughtExceptionHandler = NSGetUncaughtExceptionHandler();
        NSSetUncaughtExceptionHandler(&sensorswaveUncaughtExceptionHandler);
        [self installSignalBackstop];
        NSLog(@"[SensorsWaveBridge] crash handler installed");
    });
}

/**
 * 安装致命信号兜底 handler（幂等）。
 * 信号 handler 内不能触碰 ObjC runtime / malloc，所以路径与主二进制 images
 * JSON 片段在此预计算进静态缓冲（见 sensorswaveSignalHandler 注释）。
 */
+ (void)installSignalBackstop {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        NSString *sidecar = [self pendingCrashFilePathWithName:SW_SIGNAL_CRASH_FILE_NAME];
        if (!IsNullOrEmpty(sidecar)) {
            const char *c = sidecar.fileSystemRepresentation;
            if (c) {
                strncpy(sSWSignalSidecarPath, c, sizeof(sSWSignalSidecarPath) - 1);
            }
        }

        @try {
            // 主二进制基址 + LC_UUID：images 片段与帧偏移计算的原料（ASLR 每次启动
            // 不同但启动后不变，安装期固化即可）。形态与 collectStackImages 一致。
            const uintptr_t base = (uintptr_t)_dyld_get_image_header(0);
            const char *path = _dyld_get_image_name(0);
            if (base != 0 && path != NULL) {
                snprintf(sSWMainBaseHex, sizeof(sSWMainBaseHex), "%llx", (unsigned long long)base);
                NSString *name = [[NSString stringWithUTF8String:path] lastPathComponent];
                strncpy(sSWMainImageName, name.UTF8String ?: "unknown",
                        sizeof(sSWMainImageName) - 1);
                sSWMainImageSize = [self mainBinaryTextSize];
                NSString *uuid = [self mainBinaryUuid];
                NSMutableString *frag = [NSMutableString string];
                [frag appendFormat:@",\"images\":[{\"name\":\"%@\",\"base\":\"0x%016llx\"",
                                    name, (unsigned long long)base];
                if (!IsNullOrEmpty(uuid)) {
                    [frag appendFormat:@",\"debug_id\":\"%@\"}]", uuid];
                } else {
                    [frag appendString:@"}]"];
                }
                strncpy(sSWImagesJsonPrefix, frag.UTF8String ?: "", sizeof(sSWImagesJsonPrefix) - 1);
            }
        } @catch (NSException *e) {
            // 缺省 images 片段，记录仍可落盘
        }

        // 备用信号栈：栈溢出类 SIGSEGV（打到 guard page）时本 handler 也无栈可用
        static char altStack[64 * 1024] __attribute__((aligned(16)));
        stack_t current;
        memset(&current, 0, sizeof(current));
        if (sigaltstack(NULL, &current) == 0 && (current.ss_flags & SS_DISABLE)) {
            stack_t alt;
            memset(&alt, 0, sizeof(alt));
            alt.ss_sp = altStack;
            alt.ss_size = sizeof(altStack);
            alt.ss_flags = 0;
            sigaltstack(&alt, NULL);
        }

        struct sigaction action;
        memset(&action, 0, sizeof(action));
        action.sa_sigaction = sensorswaveSignalHandler;
        sigemptyset(&action.sa_mask);
        action.sa_flags = SA_SIGINFO | SA_ONSTACK;
        for (size_t i = 0; i < sizeof(kSWFatalSignals) / sizeof(kSWFatalSignals[0]); i++) {
            sigaction(kSWFatalSignals[i], &action, &sSWPreviousSignalActions[i]);
        }
        NSLog(@"[SensorsWaveBridge] signal backstop installed (%d fatal signals)",
              (int)(sizeof(kSWFatalSignals) / sizeof(kSWFatalSignals[0])));
    });
}

/**
 * 【调试用】抛未捕获 NSException，验证 fatal 补报通道。
 *
 * demo「触发原生崩溃」按钮经 jsb.reflection.callStaticMethod('SensorsWaveBridge',
 * 'raiseTestException') 调用（⚠️ CC 的 iOS 桥参数可变长、不收签名串，无参方法
 * 只能传 (className, methodName) 两个参数，多传会因 numberOfArguments 不匹配
 * 直接返回 INVALID_ARGUMENTS）。
 *
 * ⚠️ 必须异步抛：桥接层 [invocation invoke] 包在 @try/@catch(NSException) 里，
 * 同步抛会被桥吞掉（JSO_ERR_EXCEPTION_OCCURRED）。dispatch 到主队列下一轮
 * runloop 再抛，脱离 @try 作用域 → 未捕获 → sensorswaveUncaughtExceptionHandler
 * 落盘 → 链式调用系统 handler 终止进程 → 下次启动注入 JS 补报 $Exception(fatal)。
 */
+ (void)raiseTestException {
    dispatch_async(dispatch_get_main_queue(), ^{
        [NSException raise:@"SWTestCrash" format:@"SensorsWave fatal 通道验证崩溃"];
    });
}

/**
 * boot 时把上次落盘的崩溃记录注入 JS（JSON 字符串挂在 v8 global 上，
 * JS 侧 crash-reader 解析后按水位线过滤补报）。
 * 注入的记录保留在文件里，下次启动若无新增会再次注入（JS 水位线保证不重复上报）。
 */
+ (void)injectPendingCrashes {
    @try {
        NSArray *records = [self loadPendingCrashRecords];
        if (records.count == 0) return;

        NSData *json = [NSJSONSerialization dataWithJSONObject:records options:0 error:nil];
        NSString *jsonStr = json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : nil;
        if (IsNullOrEmpty(jsonStr)) return;

        BOOL ok = [self setGlobalString:@"__sensorswave_pending_crashes__" withString:jsonStr];
        if (!ok) {
            // 兜底：直接挂 v8 global 失败时用 evalJS 注入 JSON 字符串字面量
            NSString *script = [NSString stringWithFormat:
                @"globalThis.__sensorswave_pending_crashes__ = %@;", jsonStr];
            ok = [self evalJS:script];
        }
        NSLog(@"[SensorsWaveBridge] Injected %lu pending crashes (ok=%d)",
              (unsigned long)records.count, (int)ok);
    } @catch (NSException *e) {
        // ignore
    }
}

@end
