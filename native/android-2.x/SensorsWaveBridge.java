package com.sensorswave.cocoscreator;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

// Cocos Creator 2.x (cocos2d-x-lite) 的运行时包路径。
// 2.x 类名带 `2dx`（Cocos2dxJavascriptJavaBridge / Cocos2dxHelper），3.x 不带。
// 集成时按 Cocos Creator 版本选对文件路径：
//   - CC 2.x：cp src/native/android-2.x/SensorsWaveBridge.java ...
//   - CC 3.x：cp src/native/android/SensorsWaveBridge.java ...
// CC 2.4.5 把"投到 game thread"命名成 runOnGLThread（GL 线程就是 game 线程），
// 3.x 才叫 runOnGameThread。
import org.cocos2dx.lib.Cocos2dxHelper;
import org.cocos2dx.lib.Cocos2dxJavascriptJavaBridge;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

/**
 * SensorsWaveBridge - Cocos Creator 2.x Android 端设备信息桥接（ContentProvider 形式）。
 *
 * <p>本文件是 {@code src/native/android/SensorsWaveBridge.java} 的 2.x 版本，
 * 与 3.x 版本的差异**仅**在 import 路径和类名（多一个 `2dx`），业务逻辑完全一致。
 *
 * <p>集成步骤：同 3.x 版，把本文件放到工程源码目录，
 * 在 {@code AndroidManifest.xml} 的 {@code <application>} 标签内注册 provider。
 */
public class SensorsWaveBridge extends ContentProvider {

    private static final String TAG = "SensorsWaveBridge";
    private static Context sContext;
    private static boolean sInjected = false;
    private static boolean sInjectedSuccess = false;

    @Override
    public boolean onCreate() {
        sContext = getContext();
        Log.i(TAG, "ContentProvider onCreate, will inject device info when activity is ready");

        // 不能直接调 Cocos2dxHelper.runOnGLThread：ContentProvider.onCreate 早于
        // Cocos2dxActivity.onCreate，这时 Cocos2dxHelper.sActivity 还是 null。
        // 用 main thread Handler 轮询，sActivity 就绪后再投到 GL thread。
        postInjectWhenActivityReady();
        return true;
    }

    /**
     * 等 Cocos2dxHelper.sActivity 就绪后再调 runOnGLThread。
     * 轮询策略：每 500ms 试一次，60 次（30 秒）后放弃。
     */
    private void postInjectWhenActivityReady() {
        final Handler mainHandler = new Handler(Looper.getMainLooper());
        final int[] attempt = {0};
        final Runnable[] holder = new Runnable[1];
        holder[0] = new Runnable() {
            @Override
            public void run() {
                attempt[0]++;
                if (attempt[0] > 60) {
                    Log.w(TAG, "Gave up after 60 retries (Cocos2dxHelper.sActivity never set, "
                        + "did Cocos2dxActivity.onCreate run? Engine may not be initialized)");
                    return;
                }
                try {
                    Cocos2dxHelper.runOnGLThread(new Runnable() {
                        @Override
                        public void run() {
                            injectAllDeviceInfo();
                            startNetworkMonitor();
                        }
                    });
                    Log.i(TAG, "Injected on attempt " + attempt[0] + " (Cocos2dxHelper.sActivity ready)");
                } catch (NullPointerException npe) {
                    Log.i(TAG, "Cocos2dxHelper.sActivity not ready, retry " + attempt[0] + " in 500ms");
                    mainHandler.postDelayed(holder[0], 500);
                }
            }
        };
        mainHandler.post(holder[0]);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public String getType(Uri uri) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }

    private void injectAllDeviceInfo() {
        if (sInjected) return;
        sInjected = true;

        try {
            injectAppInfo();
        } catch (Throwable t) {
            Log.e(TAG, "injectAppInfo threw", t);
        }

        try {
            injectCurrentNetworkType();
        } catch (Throwable t) {
            Log.e(TAG, "injectCurrentNetworkType threw", t);
        }

        scheduleRetryInjection();
    }

