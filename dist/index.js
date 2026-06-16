const SDK_VERSION = '1.0.2';

const DEFAULT_CONFIG = {
    debug: false,
    autoCapture: true,
    batchSend: false,
    maxBatchSize: 10,
    flushInterval: 5000,
    enableAB: false,
    abRefreshInterval: 600000,
    enableShareTrack: true,
};
const CONSTANTS = {
    MAX_QUEUE_SIZE: 200,
    DATA_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,
    QUEUE_STORAGE_KEY: 'sw_queue',
    ANON_ID_KEY: 'sw_anon_id',
    LOGIN_ID_KEY: 'sw_login_id',
    AB_DATA_KEY: 'sw_ab_data',
    LAUNCHED_KEY: 'sw_launched',
    AB_CACHE_TTL: 10 * 60 * 1000,
    MIN_AB_REFRESH_INTERVAL: 30 * 1000,
    PRESET_PROPS_CACHE_DURATION: 60000,
    MAX_RETRY_COUNT: 1,
    BASE_RETRY_DELAY: 1000,
    MAX_RETRY_DELAY: 30000,
    FLUSH_RETRY_BACKOFF_BASE: 2000,
    FLUSH_RETRY_BACKOFF_MAX: 60000,
    LIB_VALUE: 'cocosCreator',
    SDK_VERSION: SDK_VERSION,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    UTM_KEYS: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'],
    TRACK_ENDPOINT: '/in/track',
    AB_ENDPOINT: '/ab/evalall',
    REQUEST_TIMEOUT: 30000,
    SENSITIVE_KEY_PATTERNS: [
        /(?:^|[_.])(?:token|password|secret|credential|auth_key|access_key|private_key)$/i,
    ],
    MAX_CONSECUTIVE_FLUSH: 5,
};

class SafeStorage {
    constructor(storage) {
        this._fallback = new Map();
        this._degraded = false;
        try {
            storage.setItem('__sw_test__', '1');
            storage.removeItem('__sw_test__');
            this._storage = storage;
            this._degraded = false;
        }
        catch {
            this._storage = null;
            this._degraded = true;
        }
    }
    getItem(key) {
        if (this._degraded) {
            return this._fallback.get(key) ?? null;
        }
        try {
            return this._storage.getItem(key);
        }
        catch {
            this._degraded = true;
            return this._fallback.get(key) ?? null;
        }
    }
    setItem(key, value) {
        if (this._degraded) {
            this._fallback.set(key, value);
            return;
        }
        try {
            this._storage.setItem(key, value);
        }
        catch {
            this._degraded = true;
            this._fallback.set(key, value);
        }
    }
    removeItem(key) {
        if (this._degraded) {
            this._fallback.delete(key);
            return;
        }
        try {
            this._storage.removeItem(key);
        }
        catch {
            this._degraded = true;
            this._fallback.delete(key);
        }
    }
    get isDegraded() {
        return this._degraded;
    }
}

class Logger {
    constructor() {
        this._debug = false;
    }
    setDebug(debug) {
        this._debug = debug;
    }
    info(message, ...args) {
        if (this._debug) {
            console.info(`[SensorsWave] [INFO] ${message}`, ...args);
        }
    }
    warn(message, ...args) {
        console.warn(`[SensorsWave] [WARN] ${message}`, ...args);
    }
    error(message, ...args) {
        console.error(`[SensorsWave] [ERROR] ${message}`, ...args);
    }
    debug(message, ...args) {
        if (this._debug) {
            console.debug(`[SensorsWave] [DEBUG] ${message}`, ...args);
        }
    }
}
const logger = new Logger();

class EventEmitter {
    constructor() {
        this._listeners = new Map();
    }
    on(event, listener) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event).push(listener);
    }
    off(event, listener) {
        const listeners = this._listeners.get(event);
        if (!listeners)
            return;
        const index = listeners.indexOf(listener);
        if (index > -1) {
            listeners.splice(index, 1);
        }
    }
    emit(event, ...args) {
        const listeners = this._listeners.get(event);
        if (!listeners || listeners.length === 0)
            return;
        for (const listener of listeners) {
            try {
                listener(...args);
            }
            catch (e) {
                console.error(`[SensorsWave] Error in listener for event "${event}":`, e);
            }
        }
    }
    once(event, listener) {
        const onceWrapper = (...args) => {
            this.off(event, onceWrapper);
            listener(...args);
        };
        this.on(event, onceWrapper);
    }
    removeAllListeners(event) {
        if (event) {
            this._listeners.delete(event);
        }
        else {
            this._listeners.clear();
        }
    }
}

function generateUUID$1() {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        return [
            hex.slice(0, 8),
            hex.slice(8, 12),
            hex.slice(12, 16),
            hex.slice(16, 20),
            hex.slice(20, 32),
        ].join('-');
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

class Store {
    constructor(storage) {
        this._commonProps = {};
        this._dynamicPropFns = {};
        this._storage = storage;
    }
    getAnonId() {
        let anonId = this._storage.getItem(CONSTANTS.ANON_ID_KEY);
        if (!anonId) {
            anonId = generateUUID$1();
            this._storage.setItem(CONSTANTS.ANON_ID_KEY, anonId);
        }
        return anonId;
    }
    setLoginId(loginId) {
        this._storage.setItem(CONSTANTS.LOGIN_ID_KEY, loginId);
    }
    getLoginId() {
        return this._storage.getItem(CONSTANTS.LOGIN_ID_KEY) || '';
    }
    registerCommonProperties(props) {
        for (const [key, value] of Object.entries(props)) {
            if (typeof value === 'function') {
                this._dynamicPropFns[key] = value;
            }
            else {
                this._commonProps[key] = value;
            }
        }
    }
    clearCommonProperties(keys) {
        if (keys) {
            for (const key of keys) {
                delete this._commonProps[key];
                delete this._dynamicPropFns[key];
            }
        }
        else {
            this._commonProps = {};
            this._dynamicPropFns = {};
        }
    }
    getCommonProperties() {
        const result = { ...this._commonProps };
        for (const [key, fn] of Object.entries(this._dynamicPropFns)) {
            try {
                result[key] = fn();
            }
            catch {
            }
        }
        return result;
    }
    getABData() {
        const raw = this._storage.getItem(CONSTANTS.AB_DATA_KEY);
        if (!raw)
            return [];
        try {
            const cached = JSON.parse(raw);
            if (!cached || !Array.isArray(cached.results))
                return [];
            const now = Date.now();
            if (now - cached.timestamp > CONSTANTS.AB_CACHE_TTL)
                return [];
            const currentAnonId = this.getAnonId();
            if (cached.anon_id !== currentAnonId)
                return [];
            const currentLoginId = this.getLoginId();
            if (currentLoginId && cached.login_id !== currentLoginId)
                return [];
            return cached.results;
        }
        catch {
            return [];
        }
    }
    saveABData(results) {
        const data = {
            results,
            timestamp: Date.now(),
            anon_id: this.getAnonId(),
            login_id: this.getLoginId() || undefined,
        };
        this._storage.setItem(CONSTANTS.AB_DATA_KEY, JSON.stringify(data));
    }
    setLaunched() {
        this._storage.setItem(CONSTANTS.LAUNCHED_KEY, '1');
    }
    isLaunched() {
        return this._storage.getItem(CONSTANTS.LAUNCHED_KEY) === '1';
    }
}

class PersistentQueue {
    constructor(storage) {
        this._queue = [];
        this._loaded = false;
        this._storage = storage;
        this._load();
    }
    _load() {
        if (this._loaded)
            return;
        this._loaded = true;
        const raw = this._storage.getItem(CONSTANTS.QUEUE_STORAGE_KEY);
        if (!raw) {
            this._queue = [];
            return;
        }
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                this._queue = [];
                return;
            }
            this._queue = this._filterExpired(parsed.map((item) => ({
                ...item,
                dead: item.dead ?? false,
            })));
            this._enforceMaxSize();
            this._persist();
        }
        catch {
            this._queue = [];
            this._persist();
        }
    }
    _filterExpired(items) {
        const now = Date.now();
        return items.filter((item) => now - item.timestamp < CONSTANTS.DATA_EXPIRY_MS);
    }
    _enforceMaxSize() {
        if (this._queue.length > CONSTANTS.MAX_QUEUE_SIZE) {
            this._queue = this._queue.slice(-200);
        }
    }
    _persist() {
        try {
            this._storage.setItem(CONSTANTS.QUEUE_STORAGE_KEY, JSON.stringify(this._queue));
        }
        catch {
            if (this._queue.length > 0) {
                this._queue = this._queue.slice(-Math.floor(CONSTANTS.MAX_QUEUE_SIZE / 2));
                try {
                    this._storage.setItem(CONSTANTS.QUEUE_STORAGE_KEY, JSON.stringify(this._queue));
                }
                catch {
                }
            }
        }
    }
    enqueue(events, url, headers) {
        const id = generateUUID$1();
        const item = {
            id,
            url,
            data: events,
            headers,
            timestamp: Date.now(),
            retryCount: 0,
            dead: false,
        };
        this._queue.push(item);
        this._enforceMaxSize();
        this._persist();
        return id;
    }
    dequeue(ids) {
        if (ids.length === 0)
            return;
        const idSet = new Set(ids);
        this._queue = this._queue.filter((item) => !idSet.has(item.id));
        this._persist();
    }
    getAll() {
        return this._filterExpired(this._queue.slice());
    }
    peek(count) {
        const filtered = this._filterExpired(this._queue);
        return filtered.slice(0, count);
    }
    get size() {
        return this._queue.length;
    }
    incrementRetryCount(id) {
        const item = this._queue.find((i) => i.id === id);
        if (item) {
            item.retryCount++;
            this._persist();
        }
    }
    markDead(id) {
        const item = this._queue.find((i) => i.id === id);
        if (item) {
            item.dead = true;
            this._persist();
        }
    }
}

