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

@interface SensorsWaveBridge : NSObject
@end

@implementation SensorsWaveBridge

+ (void)load {
    NSLog(@"[SensorsWaveBridge] +load triggered, will inject device info later");

    se::ScriptEngine *engine = se::ScriptEngine::getInstance();
    if (engine) {
        engine->addAfterInitHook([]() {
            @autoreleasepool {
                [SensorsWaveBridge injectAppInfo];
                [SensorsWaveBridge injectAndMonitorNetwork];
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
        map = @{
            @"Asia/Shanghai": @"CN", @"Asia/Hong_Kong": @"HK", @"Asia/Taipei": @"TW",
            @"Asia/Tokyo": @"JP", @"Asia/Seoul": @"KR", @"Asia/Singapore": @"SG",
            @"Asia/Bangkok": @"TH", @"Asia/Jakarta": @"ID", @"Asia/Manila": @"PH",
            @"Asia/Kolkata": @"IN", @"Asia/Dubai": @"AE", @"Asia/Karachi": @"PK",
            @"Europe/London": @"GB", @"Europe/Paris": @"FR", @"Europe/Berlin": @"DE",
            @"Europe/Madrid": @"ES", @"Europe/Rome": @"IT", @"Europe/Moscow": @"RU",
            @"America/New_York": @"US", @"America/Los_Angeles": @"US", @"America/Chicago": @"US",
            @"America/Toronto": @"CA", @"America/Mexico_City": @"MX", @"America/Sao_Paulo": @"BR",
        };
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

@end