    /** 重试注入直到成功，最多 30 秒。必须投到 game thread（evalString 需要 V8 isolate）。 */
    private void scheduleRetryInjection() {
        final int[] attempt = {0};
        final Runnable[] retryHolder = new Runnable[1];
        retryHolder[0] = new Runnable() {
            @Override
            public void run() {
                attempt[0]++;
                if (attempt[0] > 30) {
                    Log.w(TAG, "Gave up injecting after 30 retries (engine never ready?)");
                    return;
                }
                if (sInjectedSuccess) {
                    Log.i(TAG, "Already injected successfully, stop retrying at attempt " + attempt[0]);
                    return;
                }
                Log.i(TAG, "Retry injection attempt " + attempt[0] + "...");
                try {
                    injectAppInfo();
                } catch (Throwable t) {
                    Log.w(TAG, "Retry injectAppInfo failed: " + t.getMessage());
                }
                try {
                    injectCurrentNetworkType();
                } catch (Throwable t) {
                    Log.w(TAG, "Retry injectCurrentNetworkType failed: " + t.getMessage());
                }
                new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        Cocos2dxHelper.runOnGLThread(retryHolder[0]);
                    }
                }, 1000);
            }
        };
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                Cocos2dxHelper.runOnGLThread(retryHolder[0]);
            }
        }, 1000);
    }

    private void injectAppInfo() {
        JSONObject info = new JSONObject();
        try {
            info.put("appId", sContext.getPackageName());

            String appName = tryGetAppName();
            if (appName != null) info.put("appName", appName);

            String appVersion = tryGetAppVersion();
            if (appVersion != null) info.put("appVersion", appVersion);

            String region = Locale.getDefault().getCountry();
            if (region != null && !region.isEmpty()) info.put("region", region);

            String model = Build.MODEL;
            if (model != null) info.put("model", model);

            String brand = Build.BRAND;
            if (brand != null) info.put("brand", brand);

            String manufacturer = Build.MANUFACTURER;
            if (manufacturer != null) info.put("manufacturer", manufacturer);
        } catch (JSONException e) {
            Log.e(TAG, "build app info json failed", e);
            return;
        }

        String script = "globalThis.__sensorswave_app_info__ = " + info.toString() + ";";
        boolean ok = evalJS(script);
        Log.i(TAG, "Injected app info (ok=" + ok + "): " + info.toString());
        if (ok) {
            sInjectedSuccess = true;
        }
    }

    private String tryGetAppName() {
        try {
            ApplicationInfo ai = sContext.getPackageManager()
                .getApplicationInfo(sContext.getPackageName(), 0);
            CharSequence label = sContext.getPackageManager().getApplicationLabel(ai);
            return label != null ? label.toString() : null;
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    private String tryGetAppVersion() {
        try {
            PackageInfo pi = sContext.getPackageManager()
                .getPackageInfo(sContext.getPackageName(), 0);
            return pi.versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    private void injectCurrentNetworkType() {
        String type = readCurrentNetworkType();
        injectNetworkType(type);
    }

    private void startNetworkMonitor() {
        try {
            ConnectivityManager cm = (ConnectivityManager) sContext.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return;

            // registerNetworkCallback 不会为"已连接"的网络触发 onAvailable，先主动探测一次
            injectCurrentNetworkType();

            NetworkRequest request = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();
            cm.registerNetworkCallback(request, new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    // binder 线程，先投到 GL thread（= game thread）
                    Cocos2dxHelper.runOnGLThread(new Runnable() {
                        @Override
                        public void run() {
                            injectCurrentNetworkType();
                        }
                    });
                }

                @Override
                public void onLost(Network network) {
                    Cocos2dxHelper.runOnGLThread(new Runnable() {
                        @Override
                        public void run() {
                            injectNetworkType("NONE");
                        }
                    });
                }
            });
        } catch (Throwable t) {
            Log.e(TAG, "startNetworkMonitor failed", t);
        }
    }

    private String readCurrentNetworkType() {
        try {
            ConnectivityManager cm = (ConnectivityManager) sContext.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return "NONE";
            Network active = cm.getActiveNetwork();
            if (active == null) return "NONE";
            NetworkCapabilities caps = cm.getNetworkCapabilities(active);
            if (caps == null) return "NONE";

            // 模拟器默认 LAN：模拟器上的 CELLULAR 标记通常是模拟的，不应信任
            String hardware = Build.HARDWARE;
            boolean isEmulator = "ranchu".equals(hardware)
                || "goldfish".equals(hardware)
                || "vbox86".equals(hardware)
                || Build.FINGERPRINT.startsWith("generic")
                || Build.FINGERPRINT.startsWith("unknown")
                || Build.MODEL.contains("Emulator")
                || Build.MODEL.contains("sdk_gphone");
            if (isEmulator) {
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "LAN";
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "LAN";
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return "LAN";
                return "LAN";
            }

            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "LAN";
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "LAN";
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return "LAN";
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "WWAN";
            if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)) {
                return "LAN";
            }
            if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                return "WWAN";
            }
            return "NONE";
        } catch (Throwable t) {
            Log.e(TAG, "readCurrentNetworkType failed", t);
            return "NONE";
        }
    }

    private void injectNetworkType(String type) {
        if (type == null || type.isEmpty()) type = "NONE";
        String script = "globalThis.__sensorswave_network_type__ = \"" + type + "\";";
        boolean ok = evalJS(script);
        Log.i(TAG, "Injected network type (ok=" + ok + "): " + type);
    }

    /**
     * 调 Cocos 引擎的 evalString 注入 JS 脚本。
     *
     * <p>Cocos 2.x {@code Cocos2dxJavascriptJavaBridge.evalString} 返回语义：
     * 非 0 = 成功，0 = 失败（ScriptEngine 未初始化 / 字符串转换失败）。
     */
    private boolean evalJS(String script) {
        if (script == null || script.isEmpty()) return false;
        try {
            int ret = Cocos2dxJavascriptJavaBridge.evalString(script);
            if (ret == 0) {
                Log.w(TAG, "evalJS returned 0 (script engine not ready?): " + script);
                return false;
            }
            return true;
        } catch (Throwable t) {
            Log.e(TAG, "evalJS threw exception: " + t.getMessage());
            return false;
        }
    }
}