class BatchSender {
    constructor(queue, requestFn, maxBatchSize = 20, flushInterval = 5000) {
        this._flushTimer = null;
        this._isFlushing = false;
        this._destroyed = false;
        this._queue = queue;
        this._requestFn = requestFn;
        this._maxBatchSize = maxBatchSize;
        this._flushInterval = flushInterval;
    }
    start() {
        if (this._destroyed)
            return;
        this._startFlushTimer();
    }
    add() {
        if (this._destroyed)
            return;
        if (this._isFlushing) {
            return;
        }
        if (this._queue.size >= this._maxBatchSize) {
            this.triggerFlush();
        }
    }
    triggerFlush() {
        if (this._isFlushing || this._destroyed) {
            return;
        }
        this._clearFlushTimer();
        this._isFlushing = true;
        this._doFlush();
    }
    flush() {
        this.triggerFlush();
    }
    flushImmediate() {
        this.triggerFlush();
    }
    _doFlush() {
        const items = this._getSendableItems();
        if (items.length === 0) {
            this._isFlushing = false;
            this._startFlushTimer();
            return;
        }
        const allEvents = items.flatMap((item) => item.data);
        const allIds = items.map((item) => item.id);
        const lastItem = items[items.length - 1];
        const url = lastItem.url;
        const headers = lastItem.headers;
        logger.info('[BatchSender] POST', { url, headers, data: allEvents });
        const finish = (response) => {
            try {
                if (response.statusCode === 200) {
                    this._queue.dequeue(allIds);
                }
                else {
                    logger.warn('Batch send failed:', response.statusCode, response.text);
                }
            }
            catch (e) {
                logger.error('Error in flush callback:', e);
            }
            finally {
                if (this._isFlushing && !this._destroyed) {
                    this._isFlushing = false;
                    if (response.statusCode === 200 && this._queue.size > 0) {
                        this.triggerFlush();
                    }
                    else {
                        this._startFlushTimer();
                    }
                }
            }
        };
        this._requestFn({
            url,
            method: 'POST',
            data: allEvents,
            headers,
            callback: finish,
        });
    }
    _getSendableItems() {
        const all = this._queue.peek(this._queue.size);
        return all.filter((item) => !item.dead).slice(0, this._maxBatchSize);
    }
    _startFlushTimer() {
        if (this._destroyed)
            return;
        this._clearFlushTimer();
        this._flushTimer = setInterval(() => {
            if (this._queue.size > 0) {
                this.triggerFlush();
            }
        }, this._flushInterval);
    }
    _clearFlushTimer() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
    }
    destroy() {
        this._destroyed = true;
        this._clearFlushTimer();
        this._isFlushing = false;
    }
}

class Send {
    constructor(store, presetProps) {
        this._utmProvider = null;
        this._store = store;
        this._presetProps = presetProps;
    }
    setUtmProvider(provider) {
        this._utmProvider = provider;
    }
    sendEvent(eventName, properties, userProperties, subjectProperties) {
        const event = {
            event: eventName,
            time: Date.now(),
            trace_id: generateUUID$1(),
        };
        const anonId = this._store.getAnonId();
        if (anonId)
            event.anon_id = anonId;
        const loginId = this._store.getLoginId();
        if (loginId)
            event.login_id = loginId;
        const utmProps = this._utmProvider ? this._utmProvider() : {};
        const mergedProps = this.buildEnrichedProperties(properties || {}, utmProps);
        if (Object.keys(mergedProps).length > 0) {
            event.properties = mergedProps;
        }
        const mergedUserProps = this._mergeUtmUserProperties(userProperties, utmProps);
        if (mergedUserProps && Object.keys(mergedUserProps).length > 0) {
            event.user_properties = mergedUserProps;
        }
        if (subjectProperties && Object.keys(subjectProperties).length > 0) {
            const filtered = this._filterSensitiveFields(subjectProperties);
            if (Object.keys(filtered).length > 0) {
                event.subject_properties = filtered;
            }
        }
        return event;
    }
    buildEnrichedProperties(eventProps, utmProps) {
        const result = {};
        const presetProps = this._presetProps.get();
        for (const [key, value] of Object.entries(presetProps)) {
            if (value !== undefined)
                result[key] = value;
        }
        const commonProps = this._store.getCommonProperties();
        for (const [key, value] of Object.entries(commonProps)) {
            try {
                const actual = typeof value === 'function' ? value() : value;
                if (actual !== undefined)
                    result[key] = actual;
            }
            catch {
            }
        }
        for (const [key, value] of Object.entries(utmProps)) {
            if (value !== '' && value !== undefined)
                result[key] = value;
        }
        for (const [key, value] of Object.entries(eventProps)) {
            if (value !== undefined)
                result[key] = value;
        }
        return this._filterSensitiveFields(result);
    }
    _mergeUtmUserProperties(userProperties, utmProps) {
        const hasUtm = Object.keys(utmProps).length > 0;
        if (!hasUtm && !userProperties)
            return undefined;
        const merged = { ...(userProperties || {}) };
        if (hasUtm) {
            const utmSet = {};
            for (const [key, value] of Object.entries(utmProps)) {
                if (value !== '' && value !== undefined) {
                    utmSet[key] = value;
                }
            }
            if (Object.keys(utmSet).length > 0) {
                if (merged.$set) {
                    merged.$set = { ...merged.$set, ...utmSet };
                }
                else {
                    merged.$set = utmSet;
                }
            }
        }
        return Object.keys(merged).length > 0 ? merged : undefined;
    }
    _filterSensitiveFields(props) {
        const result = {};
        for (const [key, value] of Object.entries(props)) {
            if (CONSTANTS.SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
                logger.warn(`Filtered sensitive field: ${key}`);
                continue;
            }
            result[key] = value;
        }
        return result;
    }
    static isValidEventName(eventName) {
        return typeof eventName === 'string' && eventName.trim().length > 0;
    }
}

class PresetProperties {
    constructor(adapter) {
        this._cache = null;
        this._cacheTimestamp = 0;
        this._adapter = adapter;
    }
    get() {
        const now = Date.now();
        let staticProps;
        if (this._cache && now - this._cacheTimestamp < CONSTANTS.PRESET_PROPS_CACHE_DURATION) {
            staticProps = this._cache;
        }
        else {
            try {
                this._cache = this._adapter.getPresetProperties();
                this._cacheTimestamp = now;
                staticProps = this._cache;
            }
            catch (e) {
                logger.warn('Failed to get preset properties:', e);
                this._cache = this._cache || {
                    $lib: CONSTANTS.LIB_VALUE,
                    $lib_version: CONSTANTS.SDK_VERSION,
                };
                staticProps = this._cache;
            }
        }
        try {
            const dynamicProps = this._adapter.getDynamicProperties();
            if (dynamicProps && Object.keys(dynamicProps).length > 0) {
                return { ...staticProps, ...dynamicProps };
            }
        }
        catch {
        }
        return staticProps;
    }
    invalidateCache() {
        this._cache = null;
        this._cacheTimestamp = 0;
    }
}

const LOCAL_STORAGE_DEVICE_ID_KEY = '__sensorswave_device_id';
const APP_INFO_KEY = '__sensorswave_app_info__';
function getJsb() {
    const jsb = globalThis.jsb;
    if (jsb && jsb.reflection)
        return jsb.reflection;
    return null;
}
function getSys() {
    return globalThis.cc?.sys;
}
function getLocalStorage() {
    return getSys()?.localStorage;
}
function detectRuntimePlatform() {
    const os = (getSys()?.os || '').toString().toLowerCase();
    if (os === 'ios' || os === 'iphone os')
        return 'ios';
    if (os === 'android')
        return 'android';
    if (os === 'ohos' || os === 'harmonyos')
        return 'harmonyos';
    return 'unknown';
}
function parseIosModelFromUA() {
    try {
        const ua = globalThis.navigator?.userAgent || '';
        if (!ua)
            return '';
        if (/iPad/.test(ua))
            return 'iPad';
        if (/iPod/.test(ua))
            return 'iPod touch';
        if (/iPhone/.test(ua))
            return 'iPhone';
    }
    catch {
    }
    return '';
}
function tryJsbIosAppName() {
    if (detectRuntimePlatform() !== 'ios')
        return '';
    const jsb = getJsb();
    if (!jsb || typeof jsb.callStaticMethod !== 'function')
        return '';
    for (const m of ['appName', 'getAppName', 'displayName', 'getDisplayName']) {
        try {
            const v = jsb.callStaticMethod('NSBundle', m, '@');
            if (v)
                return String(v);
        }
        catch {
        }
    }
    return '';
}
function tryJsbIosAppVersion() {
    if (detectRuntimePlatform() !== 'ios')
        return '';
    const jsb = getJsb();
    if (!jsb || typeof jsb.callStaticMethod !== 'function')
        return '';
    for (const m of ['appVersion', 'getAppVersion', 'shortVersionString', 'getShortVersionString']) {
        try {
            const v = jsb.callStaticMethod('NSBundle', m, '@');
            if (v)
                return String(v);
        }
        catch {
        }
    }
    return '';
}
function generateUUID() {
    const g = globalThis;
    if (g.crypto && typeof g.crypto.randomUUID === 'function') {
        return g.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
class NativeBridge {
    constructor(sys) {
        this._userFn = null;
        this._cache = null;
        this._inflight = null;
        this._networkTypeCache = null;
        this._networkEventsSubscribed = false;
        this._networkPollTimer = null;
        this._networkPollCount = 0;
        this._bridgeHealthCheckTimer = null;
        this._sys = sys;
        this._subscribeNetworkEvents();
        this._tryReadNetworkTypeImmediately();
        this._scheduleBridgeHealthCheck();
    }
    _subscribeNetworkEvents() {
        if (this._networkEventsSubscribed)
            return;
        if (typeof globalThis === 'undefined')
            return;
        try {
            const cc = globalThis.cc;
            const handler = (nt) => {
                if (nt == null)
                    return;
                this._networkTypeCache = String(nt);
            };
            if (cc?.event?.on) {
                cc.event.on('network-type-change', handler);
                if (cc.EventType && cc.EventType.NETWORK_TYPE_CHANGED) {
                    cc.event.on(cc.EventType.NETWORK_TYPE_CHANGED, handler);
                }
            }
            if (cc?.sys?.on) {
                cc.sys.on('network-type-change', handler);
            }
            this._networkEventsSubscribed = true;
        }
        catch {
        }
    }
    _readNetworkType() {
        try {
            const g = globalThis;
            if (g.__sensorswave_network_type__) {
                return String(g.__sensorswave_network_type__);
            }
            const live = this._sys?.networkType;
            if (live)
                return String(live);
        }
        catch {
        }
        return this._networkTypeCache || '';
    }
    _tryReadNetworkTypeImmediately() {
        try {
            const g = globalThis;
            if (g.__sensorswave_network_type__) {
                this._networkTypeCache = String(g.__sensorswave_network_type__);
            }
            if (!this._networkTypeCache) {
                const cc = g.cc;
                if (cc?.sys?.getNetworkType && typeof cc.sys.getNetworkType === 'function') {
                    try {
                        const nt = cc.sys.getNetworkType();
                        if (nt)
                            this._networkTypeCache = String(nt);
                    }
                    catch {
                    }
                }
                if (!this._networkTypeCache) {
                    try {
                        const conn = g.navigator?.connection;
                        if (conn) {
                            if (conn.type) {
                                this._networkTypeCache =
                                    conn.type === 'wifi' ? 'LAN' : String(conn.type).toUpperCase();
                            }
                            else if (typeof conn.effectiveType === 'string') {
                                this._networkTypeCache = String(conn.effectiveType).toUpperCase();
                            }
                        }
                    }
                    catch {
                    }
                }
            }
        }
        catch {
        }
        if (!this._networkTypeCache) {
            this._scheduleNetworkPoll();
        }
    }
    _scheduleNetworkPoll() {
        if (this._networkPollTimer)
            return;
        if (this._networkPollCount >= NativeBridge.NETWORK_POLL_MAX)
            return;
        const g = globalThis;
        if (typeof g.setTimeout !== 'function')
            return;
        this._networkPollTimer = g.setTimeout(() => {
            this._networkPollTimer = null;
            this._networkPollCount++;
            try {
                const live = this._sys?.networkType;
                if (live) {
                    this._networkTypeCache = String(live);
                    return;
                }
            }
            catch {
            }
            this._scheduleNetworkPoll();
        }, NativeBridge.NETWORK_POLL_INTERVAL_MS);
        if (this._networkPollTimer && typeof this._networkPollTimer.unref === 'function') {
            try {
                this._networkPollTimer.unref();
            }
            catch {
            }
        }
    }
    dispose() {
        if (this._networkPollTimer) {
            const g = globalThis;
            if (typeof g.clearTimeout === 'function') {
                g.clearTimeout(this._networkPollTimer);
            }
            this._networkPollTimer = null;
        }
        if (this._bridgeHealthCheckTimer) {
            const g = globalThis;
            if (typeof g.clearTimeout === 'function') {
                g.clearTimeout(this._bridgeHealthCheckTimer);
            }
            this._bridgeHealthCheckTimer = null;
        }
    }
    _scheduleBridgeHealthCheck() {
        if (this._bridgeHealthCheckTimer)
            return;
        if (typeof globalThis === 'undefined')
            return;
        const g = globalThis;
        if (typeof g.setTimeout !== 'function')
            return;
        this._bridgeHealthCheckTimer = g.setTimeout(() => {
            this._bridgeHealthCheckTimer = null;
            const platform = detectRuntimePlatform();
            if (platform === 'unknown')
                return;
            const appInfo = g.__sensorswave_app_info__;
            if (appInfo && typeof appInfo === 'object' && (appInfo.appId || appInfo.appName)) {
                return;
            }
            const platformName = platform === 'ios'
                ? 'iOS'
                : platform === 'android'
                    ? 'Android'
                    : platform === 'harmonyos'
                        ? 'HarmonyOS'
                        : platform;
            logger.warn(`[NativeBridge] ${platformName} 端原生桥未注入 ${APP_INFO_KEY}，` +
                `${platformName} 平台预置属性（$app_id / $app_name / $manufacturer / $model / $region 等）将全部为空，` +
                `请检查 SensorsWaveBridge 集成步骤。`);
        }, NativeBridge.BRIDGE_HEALTH_CHECK_DELAY_MS);
        if (this._bridgeHealthCheckTimer && typeof this._bridgeHealthCheckTimer.unref === 'function') {
            try {
                this._bridgeHealthCheckTimer.unref();
            }
            catch {
            }
        }
    }
    setUserFn(fn) {
        this._userFn = fn;
        this._cache = null;
        this._inflight = null;
    }
    invalidateCache() {
        this._cache = null;
        this._inflight = null;
    }
    getDeviceInfoSync() {
        if (this._cache) {
            try {
                const g = globalThis;
                const injected = g.__sensorswave_app_info__;
                if (injected && typeof injected === 'object' && (injected.appId || injected.model)) {
                    this._cache = null;
                }
            }
            catch {
            }
        }
        if (this._cache)
            return this._cache;
        return this._readFromSysAndAutoFill();
    }
    getDeviceInfoAsync() {
        if (this._cache)
            return Promise.resolve(this._cache);
        if (this._inflight)
            return this._inflight;
        this._inflight = (async () => {
            try {
                const result = await this._fetchWithFallback();
                this._cache = result;
                return result;
            }
            finally {
                this._inflight = null;
            }
        })();
        return this._inflight;
    }
    _readFromSysAndAutoFill() {
        const result = this._readFromSys();
        const injectedAppInfo = this._readInjectedAppInfo();
        const platform = detectRuntimePlatform();
        if (!result.deviceId)
            result.deviceId = this._readOrGenerateDeviceId();
        if (!result.appId) {
            if (platform === 'harmonyos' && this._sys?.appId) {
                result.appId = String(this._sys.appId);
            }
            result.appId = result.appId || injectedAppInfo.appId || '';
        }
        if (!result.appName) {
            let jsbAppName = '';
            if (platform === 'ios' && !injectedAppInfo.appName) {
                jsbAppName = tryJsbIosAppName();
            }
            const sysAppName = platform === 'harmonyos' && this._sys?.appName ? String(this._sys.appName) : '';
            result.appName = jsbAppName || sysAppName || injectedAppInfo.appName || '';
        }
        if (!result.appVersion) {
            let jsbAppVersion = '';
            if (platform === 'ios' && !injectedAppInfo.appVersion) {
                jsbAppVersion = tryJsbIosAppVersion();
            }
            const sysAppVersion = platform === 'harmonyos' && this._sys?.appVersion ? String(this._sys.appVersion) : '';
            result.appVersion = jsbAppVersion || sysAppVersion || injectedAppInfo.appVersion || '';
        }
        if (!result.region) {
            const sysRegion = platform === 'harmonyos' ? this._sys?.region || this._sys?.countryCode || '' : '';
            result.region = sysRegion || injectedAppInfo.region || '';
        }
        if (injectedAppInfo.model) {
            result.model = injectedAppInfo.model;
        }
        else if ((platform === 'android' || platform === 'harmonyos') && !result.model) {
            result.model = this._sys?.model ? String(this._sys.model) : '';
        }
        if (injectedAppInfo.brand) {
            result.brand = injectedAppInfo.brand;
        }
        else if ((platform === 'android' || platform === 'harmonyos') && !result.brand) {
            result.brand = this._sys?.brand ? String(this._sys.brand) : '';
        }
        if (injectedAppInfo.manufacturer) {
            result.manufacturer = injectedAppInfo.manufacturer;
        }
        else if ((platform === 'android' || platform === 'harmonyos') && !result.manufacturer) {
            result.manufacturer = this._sys?.vendor ? String(this._sys.vendor) : '';
        }
        if (!result.model && platform === 'ios') {
            result.model = parseIosModelFromUA();
        }
        if (!result.manufacturer && platform === 'ios')
            result.manufacturer = 'Apple';
        if (!result.brand && platform === 'ios')
            result.brand = 'Apple';
        if (!result.manufacturer && platform === 'android') {
            const v = this._tryJsbAndroidStaticField('android/os/Build', 'MANUFACTURER');
            if (v)
                result.manufacturer = v;
        }
        if (!result.model && platform === 'android') {
            const v = this._tryJsbAndroidStaticField('android/os/Build', 'MODEL');
            if (v)
                result.model = v;
        }
        if (!result.brand && platform === 'android') {
            const v = this._tryJsbAndroidStaticField('android/os/Build', 'BRAND');
            if (v)
                result.brand = v;
        }
        return result;
    }
    _readInjectedAppInfo() {
        const empty = {
            appId: '',
            appName: '',
            appVersion: '',
            region: '',
            model: '',
            brand: '',
            manufacturer: '',
        };
        try {
            const g = globalThis;
            for (const key of [
                '__sensorswave_app_info__',
                'SensorsWaveAppInfo',
                'sensorsAppInfo',
                '__SW_APP_INFO__',
            ]) {
                const v = g[key];
                if (v && typeof v === 'object') {
                    return {
                        appId: v.appId || v.bundleId || v.packageName || '',
                        appName: v.appName || v.name || '',
                        appVersion: v.appVersion || v.version || '',
                        region: v.region || v.country || v.countryCode || '',
                        model: v.model || v.deviceModel || '',
                        brand: v.brand || v.deviceBrand || '',
                        manufacturer: v.manufacturer || v.deviceManufacturer || v.vendor || '',
                    };
                }
            }
        }
        catch {
        }
        return empty;
    }
    readNetworkType() {
        return this._readNetworkType();
    }
    _fetchWithFallback() {
        if (this._userFn) {
            return (async () => {
                try {
                    const r = await this._userFn();
                    if (r && typeof r === 'object') {
                        const merged = this._mergeWithSysAndAutoFill(r);
                        if (this._isUseful(merged))
                            return merged;
                    }
                    return this._readFromSysAndAutoFill();
                }
                catch {
                    return this._readFromSysAndAutoFill();
                }
            })();
        }
        return Promise.resolve(this._readFromSysAndAutoFill());
    }
    _mergeWithSysAndAutoFill(info) {
        const sys = this._readFromSysAndAutoFill();
        return {
            deviceId: info.deviceId || sys.deviceId,
            appId: info.appId || sys.appId,
            appName: info.appName || sys.appName,
            appVersion: info.appVersion || sys.appVersion,
            manufacturer: info.manufacturer || sys.manufacturer,
            brand: info.brand || sys.brand,
            model: info.model || sys.model,
            osVersion: info.osVersion || sys.osVersion,
            region: info.region || sys.region,
        };
    }
    _readFromSys() {
        const result = {};
        const v = (key) => this._sys?.[key];
        const setIf = (key, sysKey) => {
            const val = v(sysKey);
            if (val)
                result[key] = String(val);
        };
        setIf('deviceId', 'deviceId');
        setIf('appId', 'appId');
        setIf('appName', 'appName');
        setIf('appVersion', 'appVersion');
        setIf('manufacturer', 'manufacturer');
        setIf('brand', 'brand');
        setIf('model', 'model');
        setIf('osVersion', 'osVersion');
        setIf('region', 'region');
        return result;
    }
    _isUseful(info) {
        return !!(info.deviceId ||
            info.appId ||
            info.appName ||
            info.appVersion ||
            info.model ||
            info.manufacturer ||
            info.brand);
    }
    _readOrGenerateDeviceId() {
        try {
            const ls = getLocalStorage();
            if (ls && typeof ls.getItem === 'function') {
                const existing = ls.getItem(LOCAL_STORAGE_DEVICE_ID_KEY);
                if (existing)
                    return existing;
                const generated = generateUUID();
                try {
                    ls.setItem(LOCAL_STORAGE_DEVICE_ID_KEY, generated);
                }
                catch {
                }
                return generated;
            }
        }
        catch {
        }
        return generateUUID();
    }
    _tryJsbAndroidStaticField(className, fieldName) {
        const platform = detectRuntimePlatform();
        if (platform !== 'android')
            return '';
        const jsb = getJsb();
        if (!jsb || typeof jsb.callStaticMethod !== 'function')
            return '';
        const getter = `get${fieldName}`;
        for (const classVariant of [className, className.replace(/\//g, '.')]) {
            try {
                const v = jsb.callStaticMethod(classVariant, getter, '()Ljava/lang/String;');
                if (v)
                    return String(v);
            }
            catch {
            }
        }
        return '';
    }
}
NativeBridge.NETWORK_POLL_MAX = 10;
NativeBridge.NETWORK_POLL_INTERVAL_MS = 1000;
NativeBridge.BRIDGE_HEALTH_CHECK_DELAY_MS = 3000;

function detectEngineVersion() {
    try {
        const cc = globalThis.cc;
        const ver = cc?.ENGINE_VERSION;
        if (typeof ver !== 'string')
            return 2;
        return ver.trim().startsWith('3.') ? 3 : 2;
    }
    catch {
        return 2;
    }
}

function parseQuerySafe(query) {
    if (!query)
        return {};
    try {
        if (typeof URLSearchParams !== 'undefined') {
            const params = new URLSearchParams(query);
            const out = {};
            params.forEach((v, k) => {
                if (!Object.prototype.hasOwnProperty.call(out, k))
                    out[k] = v;
            });
            return out;
        }
    }
    catch {
    }
    const s = query.startsWith('?') ? query.slice(1) : query;
    const out = {};
    for (const pair of s.split('&')) {
        if (!pair)
            continue;
        const eq = pair.indexOf('=');
        let k;
        let v;
        if (eq < 0) {
            k = pair;
            v = '';
        }
        else {
            k = pair.slice(0, eq);
            v = pair.slice(eq + 1);
        }
        try {
            const decodeForm = (s) => decodeURIComponent(s.replace(/\+/g, ' '));
            k = decodeForm(k);
            v = decodeForm(v);
        }
        catch {
        }
        if (!Object.prototype.hasOwnProperty.call(out, k))
            out[k] = v;
    }
    return out;
}
function generateUuidSafe() {
    try {
        const c = globalThis.crypto;
        if (c && typeof c.randomUUID === 'function') {
            return c.randomUUID();
        }
    }
    catch {
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
        const r = (Math.random() * 16) | 0;
        const v = ch === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function createV2Adapter() {
    return {
        version: 2,
        getPlatformEnum: () => {
            try {
                const sys = globalThis.cc?.sys;
                if (!sys || typeof sys !== 'object')
                    return null;
                const merged = {};
                for (const k of Object.keys(sys)) {
                    const v = sys[k];
                    if (typeof v === 'number' && Number.isFinite(v))
                        merged[k] = v;
                }
                if (sys.Platform && typeof sys.Platform === 'object') {
                    for (const k of Object.keys(sys.Platform)) {
                        const v = sys.Platform[k];
                        if (typeof v === 'number' && Number.isFinite(v))
                            merged[k] = v;
                    }
                }
                return Object.keys(merged).length > 0 ? merged : null;
            }
            catch {
                return null;
            }
        },
        safeURLSearchParams: parseQuerySafe,
        safeUUID: generateUuidSafe,
    };
}

function createV3Adapter() {
    return {
        version: 3,
        getPlatformEnum: () => {
            try {
                const sys = globalThis.cc?.sys;
                const platform = sys?.Platform;
                if (!platform || typeof platform !== 'object')
                    return null;
                const out = {};
                for (const k of Object.keys(platform)) {
                    const v = platform[k];
                    if (typeof v === 'number' && Number.isFinite(v))
                        out[k] = v;
                }
                return Object.keys(out).length > 0 ? out : null;
            }
            catch {
                return null;
            }
        },
        safeURLSearchParams: parseQuerySafe,
        safeUUID: generateUuidSafe,
    };
}

let _adapter = null;
function getEngineAdapter() {
    if (_adapter)
        return _adapter;
    const ver = detectEngineVersion();
    _adapter = ver === 3 ? createV3Adapter() : createV2Adapter();
    return _adapter;
}

const MP_SDK_GLOBALS = ['wx', 'tt', 'swan', 'my', 'qg', 'kh'];
function getMPSDK() {
    const g = globalThis;
    for (const key of MP_SDK_GLOBALS) {
        if (g[key] && typeof g[key] === 'object') {
            return g[key];
        }
    }
    return null;
}
function safeCall(sdk, method) {
    if (!sdk)
        return null;
    try {
        if (typeof sdk[method] === 'function') {
            return sdk[method]();
        }
    }
    catch {
    }
    return null;
}
function detectPlatform(ccSys) {
    if (!ccSys)
        return 'h5';
    const Platform = getEngineAdapter().getPlatformEnum() || ccSys?.Platform || ccSys;
    const num = (k) => (Platform ? Platform[k] : undefined);
    if (ccSys?.platform === num('WECHAT_GAME') ||
        ccSys?.platform === num('BYTEDANCE_MINI_GAME') ||
        ccSys?.platform === num('BYTEDANCE_GAME') ||
        ccSys?.platform === num('BAIDU_MINI_GAME') ||
        ccSys?.platform === num('BAIDU_GAME') ||
        ccSys?.platform === num('XIAOMI_MINI_GAME') ||
        ccSys?.platform === num('XIAOMI_GAME') ||
        ccSys?.platform === num('ALIPAY_MINI_GAME') ||
        ccSys?.platform === num('ALIPAY_GAME') ||
        ccSys?.platform === num('VIVO_GAME') ||
        ccSys?.platform === num('OPPO_GAME') ||
        ccSys?.platform === num('HUAWEI_GAME') ||
        ccSys?.platform === num('QQ_PLAY')) {
        return 'minigame';
    }
    if (ccSys?.platform === num('IOS') ||
        ccSys?.platform === num('IPHONE') ||
        ccSys?.platform === num('IPAD') ||
        ccSys?.platform === num('ANDROID') ||
        ccSys?.platform === num('ANDROIDOS') ||
        ccSys?.platform === num('OPENHARMONY')) {
        return 'app';
    }
    return 'h5';
}
function createPlatformAdapter(platformType, ccSys, getSceneName, getDeviceInfo) {
    switch (platformType) {
        case 'app':
            return new AppPlatformAdapter(ccSys, getSceneName, getDeviceInfo);
        case 'minigame':
            return new MPPlatformAdapter(ccSys, getSceneName);
        case 'h5':
            return new H5PlatformAdapter(ccSys);
    }
}
function formatOs(os) {
    const lower = os.toLowerCase();
    if (lower === 'ios' || lower === 'iphone os')
        return 'iOS';
    if (lower === 'android')
        return 'Android';
    if (lower === 'ohos' || lower === 'harmonyos' || lower === 'openharmony')
        return 'HarmonyOS';
    return os;
}
function formatOsVersion(version) {
    if (!version)
        return '';
    return version
        .replace(/^OpenHarmony[\s-]*/i, '')
        .replace(/^HarmonyOS[\s-]*/i, '')
        .replace(/^OHOS[\s-]*/i, '')
        .trim();
}
const CC_NETWORK_TYPE_ENUM_MAP = {
    '0': '',
    '1': 'wifi',
    '2': 'WWAN',
    '3': '',
};
function isWifiNetworkType(networkType) {
    if (!networkType)
        return false;
    const upper = networkType.toUpperCase();
    if (upper === 'WIFI' || upper === 'LAN')
        return true;
    if (networkType === '1')
        return true;
    return false;
}
function normalizeNetworkType(networkType) {
    if (!networkType)
        return '';
    if (Object.prototype.hasOwnProperty.call(CC_NETWORK_TYPE_ENUM_MAP, networkType)) {
        return CC_NETWORK_TYPE_ENUM_MAP[networkType];
    }
    if (networkType.toUpperCase() === 'LAN')
        return 'wifi';
    return networkType;
}
class AppPlatformAdapter {
    constructor(sys, getSceneName, getDeviceInfo) {
        this._currentSceneName = '';
        this._previousSceneName = '';
        this._sys = sys;
        this._getSceneName = getSceneName;
        this._nativeBridge = new NativeBridge(sys);
        if (getDeviceInfo) {
            this._nativeBridge.setUserFn(getDeviceInfo);
        }
        Promise.resolve()
            .then(() => this._nativeBridge.getDeviceInfoAsync())
            .catch(() => {
        });
    }
    getPlatformType() {
        return 'app';
    }
    getPresetProperties() {
        const props = {
            $lib: CONSTANTS.LIB_VALUE,
            $lib_version: CONSTANTS.SDK_VERSION,
            $os: formatOs(this._sys.os || ''),
            $os_version: formatOsVersion(this._sys.osVersion || ''),
            $screen_width: this._resolveScreenWidth(),
            $screen_height: this._resolveScreenHeight(),
            $language: this._sys.language || '',
            $timezone_offset: -new Date().getTimezoneOffset() * 60,
            $title: '',
            $url: '',
            $referrer: '',
            $referrer_title: this._sys.referrerTitle || '',
        };
        return props;
    }
    getDynamicProperties() {
        const networkType = this._nativeBridge.readNetworkType();
        const deviceInfo = this._nativeBridge.getDeviceInfoSync();
        const currentScene = this._resolveSceneName();
        if (currentScene && currentScene !== this._currentSceneName) {
            this._previousSceneName = this._currentSceneName;
            this._currentSceneName = currentScene;
        }
        const props = {
            $screen_name: currentScene,
            $model: deviceInfo.model || this._sys.model || '',
            $brand: deviceInfo.brand || this._sys.brand || '',
            $manufacturer: deviceInfo.manufacturer || this._sys.manufacturer || '',
            $app_version: deviceInfo.appVersion || this._sys.appVersion || '',
            $device_id: deviceInfo.deviceId || this._sys.deviceId || '',
            $app_id: deviceInfo.appId || this._sys.appId || '',
            $app_name: deviceInfo.appName || this._sys.appName || '',
            $region: deviceInfo.region || this._sys.region || '',
        };
        if (networkType) {
            props.$network_type = normalizeNetworkType(networkType);
            props.$wifi = isWifiNetworkType(networkType);
        }
        if (currentScene) {
            props.$url = `cocos://${currentScene}`;
            props.$title = currentScene;
        }
        if (this._previousSceneName) {
            props.$referrer = `cocos://${this._previousSceneName}`;
            props.$referrer_title = this._previousSceneName;
        }
        return props;
    }
    getLaunchOptions() {
        try {
            if (typeof this._sys.getLaunchOptionsSync === 'function') {
                return this._sys.getLaunchOptionsSync();
            }
        }
        catch {
        }
        return {};
    }
    _resolveScreenWidth() {
        const fromSys = Number(this._sys.screenWidth);
        if (fromSys > 0)
            return fromSys;
        try {
            const view = this._sys.view || globalThis.cc?.view;
            const size = view?.getFrameSize?.();
            if (size && Number(size.width) > 0)
                return Number(size.width);
        }
        catch {
        }
        return 0;
    }
    _resolveScreenHeight() {
        const fromSys = Number(this._sys.screenHeight);
        if (fromSys > 0)
            return fromSys;
        try {
            const view = this._sys.view || globalThis.cc?.view;
            const size = view?.getFrameSize?.();
            if (size && Number(size.height) > 0)
                return Number(size.height);
        }
        catch {
        }
        return 0;
    }
    _resolveSceneName() {
        if (this._getSceneName) {
            try {
                const name = this._getSceneName();
                if (name)
                    return name;
            }
            catch {
            }
        }
        try {
            const cc = globalThis.cc;
            const scene = cc?.director?.getScene?.();
            const name = scene?.name;
            if (name)
                return name;
        }
        catch {
        }
        return 'game';
    }
}
function normalizeMPNetworkType(networkType) {
    if (!networkType)
        return '';
    const lower = networkType.toLowerCase();
    if (lower === 'wifi')
        return 'wifi';
    if (lower === 'none' || lower === 'unknown')
        return '';
    if (lower === '2g' || lower === '3g' || lower === '4g' || lower === '5g') {
        return lower.toUpperCase();
    }
    return networkType;
}
class MPPlatformAdapter {
    constructor(sys, getSceneName) {
        this._systemInfo = null;
        this._asyncNetworkType = '';
        this._asyncNetworkCacheTime = 0;
        this._asyncNetworkInflight = false;
        this._networkChangeHandler = null;
        this._sys = sys;
        this._getSceneName = getSceneName || null;
        try {
            const sdk = getMPSDK();
            if (sdk && typeof sdk.getSystemInfoSync === 'function') {
                this._systemInfo = sdk.getSystemInfoSync();
            }
        }
        catch {
        }
        if (!this._sys?.networkType) {
            this._refreshAsyncNetworkType();
        }
        this._installNetworkChangeListener();
    }
    getPlatformType() {
        return 'minigame';
    }
    _refreshAsyncNetworkType() {
        if (this._asyncNetworkInflight)
            return;
        try {
            const sdk = getMPSDK();
            if (!sdk || typeof sdk.getNetworkType !== 'function')
                return;
            this._asyncNetworkInflight = true;
            sdk.getNetworkType({
                success: (res) => {
                    this._asyncNetworkType = normalizeMPNetworkType(res?.networkType || '');
                    this._asyncNetworkCacheTime = Date.now();
                    this._asyncNetworkInflight = false;
                },
                fail: () => {
                    this._asyncNetworkInflight = false;
                },
                complete: () => {
                    this._asyncNetworkInflight = false;
                },
            });
        }
        catch {
            this._asyncNetworkInflight = false;
        }
    }
    _installNetworkChangeListener() {
        try {
            const sdk = getMPSDK();
            if (!sdk || typeof sdk.onNetworkTypeChange !== 'function')
                return;
            this._networkChangeHandler = (res) => {
                this._asyncNetworkType = normalizeMPNetworkType(res?.networkType || '');
                this._asyncNetworkCacheTime = Date.now();
            };
            sdk.onNetworkTypeChange(this._networkChangeHandler);
        }
        catch {
        }
    }
    _resolveNetworkType() {
        const sysType = this._sys?.networkType;
        if (sysType) {
            return normalizeNetworkType(sysType);
        }
        const now = Date.now();
        if (!this._asyncNetworkType &&
            now - this._asyncNetworkCacheTime >= CONSTANTS.PRESET_PROPS_CACHE_DURATION) {
            this._refreshAsyncNetworkType();
        }
        return this._asyncNetworkType;
    }
    dispose() {
        try {
            const sdk = getMPSDK();
            if (sdk && this._networkChangeHandler && typeof sdk.offNetworkTypeChange === 'function') {
                sdk.offNetworkTypeChange(this._networkChangeHandler);
            }
        }
        catch {
        }
        this._networkChangeHandler = null;
    }
    getPresetProperties() {
        const props = {
            $lib: CONSTANTS.LIB_VALUE,
            $lib_version: CONSTANTS.SDK_VERSION,
        };
        const info = this._systemInfo;
        if (info) {
            const system = info.system || '';
            const spaceIdx = system.indexOf(' ');
            if (spaceIdx > 0) {
                props.$os = formatOs(system.substring(0, spaceIdx));
                props.$os_version = formatOsVersion(system.substring(spaceIdx + 1));
            }
            else {
                props.$os = formatOs(this._sys.os || system || '');
                props.$os_version = formatOsVersion(this._sys.osVersion || '');
            }
            props.$model = info.model || this._sys.model || '';
            props.$screen_width = info.screenWidth || this._sys.screenWidth || 0;
            props.$screen_height = info.screenHeight || this._sys.screenHeight || 0;
            props.$language = info.language || this._sys.language || '';
            props.$brand = info.brand || this._sys.brand || '';
            props.$manufacturer = info.manufacturer || info.brand || this._sys.manufacturer || '';
        }
        else {
            props.$os = formatOs(this._sys.os || '');
            props.$os_version = formatOsVersion(this._sys.osVersion || '');
            props.$model = this._sys.model || '';
            props.$screen_width = this._sys.screenWidth || 0;
            props.$screen_height = this._sys.screenHeight || 0;
            props.$language = this._sys.language || '';
            props.$brand = this._sys.brand || '';
            props.$manufacturer = this._sys.manufacturer || '';
        }
        props.$timezone_offset = -new Date().getTimezoneOffset() * 60;
        props.$network_type = this._resolveNetworkType();
        props.$url_path = '';
        props.$url_query = '';
        props.$referrer = '';
        props.$url = '';
        try {
            const sdk = getMPSDK();
            if (sdk) {
                const launchOptions = safeCall(sdk, 'getLaunchOptionsSync');
                if (launchOptions) {
                    if (launchOptions.path)
                        props.$url_path = launchOptions.path;
                    if (launchOptions.query && Object.keys(launchOptions.query).length > 0) {
                        props.$url_query = Object.entries(launchOptions.query)
                            .map(([k, v]) => `${k}=${v}`)
                            .join('&');
                    }
                    if (launchOptions.referrerInfo?.appId) {
                        props.$referrer = launchOptions.referrerInfo.appId;
                    }
                    let url = launchOptions.path || '';
                    if (launchOptions.query && Object.keys(launchOptions.query).length > 0) {
                        const q = Object.entries(launchOptions.query)
                            .map(([k, v]) => `${k}=${v}`)
                            .join('&');
                        url += (url.includes('?') ? '&' : '?') + q;
                    }
                    if (url)
                        props.$url = url;
                }
            }
        }
        catch {
        }
        return props;
    }
    getDynamicProperties() {
        const props = {
            $network_type: this._resolveNetworkType(),
        };
        let pathOnly = '';
        let queryStr = '';
        try {
            const sdk = getMPSDK();
            if (sdk) {
                const pages = safeCall(sdk, 'getCurrentPages');
                if (pages && pages.length > 0) {
                    const currentPage = pages[pages.length - 1];
                    if (currentPage?.route) {
                        pathOnly = currentPage.route;
                    }
                    if (currentPage?.options && Object.keys(currentPage.options).length > 0) {
                        queryStr = Object.entries(currentPage.options)
                            .map(([k, v]) => `${k}=${v}`)
                            .join('&');
                        props.$url_query = queryStr;
                    }
                }
            }
        }
        catch {
        }
        if (!pathOnly && this._getSceneName) {
            try {
                const sceneName = this._getSceneName();
                if (sceneName) {
                    pathOnly = sceneName;
                }
            }
            catch {
            }
        }
        if (pathOnly) {
            props.$url_path = pathOnly;
            props.$url = queryStr ? `${pathOnly}?${queryStr}` : pathOnly;
        }
        return props;
    }
    getLaunchOptions() {
        try {
            const g = globalThis;
            if (g.wx && typeof g.wx.getLaunchOptionsSync === 'function') {
                return g.wx.getLaunchOptionsSync();
            }
            if (typeof this._sys.getLaunchOptionsSync === 'function') {
                return this._sys.getLaunchOptionsSync();
            }
        }
        catch {
        }
        return {};
    }
}
const BROWSER_VERSION_REGEXES = {
    Edge: [/Edge?\/(\d+(\.\d+)?)/],
    Chrome: [/(Chrome|CrMo)\/(\d+(\.\d+)?)/],
    'Chrome iOS': [/CriOS\/(\d+(\.\d+)?)/],
    Firefox: [/Firefox\/(\d+(\.\d+)?)/],
    'Firefox iOS': [/FxiOS\/(\d+(\.\d+)?)/],
    Safari: [/Version\/(\d+(\.\d+)?)/],
    'Mobile Safari': [/Version\/(\d+(\.\d+)?)/],
    Opera: [/(Opera|OPR)\/(\d+(\.\d+)?)/],
    'Opera Mini': [/OPR\/(\d+(\.\d+)?)/],
    'UC Browser': [/(UCBrowser|UCWEB)\/(\d+(\.\d+)?)/],
    'Samsung Internet': [/SamsungBrowser\/(\d+(\.\d+)?)/],
    'Android Mobile': [/android\s(\d+(\.\d+)?)/i],
};
class H5PlatformAdapter {
    constructor(sys) {
        this._sys = sys;
    }
    getPlatformType() {
        return 'h5';
    }
    getPresetProperties() {
        const props = {
            $lib: CONSTANTS.LIB_VALUE,
            $lib_version: CONSTANTS.SDK_VERSION,
            $os: formatOs(this._sys.os || ''),
            $os_version: formatOsVersion(this._sys.osVersion || ''),
            $model: this._sys.model || '',
            $screen_width: this._sys.screenWidth || 0,
            $screen_height: this._sys.screenHeight || 0,
            $language: this._sys.language || '',
            $timezone_offset: -new Date().getTimezoneOffset() * 60,
        };
        try {
            const g = globalThis;
            if (g.navigator) {
                if (g.navigator.userAgent) {
                    const ua = g.navigator.userAgent;
                    props.$browser = this._detectBrowser(ua);
                    props.$browser_version = this._detectBrowserVersion(ua);
                    const detectedDevice = this._detectDevice(ua);
                    if (detectedDevice) {
                        props.$model = detectedDevice;
                    }
                }
                if (g.navigator.language) {
                    props.$language = g.navigator.language;
                }
            }
            if ((!props.$screen_width || !props.$screen_height) && g.screen) {
                if (Number(g.screen.width))
                    props.$screen_width = Number(g.screen.width);
                if (Number(g.screen.height))
                    props.$screen_height = Number(g.screen.height);
            }
            if (g.window && g.window.location) {
                props.$url = g.window.location.href || '';
                props.$pathname = g.window.location.pathname || '';
                props.$host = g.window.location.hostname || '';
            }
            if (g.window) {
                if (g.window.innerWidth) {
                    props.$viewport_width = g.window.innerWidth;
                    props.$viewport_height = g.window.innerHeight;
                }
            }
            if (g.document) {
                props.$referrer = g.document.referrer || '';
                props.$title = g.document.title || '';
                if (g.document.referrer) {
                    try {
                        props.$referrer_host = new URL(g.document.referrer).hostname;
                    }
                    catch {
                    }
                }
                props.$search_engine = this._parseSearchEngine(g.document.referrer || '');
            }
        }
        catch {
        }
        return props;
    }
    getDynamicProperties() {
        const props = {};
        try {
            const g = globalThis;
            if (g.window && g.window.location) {
                props.$url = g.window.location.href || '';
                props.$pathname = g.window.location.pathname || '';
                props.$host = g.window.location.hostname || '';
            }
            if (g.document) {
                props.$title = g.document.title || '';
                props.$referrer = g.document.referrer || '';
            }
        }
        catch {
        }
        return props;
    }
    _parseSearchEngine(referrer) {
        if (!referrer)
            return '';
        try {
            const hostname = new URL(referrer).hostname.toLowerCase();
            if (hostname.includes('google'))
                return 'google';
            if (hostname.includes('baidu'))
                return 'baidu';
            if (hostname.includes('bing'))
                return 'bing';
            if (hostname.includes('yahoo'))
                return 'yahoo';
            if (hostname.includes('sogou'))
                return 'sogou';
            if (hostname.includes('so.com') || hostname.includes('360'))
                return '360';
            if (hostname.includes('shenma'))
                return 'shenma';
        }
        catch {
        }
        return '';
    }
    _detectBrowser(ua) {
        if (ua.includes(' OPR/') && ua.includes('Mini'))
            return 'Opera Mini';
        if (ua.includes(' OPR/'))
            return 'Opera';
        if (ua.includes('SamsungBrowser'))
            return 'Samsung Internet';
        if (ua.includes('Edg/') || ua.includes('Edge'))
            return 'Edge';
        if (ua.includes('UCWEB') || ua.includes('UCBrowser'))
            return 'UC Browser';
        if (ua.includes('CriOS'))
            return 'Chrome iOS';
        if (ua.includes('CrMo'))
            return 'Chrome';
        if (ua.includes('Chrome'))
            return 'Chrome';
        if (ua.includes('Android') && ua.includes('Safari'))
            return 'Android Mobile';
        if (ua.includes('FxiOS'))
            return 'Firefox iOS';
        if (ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Android')) {
            return ua.includes('Mobile') ? 'Mobile Safari' : 'Safari';
        }
        if (ua.includes('Firefox'))
            return 'Firefox';
        return '';
    }
    _detectBrowserVersion(ua) {
        const browser = this._detectBrowser(ua);
        const regexes = BROWSER_VERSION_REGEXES[browser];
        if (!regexes)
            return 0;
        for (const regex of regexes) {
            const matches = ua.match(regex);
            if (matches) {
                return parseFloat(matches[matches.length - 2]);
            }
        }
        return 0;
    }
    _detectDevice(ua) {
        if (/iPad/.test(ua))
            return 'iPad';
        if (/iPod/.test(ua))
            return 'iPod Touch';
        if (/iPhone/.test(ua))
            return 'iPhone';
        if (/(HUAWEI|honor|HONOR)/.test(ua))
            return 'Huawei';
        if (/(Xiaomi|Redmi)/.test(ua))
            return 'Xiaomi';
        if (/(OPPO|realme)/.test(ua))
            return 'OPPO';
        if (/(vivo|IQOO)/.test(ua))
            return 'vivo';
        if (/BlackBerry|PlayBook|BB10/.test(ua))
            return 'BlackBerry';
        if (/Android/i.test(ua)) {
            if (!/Mobile/i.test(ua)) {
                return 'Android Tablet';
            }
            return 'Android';
        }
        return '';
    }
    getLaunchOptions() {
        try {
            const g = globalThis;
            if (g.window && g.window.location) {
                const search = g.window.location.search;
                if (search) {
                    const params = getEngineAdapter().safeURLSearchParams(search);
                    return { query: params };
                }
            }
        }
        catch {
        }
        return {};
    }
}

class PluginManager {
    constructor(emitter) {
        this._pluginClasses = [];
        this._pluginInsMap = new Map();
        this._emitter = emitter;
    }
    register(pluginClass) {
        if (!pluginClass.NAME) {
            logger.warn('Plugin must have a static NAME property, skipping registration');
            return;
        }
        this._pluginClasses.push(pluginClass);
    }
    created(opts) {
        for (const PluginClass of this._pluginClasses) {
            try {
                const instance = new PluginClass(opts);
                this._pluginInsMap.set(PluginClass.NAME, instance);
            }
            catch (e) {
                logger.error(`Failed to create plugin ${PluginClass.NAME}:`, e);
            }
        }
        this._emitter.on('INIT_READY', () => {
            this.initAll();
        });
    }
    initAll() {
        for (const [name, plugin] of this._pluginInsMap) {
            try {
                plugin.init();
            }
            catch (e) {
                logger.error(`Failed to init plugin ${name}:`, e);
            }
        }
    }
    getPlugin(name) {
        return this._pluginInsMap.get(name);
    }
    getAllPlugins() {
        return this._pluginInsMap;
    }
    destroy() {
        for (const [name, plugin] of this._pluginInsMap) {
            try {
                plugin.destroy();
            }
            catch (e) {
                logger.error(`Failed to destroy plugin ${name}:`, e);
            }
        }
        this._pluginInsMap.clear();
        this._pluginClasses = [];
    }
}

class GameLifecyclePlugin {
    constructor(opts) {
        this.NAME = 'GameLifecycle';
        this._startTimestamp = 0;
        this._pageShowTimestamp = 0;
        this._onShowHandler = null;
        this._onHideHandler = null;
        this._onShareHandler = null;
        this._destroyed = false;
        this._initTimer = null;
        this._store = opts.store;
        this._send = opts.send;
        this._autoCapture = opts.autoCapture;
        this._ccGame = opts.ccGame;
        this._platformAdapter = opts.platformAdapter;
        this._enableShareTrack = !!opts.enableShareTrack;
        this._enqueueEvent = opts.enqueueEvent;
        this._flushImmediate = opts.flushImmediate;
    }
    init() {
        if (!this._autoCapture)
            return;
        const platformType = this._platformAdapter.getPlatformType();
        this._onShowHandler = () => this._handleShow();
        this._onHideHandler = () => this._handleHide();
        try {
            if (this._ccGame && typeof this._ccGame.on === 'function') {
                this._ccGame.on(this._ccGame.EVENT_SHOW, this._onShowHandler);
                this._ccGame.on(this._ccGame.EVENT_HIDE, this._onHideHandler);
            }
        }
        catch (e) {
            logger.warn('Failed to register game lifecycle events:', e);
        }
        this._initTimer = setTimeout(() => {
            this._initTimer = null;
            if (this._destroyed)
                return;
            if (platformType === 'app') {
                this._initAppLifecycle();
            }
            else if (platformType === 'minigame') {
                this._initMinigameLifecycle();
                if (this._enableShareTrack) {
                    this._initShareTracking();
                }
            }
            else {
                this._initH5Lifecycle();
            }
        }, 0);
    }
    _initAppLifecycle() {
        if (!this._store.isLaunched()) {
            this._trackAppInstall();
            this._store.setLaunched();
        }
        this._handleShow();
    }
    _initMinigameLifecycle() {
        this._trackMPLaunch();
        if (!this._store.isLaunched()) {
            this._store.setLaunched();
        }
        this._handleMPShow();
    }
    _initH5Lifecycle() {
        this._scheduleH5PageEvents();
        this._pageShowTimestamp = Date.now();
        try {
            const g = globalThis;
            if (g.window) {
                if (typeof g.window.addEventListener === 'function') {
                    g.window.addEventListener('beforeunload', this._handleH5PageLeave.bind(this));
                }
            }
        }
        catch {
        }
    }
    _scheduleH5PageEvents() {
        const g = globalThis;
        const fire = () => {
            this._trackH5PageView();
            this._trackH5PageLoad();
        };
        if (g.document?.readyState === 'complete') {
            fire();
            return;
        }
        try {
            if (g.window && typeof g.window.addEventListener === 'function') {
                g.window.addEventListener('load', fire);
            }
            else {
                fire();
            }
        }
        catch {
            fire();
        }
    }
    _handleShow() {
        const platformType = this._platformAdapter.getPlatformType();
        if (platformType === 'minigame') {
            this._handleMPShow();
        }
        else if (platformType === 'app') {
            this._handleAppShow();
        }
    }
    _handleHide() {
        const platformType = this._platformAdapter.getPlatformType();
        if (platformType === 'minigame') {
            this._handleMPHide();
        }
        else if (platformType === 'app') {
            this._handleAppHide();
        }
    }
    _trackAppInstall() {
        const event = this._send.sendEvent('$AppInstall');
        this._enqueueEvent(event);
    }
    _handleAppShow() {
        this._startTimestamp = Date.now();
        const event = this._send.sendEvent('$AppStart');
        this._enqueueEvent(event);
    }
    _handleAppHide() {
        const duration = this._startTimestamp > 0 ? Math.floor((Date.now() - this._startTimestamp) / 1000) : 0;
        const event = this._send.sendEvent('$AppEnd', {
            $event_duration: duration,
        });
        this._enqueueEvent(event);
        this._flushImmediate();
    }
    _extractLaunchProps() {
        const launchOptions = this._platformAdapter.getLaunchOptions();
        const props = {};
        if (launchOptions?.scene !== undefined)
            props.$scene = launchOptions.scene;
        if (launchOptions?.path)
            props.$url_path = launchOptions.path;
        if (launchOptions?.query && Object.keys(launchOptions.query).length > 0) {
            props.$url_query = Object.entries(launchOptions.query)
                .map(([k, v]) => `${k}=${v}`)
                .join('&');
        }
        return props;
    }
    _trackMPLaunch() {
        const event = this._send.sendEvent('$MPLaunch', this._extractLaunchProps());
        this._enqueueEvent(event);
    }
    _handleMPShow() {
        this._startTimestamp = Date.now();
        const event = this._send.sendEvent('$MPShow', this._extractLaunchProps());
        this._enqueueEvent(event);
    }
    _handleMPHide() {
        const duration = this._startTimestamp > 0 ? Math.floor((Date.now() - this._startTimestamp) / 1000) : 0;
        const event = this._send.sendEvent('$MPHide', {
            $event_duration: duration,
        });
        this._enqueueEvent(event);
        this._flushImmediate();
    }
    _trackH5PageView() {
        const event = this._send.sendEvent('$PageView');
        this._enqueueEvent(event);
    }
    _scheduleH5PageLoad() {
        const g = globalThis;
        if (g.document?.readyState === 'complete') {
            this._trackH5PageLoad();
            return;
        }
        try {
            if (g.window && typeof g.window.addEventListener === 'function') {
                g.window.addEventListener('load', () => {
                    this._trackH5PageLoad();
                });
            }
        }
        catch {
            this._trackH5PageLoad();
        }
    }
    _trackH5PageLoad() {
        const g = globalThis;
        const loadStart = g.performance?.timing?.navigationStart;
        const loadEnd = g.performance?.timing?.loadEventEnd;
        const props = {};
        if (loadStart && loadEnd) {
            props.$event_duration = Math.floor((loadEnd - loadStart) / 1000);
        }
        const event = this._send.sendEvent('$PageLoad', props);
        this._enqueueEvent(event);
    }
    _handleH5PageLeave() {
        const duration = this._pageShowTimestamp > 0
            ? Math.min(Math.floor((Date.now() - this._pageShowTimestamp) / 1000), 432000)
            : 0;
        const event = this._send.sendEvent('$PageLeave', {
            $event_duration: duration,
        });
        this._enqueueEvent(event);
        this._flushImmediate();
    }
    _initShareTracking() {
        try {
            const sdk = getMPSDK();
            if (!sdk || typeof sdk.onShareAppMessage !== 'function')
                return;
            this._onShareHandler = (res) => {
                const from = res && typeof res.from === 'string' ? res.from : 'unknown';
                const event = this._send.sendEvent('$MPShare', {
                    $share_from: from,
                    $channel: 'minigame',
                });
                this._enqueueEvent(event);
                this._flushImmediate();
            };
            sdk.onShareAppMessage(this._onShareHandler);
        }
        catch (e) {
            logger.warn('Failed to register share tracking:', e);
        }
    }
    destroy() {
        this._destroyed = true;
        if (this._initTimer) {
            clearTimeout(this._initTimer);
            this._initTimer = null;
        }
        if (this._ccGame && typeof this._ccGame.off === 'function') {
            if (this._onShowHandler)
                this._ccGame.off(this._ccGame.EVENT_SHOW, this._onShowHandler);
            if (this._onHideHandler)
                this._ccGame.off(this._ccGame.EVENT_HIDE, this._onHideHandler);
        }
        if (this._onShareHandler) {
            try {
                const sdk = getMPSDK();
                if (sdk && typeof sdk.offShareAppMessage === 'function') {
                    sdk.offShareAppMessage(this._onShareHandler);
                }
            }
            catch {
            }
        }
        this._onShowHandler = null;
        this._onHideHandler = null;
        this._onShareHandler = null;
    }
}
GameLifecyclePlugin.NAME = 'GameLifecycle';

class UTMPlugin {
    constructor(opts) {
        this.NAME = 'UTM';
        this._currentUtm = {};
        this._destroyed = false;
        this._userSetTimer = null;
        this._store = opts.store;
        this._send = opts.send;
        this._platformAdapter = opts.platformAdapter;
        this._enqueueEvent = opts.enqueueEvent;
        this._extractUTM();
        this._send.setUtmProvider(() => this.getSessionUTM());
    }
    init() {
        this._reportInitialUTM();
    }
    setDeepLinkQuery(query) {
        if (!query)
            return;
        try {
            const merged = {};
            if (typeof query === 'string') {
                const qValue = query.startsWith('?') ? query.substring(1) : query;
                this._parseUTMFromQuery('?' + qValue, merged);
                try {
                    this._parseUTMFromQuery('?' + decodeURIComponent(qValue), merged);
                }
                catch {
                }
            }
            else {
                this._parseUTMFromQuery(query, merged);
                if (typeof query.q === 'string' && query.q) {
                    this._parseUTMFromURL(decodeURIComponent(query.q), merged);
                }
                if (typeof query.scene === 'string' && query.scene) {
                    let decoded = query.scene;
                    try {
                        decoded = decodeURIComponent(query.scene);
                    }
                    catch {
                    }
                    this._parseUTMFromQuery(decoded, merged);
                }
            }
            let hasNew = false;
            for (const [key, value] of Object.entries(merged)) {
                if (typeof value === 'string' && value.trim() !== '' && !this._currentUtm[key]) {
                    this._currentUtm[key] = value.trim();
                    hasNew = true;
                }
            }
            if (hasNew) {
                this._reportInitialUTM();
            }
        }
        catch (e) {
            logger.warn('Failed to handle deep link UTM parameters:', e);
        }
    }
    _extractUTM() {
        try {
            const launchOptions = this._platformAdapter.getLaunchOptions();
            const query = launchOptions?.query || launchOptions || {};
            const merged = {};
            const qValue = typeof query.q === 'string' ? query.q : '';
            if (qValue) {
                this._parseUTMFromURL(decodeURIComponent(qValue), merged);
            }
            const sceneValue = typeof query.scene === 'string' ? query.scene : '';
            if (sceneValue) {
                let decoded = sceneValue;
                try {
                    decoded = decodeURIComponent(sceneValue);
                }
                catch {
                }
                this._parseUTMFromQuery(decoded, merged);
            }
            this._parseUTMFromQuery(query, merged);
            for (const [key, value] of Object.entries(merged)) {
                if (typeof value === 'string' && value.trim() !== '') {
                    this._currentUtm[key] = value.trim();
                }
            }
        }
        catch (e) {
            logger.warn('Failed to extract UTM parameters:', e);
        }
    }
    _parseUTMFromQuery(source, target) {
        if (typeof source === 'string') {
            try {
                const urlObj = new URL(source, 'https://placeholder.com');
                for (const key of CONSTANTS.UTM_KEYS) {
                    const value = urlObj.searchParams.get(key);
                    if (value)
                        target[key] = value;
                }
            }
            catch {
                const pairs = source.split('&');
                for (const pair of pairs) {
                    const eqIndex = pair.indexOf('=');
                    if (eqIndex === -1)
                        continue;
                    const k = pair.substring(0, eqIndex);
                    const v = pair.substring(eqIndex + 1);
                    if (CONSTANTS.UTM_KEYS.includes(k) && v) {
                        target[k] = v;
                    }
                }
            }
            return;
        }
        for (const key of CONSTANTS.UTM_KEYS) {
            const value = source[key];
            if (typeof value === 'string' && value.trim() !== '') {
                target[key] = value.trim();
            }
        }
    }
    _parseUTMFromURL(urlStr, target) {
        try {
            const urlObj = new URL(urlStr);
            for (const key of CONSTANTS.UTM_KEYS) {
                const value = urlObj.searchParams.get(key);
                if (value)
                    target[key] = value;
            }
        }
        catch {
            this._parseUTMFromQuery(urlStr, target);
        }
    }
    _reportInitialUTM() {
        const userProperties = {
            $set_once: {},
        };
        for (const key of CONSTANTS.UTM_KEYS) {
            userProperties.$set_once[`$initial_${key}`] =
                this._currentUtm[key] || '';
        }
        const event = this._send.sendEvent('$UserSet', {}, userProperties);
        if (event.user_properties) {
            delete event.user_properties.$set;
        }
        this._userSetTimer = setTimeout(() => {
            this._userSetTimer = null;
            if (this._destroyed)
                return;
            try {
                this._enqueueEvent(event);
            }
            catch (e) {
            }
        }, 0);
    }
    getSessionUTM() {
        const result = {};
        for (const [key, value] of Object.entries(this._currentUtm)) {
            if (value && value.trim() !== '') {
                result[`$${key}`] = value;
            }
        }
        return result;
    }
    destroy() {
        this._destroyed = true;
        if (this._userSetTimer) {
            clearTimeout(this._userSetTimer);
            this._userSetTimer = null;
        }
    }
}
UTMPlugin.NAME = 'UTM';

var ABType;
(function (ABType) {
    ABType[ABType["FEATURE_GATE"] = 1] = "FEATURE_GATE";
    ABType[ABType["FEATURE_CONFIG"] = 2] = "FEATURE_CONFIG";
    ABType[ABType["EXPERIMENT"] = 3] = "EXPERIMENT";
})(ABType || (ABType = {}));
function getABPropKey(data) {
    if (data.typ === ABType.FEATURE_GATE || data.typ === ABType.FEATURE_CONFIG) {
        return `$feature_${data.id}`;
    }
    if (data.typ === ABType.EXPERIMENT) {
        return `$exp_${data.id}`;
    }
    return '';
}
function buildABEventProps(data) {
    const type = data.typ;
    if (type === ABType.FEATURE_GATE || type === ABType.FEATURE_CONFIG) {
        return {
            $feature_key: data.key,
            $feature_variant: data.vid,
        };
    }
    if (type === ABType.EXPERIMENT) {
        return {
            $exp_key: data.key,
            $exp_variant: data.vid,
        };
    }
    return {};
}
class ABTestPlugin {
    constructor(opts) {
        this.NAME = 'ABTest';
        this._fetchingPromise = null;
        this._refreshTimer = null;
        this._lastFetchTime = 0;
        this._store = opts.store;
        this._send = opts.send;
        this._enableAB = opts.enableAB;
        this._apiHost = opts.apiHost;
        this._sourceToken = opts.sourceToken;
        this._refreshInterval = Math.max(opts.refreshInterval, CONSTANTS.MIN_AB_REFRESH_INTERVAL);
        this._requestFn = opts.requestFn;
        this._enqueueEvent = opts.enqueueEvent;
    }
    init() {
        if (!this._enableAB)
            return;
        this.fastFetch();
        this._startRefreshTimer();
    }
    _startRefreshTimer() {
        if (this._refreshTimer)
            clearInterval(this._refreshTimer);
        this._refreshTimer = setInterval(() => {
            this.fastFetch();
        }, this._refreshInterval);
    }
    fastFetch() {
        const cached = this._store.getABData();
        if (cached.length > 0) {
            return Promise.resolve(cached);
        }
        if (this._fetchingPromise) {
            return this._fetchingPromise;
        }
        const now = Date.now();
        if (now - this._lastFetchTime < CONSTANTS.MIN_AB_REFRESH_INTERVAL) {
            return Promise.resolve([]);
        }
        this._fetchingPromise = this._fetchFromServer();
        return this._fetchingPromise;
    }
    _fetchFromServer() {
        return new Promise((resolve) => {
            const requestData = {
                user: {
                    anon_id: this._store.getAnonId(),
                    login_id: this._store.getLoginId() || undefined,
                },
                sdk: CONSTANTS.LIB_VALUE,
                sdk_version: CONSTANTS.SDK_VERSION,
            };
            this._requestFn({
                url: `${this._apiHost}${CONSTANTS.AB_ENDPOINT}`,
                method: 'POST',
                data: requestData,
                headers: {
                    'Content-Type': 'application/json',
                    SourceToken: this._sourceToken,
                },
                callback: (response) => {
                    this._fetchingPromise = null;
                    this._lastFetchTime = Date.now();
                    if (response.statusCode === 200 && response.json?.code === 0) {
                        const results = response.json?.data?.results || [];
                        if (results.length > 0) {
                            this._store.saveABData(results);
                        }
                        resolve(results);
                    }
                    else {
                        logger.warn('AB fetch failed:', response.statusCode);
                        resolve([]);
                    }
                },
            });
        });
    }
    checkFeatureGate(key) {
        if (!this._enableAB)
            return Promise.resolve(false);
        return this.fastFetch().then((results) => {
            const item = results.find((r) => r.key === key && r.typ === ABType.FEATURE_GATE);
            if (!item)
                return false;
            const isOn = item.vid !== 'fail' && item.vid !== undefined && item.vid !== null;
            if (!item.disable_impress) {
                if (item.vid !== undefined && item.vid !== null) {
                    this._trackFeatureImpress(item);
                }
                else {
                    this._trackFeatureImpress(item, true);
                }
            }
            return isOn;
        });
    }
    getFeatureConfig(key) {
        if (!this._enableAB)
            return Promise.resolve({});
        return this.fastFetch().then((results) => {
            const item = results.find((r) => r.key === key && r.typ === ABType.FEATURE_CONFIG);
            if (!item)
                return {};
            let value = item.value;
            if (typeof value === 'string') {
                try {
                    value = JSON.parse(value);
                }
                catch {
                }
            }
            if (!item.disable_impress) {
                if (item.vid !== undefined && item.vid !== null) {
                    this._trackFeatureImpress(item);
                }
                else {
                    this._trackFeatureImpress(item, true);
                }
            }
            return value || {};
        });
    }
    getExperiment(key) {
        if (!this._enableAB)
            return Promise.resolve(null);
        return this.fastFetch().then((results) => {
            const item = results.find((r) => r.key === key && r.typ === ABType.EXPERIMENT);
            if (!item)
                return null;
            if (!item.disable_impress) {
                if (item.vid !== undefined && item.vid !== null) {
                    this._trackExpImpress(item);
                }
                else {
                    this._trackExpImpress(item, true);
                }
            }
            return item.value || null;
        });
    }
    _trackFeatureImpress(abData, unset = false) {
        const userProps = unset
            ? { $unset: { [getABPropKey(abData)]: null } }
            : { $set: { [getABPropKey(abData)]: abData.vid } };
        const event = this._send.sendEvent('$FeatureImpress', buildABEventProps(abData), userProps);
        this._enqueueEvent(event);
    }
    _trackExpImpress(abData, unset = false) {
        const userProps = unset
            ? { $unset: { [getABPropKey(abData)]: null } }
            : { $set: { [getABPropKey(abData)]: abData.vid } };
        const event = this._send.sendEvent('$ExpImpress', buildABEventProps(abData), userProps);
        this._enqueueEvent(event);
    }
    destroy() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
        this._fetchingPromise = null;
    }
}
ABTestPlugin.NAME = 'ABTest';

class Sensorswave {
    constructor() {
        this.inited = false;
        this._config = null;
        this._store = null;
        this._queue = null;
        this._batchSender = null;
        this._batchSendEnabled = false;
        this._send = null;
        this._presetProps = null;
        this._pluginManager = null;
        this._emitter = new EventEmitter();
        this._sourceToken = '';
        this._apiHost = '';
        this._requestFn = this._defaultRequestFn.bind(this);
    }
    init(sourceToken, config) {
        if (this.inited)
            return;
        if (!sourceToken || !config?.apiHost) {
            logger.info('init() requires sourceToken and apiHost');
            return;
        }
        this._sourceToken = sourceToken;
        this._apiHost = config.apiHost;
        this._config = { ...config, sourceToken };
        const mergedConfig = { ...DEFAULT_CONFIG, ...config };
        logger.setDebug(mergedConfig.debug);
        const ccSys = this._getCCSys();
        const safeStorage = new SafeStorage(ccSys.localStorage);
        this._store = new Store(safeStorage);
        this._queue = new PersistentQueue(safeStorage);
        this._batchSender = new BatchSender(this._queue, this._requestFn, mergedConfig.maxBatchSize, mergedConfig.flushInterval);
        const platformType = detectPlatform(ccSys);
        const platformAdapter = createPlatformAdapter(platformType, ccSys, mergedConfig.getSceneName, platformType === 'app' ? mergedConfig.getDeviceInfo : undefined);
        this._presetProps = new PresetProperties(platformAdapter);
        this._send = new Send(this._store, this._presetProps);
        this._pluginManager = new PluginManager(this._emitter);
        this._pluginManager.register(GameLifecyclePlugin);
        this._pluginManager.register(UTMPlugin);
        if (mergedConfig.enableAB) {
            this._pluginManager.register(ABTestPlugin);
        }
        const pluginOpts = {
            store: this._store,
            send: this._send,
            presetProps: this._presetProps,
            queue: this._queue,
            batchSender: this._batchSender,
            autoCapture: mergedConfig.autoCapture,
            ccGame: ccSys.game || globalThis.cc?.game,
            platformAdapter,
            enableAB: mergedConfig.enableAB,
            apiHost: this._apiHost,
            sourceToken: this._sourceToken,
            refreshInterval: mergedConfig.abRefreshInterval,
            requestFn: this._requestFn,
            enableShareTrack: mergedConfig.enableShareTrack,
            enqueueEvent: (event) => this._enqueuePluginEvent(event),
            flushImmediate: () => {
                if (this._batchSender)
                    this._batchSender.flushImmediate();
            },
        };
        this._pluginManager.created(pluginOpts);
        this._batchSendEnabled = !!mergedConfig.batchSend;
        if (this._batchSendEnabled) {
            this._batchSender.start();
        }
        this.inited = true;
        this._emitter.emit('INIT_READY');
        logger.info('init success', { sourceToken, platform: platformType });
    }
    trackEvent(eventName, properties) {
        if (!this._ensureInited())
            return;
        if (!Send.isValidEventName(eventName)) {
            logger.warn('trackEvent() requires a non-empty event name');
            return;
        }
        const event = this._send.sendEvent(eventName, properties);
        this._enqueueEvent(event);
    }
    track(eventData) {
        if (!eventData || !eventData.event) {
            logger.warn('track() requires an object with an event property');
            return;
        }
        if (!this._ensureInited())
            return;
        if (!Send.isValidEventName(eventData.event)) {
            logger.warn('track() requires a non-empty event name');
            return;
        }
        const event = this._send.sendEvent(eventData.event, eventData.properties, eventData.user_properties, eventData.subject_properties);
        this._enqueueEvent(event);
    }
    identify(loginId) {
        if (!this._ensureInited())
            return;
        if (!loginId)
            return;
        const strLoginId = String(loginId);
        const currentLoginId = this._store.getLoginId();
        if (currentLoginId === strLoginId)
            return;
        this._store.setLoginId(strLoginId);
        const event = this._send.sendEvent('$Identify', undefined, undefined);
        event.login_id = strLoginId;
        this._enqueueEvent(event);
    }
    setLoginId(loginId) {
        if (!this._ensureInited())
            return;
        this._store.setLoginId(String(loginId));
    }
    getAnonId() {
        if (!this._store)
            return '';
        return this._store.getAnonId();
    }
    getLoginId() {
        if (!this._store)
            return '';
        return this._store.getLoginId();
    }
    getPlugins() {
        if (!this._pluginManager)
            return new Map();
        return this._pluginManager.getAllPlugins();
    }
    registerCommonProperties(props) {
        if (!this._ensureInited())
            return;
        if (!props || typeof props !== 'object' || Array.isArray(props)) {
            logger.warn('registerCommonProperties() requires an object');
            return;
        }
        this._store.registerCommonProperties(props);
    }
    clearCommonProperties(keys) {
        if (!this._ensureInited())
            return;
        this._store.clearCommonProperties(keys);
    }
    profileSet(props) {
        this._profileOp('$set', props);
    }
    profileSetOnce(props) {
        this._profileOp('$set_once', props);
    }
    profileIncrement(props) {
        this._profileOp('$increment', props);
    }
    profileAppend(props) {
        this._profileOp('$append', props);
    }
    profileUnion(props) {
        this._profileOp('$union', props);
    }
    profileUnset(keys) {
        const unsetProps = {};
        for (const key of keys) {
            unsetProps[key] = null;
        }
        this._profileOp('$unset', unsetProps);
    }
    profileDelete() {
        if (!this._ensureInited())
            return;
        const loginId = this._store.getLoginId();
        if (!loginId && !this._store.getAnonId()) {
            logger.warn('profileDelete requires login_id or anon_id');
            return;
        }
        const userProperties = { $delete: true };
        const event = this._send.sendEvent('$UserSet', {}, userProperties);
        this._enqueueEvent(event);
    }
    checkFeatureGate(key) {
        if (!this.inited || !this._pluginManager)
            return Promise.resolve(false);
        const abPlugin = this._pluginManager.getPlugin('ABTest');
        if (!abPlugin)
            return Promise.resolve(false);
        return abPlugin.checkFeatureGate(key);
    }
    getFeatureConfig(key) {
        if (!this.inited || !this._pluginManager)
            return Promise.resolve({});
        const abPlugin = this._pluginManager.getPlugin('ABTest');
        if (!abPlugin)
            return Promise.resolve({});
        return abPlugin.getFeatureConfig(key);
    }
    getExperiment(key) {
        if (!this.inited || !this._pluginManager)
            return Promise.resolve(null);
        const abPlugin = this._pluginManager.getPlugin('ABTest');
        if (!abPlugin)
            return Promise.resolve(null);
        return abPlugin.getExperiment(key);
    }
    flush() {
        if (!this._batchSender)
            return;
        this._batchSender.flush();
    }
    setDeepLinkQuery(query) {
        if (!this.inited || !this._pluginManager)
            return;
        const utmPlugin = this._pluginManager.getPlugin('UTM');
        if (!utmPlugin)
            return;
        utmPlugin.setDeepLinkQuery(query);
    }
    destroy() {
        if (this._pluginManager) {
            this._pluginManager.destroy();
        }
        if (this._batchSender) {
            this._batchSender.destroy();
        }
        this._emitter.removeAllListeners();
        this.inited = false;
        this._store = null;
        this._queue = null;
        this._batchSender = null;
        this._batchSendEnabled = false;
        this._send = null;
        this._presetProps = null;
        this._pluginManager = null;
    }
    _profileOp(operator, props) {
        if (!this._ensureInited())
            return;
        const anonId = this._store.getAnonId();
        const loginId = this._store.getLoginId();
        if (!anonId && !loginId) {
            logger.warn('Profile operation requires login_id or anon_id');
            return;
        }
        const userProperties = { [operator]: props };
        const event = this._send.sendEvent('$UserSet', {}, userProperties);
        this._enqueueEvent(event);
    }
    _enqueuePluginEvent(event) {
        this._enqueueEvent(event);
    }
    _enqueueEvent(event) {
        this._queue.enqueue([event], `${this._apiHost}${CONSTANTS.TRACK_ENDPOINT}`, {
            'Content-Type': 'application/json',
            SourceToken: this._sourceToken,
        });
        if (this._batchSendEnabled) {
            this._batchSender.add();
        }
        else {
            this._batchSender.flush();
        }
    }
    _ensureInited() {
        if (!this.inited) {
            logger.warn('SDK not initialized. Call init() first.');
            return false;
        }
        return true;
    }
    _getCCSys() {
        try {
            const g = globalThis;
            if (g.cc && g.cc.sys)
                return g.cc.sys;
        }
        catch {
        }
        return {
            platform: -1,
            os: '',
            localStorage: {
                getItem: () => null,
                setItem: () => { },
                removeItem: () => { },
            },
            game: {},
        };
    }
    _defaultRequestFn(config) {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open(config.method || 'POST', config.url, true);
            if (config.headers) {
                for (const [key, value] of Object.entries(config.headers)) {
                    xhr.setRequestHeader(key, value);
                }
            }
            xhr.timeout = config.timeout || CONSTANTS.REQUEST_TIMEOUT;
            xhr.onreadystatechange = () => {
                if (xhr.readyState !== 4)
                    return;
                const response = {
                    statusCode: xhr.status,
                    text: xhr.responseText,
                };
                if (xhr.status === 200) {
                    try {
                        if (xhr.responseText) {
                            response.json = JSON.parse(xhr.responseText);
                        }
                    }
                    catch {
                    }
                }
                config.callback?.(response);
            };
            xhr.send(config.data ? JSON.stringify(config.data) : null);
        }
        catch (e) {
            config.callback?.({ statusCode: 0, text: String(e) });
        }
    }
}
const sensorswave = new Sensorswave();

export { Sensorswave, sensorswave as default };
