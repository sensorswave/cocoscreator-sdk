const SDK_VERSION = '1.4.2';

const DEFAULT_CONFIG = {
    debug: false,
    autoCapture: true,
    batchSend: false,
    maxBatchSize: 10,
    flushInterval: 5000,
    enableAB: false,
    abRefreshInterval: 600000,
    enableShareTrack: true,
    enableCrashTrack: false,
    enableErrorTrack: false,
    optOutCapturing: false,
    persistOptOut: false,
};
const CONSTANTS = {
    MAX_QUEUE_SIZE: 200,
    DATA_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,
    QUEUE_STORAGE_KEY: 'sw_queue',
    APP_END_DEBOUNCE_MS: 30 * 1000,
    PENDING_APP_END_KEY: 'sw_pending_app_end',
    ANON_ID_KEY: 'sw_anon_id',
    LOGIN_ID_KEY: 'sw_login_id',
    AB_DATA_KEY: 'sw_ab_data',
    SESSION_STORAGE_KEY: 'sw_session',
    SESSION_IDLE_TIMEOUT_MS: 30 * 60 * 1000,
    SESSION_MAX_DURATION_MS: 12 * 60 * 60 * 1000,
    SESSION_ACTIVITY_FLUSH_MS: 5000,
    LAUNCHED_KEY: 'sw_launched',
    OPT_OUT_KEY: 'sw_opt_out',
    INSTALL_TIME_KEY: 'sw_install_time',
    AB_CACHE_TTL: 10 * 60 * 1000,
    MIN_AB_REFRESH_INTERVAL: 30 * 1000,
    PRESET_PROPS_CACHE_DURATION: 60000,
    MAX_RETRY_COUNT: 1,
    BASE_RETRY_DELAY: 1000,
    MAX_RETRY_DELAY: 30000,
    LIB_VALUE: 'cocosCreator',
    SDK_VERSION: SDK_VERSION,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    UTM_KEYS: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'],
    TRACK_ENDPOINT: '/in/track',
    AB_ENDPOINT: '/ab/evalall',
    REQUEST_TIMEOUT: 30000,
    REQUEST_WATCHDOG_DELAY_MS: 30000 + 5000,
    SENSITIVE_KEY_PATTERNS: [
        /(?:^|[_.])(?:token|password|secret|credential|auth_key|access_key|private_key)$/i,
    ],
    EXCEPTION_EVENT_NAME: '$Exception',
    EXCEPTION_STACK_LINE_MAX_LENGTH: 1024,
    EXCEPTION_FRAMES_MAX_COUNT: 30,
    EXCEPTION_FRAME_PATH_MAX_LENGTH: 1000,
    EXCEPTION_DEDUP_WINDOW_MS: 30 * 1000,
    EXCEPTION_DEDUP_KEY_MAX_LEN: 256,
    EXCEPTION_DEDUP_MAP_MAX_SIZE: 1000,
    EXCEPTION_MAX_PER_SESSION: 20,
    NATIVE_CRASH_MAX_RECORDS: 10,
    NATIVE_CRASH_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,
    NATIVE_CRASH_FILE_NAME: 'sensorswave_pending_crashes.json',
    PENDING_CRASHES_GLOBAL_KEY: '__sensorswave_pending_crashes__',
    LAST_CRASH_TS_KEY: 'sw_last_crash_ts',
    EXCEPTION_CRASH_RECHECK_DELAYS_MS: [5000, 15000, 30000],
};

class SafeStorage {
    constructor(storage) {
        this._fallback = new Map();
        this._degraded = false;
        this._probed = false;
        this._storage = storage;
        this._degraded = false;
    }
    _probe() {
        if (this._probed)
            return;
        this._probed = true;
        try {
            this._storage.setItem('__sw_test__', '1');
            this._storage.removeItem('__sw_test__');
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
        this._probe();
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
function generateUUIDv7() {
    const ts = Date.now();
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < 16; i++) {
            bytes[i] = (Math.random() * 256) | 0;
        }
    }
    bytes[0] = ts / 2 ** 40;
    bytes[1] = ts / 2 ** 32;
    bytes[2] = ts / 2 ** 24;
    bytes[3] = ts / 2 ** 16;
    bytes[4] = ts / 2 ** 8;
    bytes[5] = ts;
    bytes[6] = 0x70 | (bytes[6] & 0x0f);
    bytes[8] = 0x80 | (bytes[8] & 0x3f);
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
    clearLoginId() {
        this._storage.removeItem(CONSTANTS.LOGIN_ID_KEY);
    }
    resetAnonId() {
        this._storage.removeItem(CONSTANTS.ANON_ID_KEY);
    }
    clearABData() {
        this._storage.removeItem(CONSTANTS.AB_DATA_KEY);
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
    savePendingAppEnd(event, hideTs, startTs) {
        this._storage.setItem(CONSTANTS.PENDING_APP_END_KEY, JSON.stringify({ hideTs, startTs, event }));
        return !this._storage.isDegraded;
    }
    getPendingAppEnd() {
        const raw = this._storage.getItem(CONSTANTS.PENDING_APP_END_KEY);
        if (!raw)
            return null;
        try {
            const cached = JSON.parse(raw);
            if (!cached ||
                !Number.isFinite(cached.hideTs) ||
                !Number.isFinite(cached.startTs) ||
                !cached.event ||
                cached.event.event !== '$AppEnd' ||
                !Number.isFinite(cached.event.time)) {
                return null;
            }
            if (Date.now() - cached.hideTs > CONSTANTS.DATA_EXPIRY_MS) {
                this.clearPendingAppEnd();
                return null;
            }
            return cached;
        }
        catch {
            return null;
        }
    }
    clearPendingAppEnd() {
        this._storage.removeItem(CONSTANTS.PENDING_APP_END_KEY);
    }
    setLaunched() {
        this._storage.setItem(CONSTANTS.LAUNCHED_KEY, '1');
    }
    isLaunched() {
        return this._storage.getItem(CONSTANTS.LAUNCHED_KEY) === '1';
    }
    getInstallTime() {
        const raw = this._storage.getItem(CONSTANTS.INSTALL_TIME_KEY);
        if (!raw)
            return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    }
    setInstallTime(ts) {
        this._storage.setItem(CONSTANTS.INSTALL_TIME_KEY, String(ts));
    }
    setOptOut(optedOut) {
        this._storage.setItem(CONSTANTS.OPT_OUT_KEY, optedOut ? '1' : '0');
    }
    isOptedOut() {
        return this._storage.getItem(CONSTANTS.OPT_OUT_KEY) === '1';
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
    incrementRetryCounts(ids) {
        if (ids.length === 0)
            return;
        const idSet = new Set(ids);
        let changed = false;
        for (const item of this._queue) {
            if (idSet.has(item.id)) {
                item.retryCount++;
                changed = true;
            }
        }
        if (changed)
            this._persist();
    }
    moveToTail(ids) {
        if (ids.length === 0)
            return;
        const idSet = new Set(ids);
        const moved = [];
        const kept = [];
        for (const item of this._queue) {
            (idSet.has(item.id) ? moved : kept).push(item);
        }
        if (moved.length === 0)
            return;
        this._queue = [...kept, ...moved];
        this._persist();
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
        this._paused = false;
        this._started = false;
        this._watchdogTimer = null;
        this._currentFinish = null;
        this._consecutiveFailures = 0;
        this._warnedRetryIds = new Set();
        this._queue = queue;
        this._requestFn = requestFn;
        this._maxBatchSize = maxBatchSize;
        this._flushInterval = flushInterval;
    }
    start() {
        if (this._destroyed)
            return;
        this._started = true;
        this._startFlushTimer();
    }
    pause() {
        if (this._destroyed)
            return;
        this._paused = true;
        this._clearFlushTimer();
        this._clearWatchdog();
        this._currentFinish = null;
    }
    resume() {
        if (this._destroyed)
            return;
        if (!this._paused)
            return;
        this._paused = false;
        this._isFlushing = false;
        if (this._started) {
            this._startFlushTimer();
        }
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
        if (this._isFlushing || this._destroyed || this._paused) {
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
                const statusCode = response.statusCode;
                if (statusCode === 200) {
                    this._queue.dequeue(allIds);
                }
                else if (statusCode >= 400 &&
                    statusCode < 500 &&
                    statusCode !== 408 &&
                    statusCode !== 429) {
                    logger.warn('Batch send rejected (4xx), drop events:', statusCode, response.text);
                    this._queue.dequeue(allIds);
                }
                else {
                    logger.warn('Batch send failed:', statusCode, response.text);
                }
            }
            catch (e) {
                logger.error('Error in flush callback:', e);
            }
            finally {
                this._settleFlushGuarded(response.statusCode, allIds);
            }
        };
        this._currentFinish = finish;
        try {
            this._requestFn({
                url,
                method: 'POST',
                data: allEvents,
                headers,
                callback: finish,
            });
        }
        catch (e) {
            finish({ statusCode: 0, text: String(e) });
            return;
        }
        this._startWatchdog();
    }
    _settleFlushGuarded(statusCode, ids) {
        if (!this._isFlushing || this._destroyed || this._paused)
            return;
        this._isFlushing = false;
        this._currentFinish = null;
        this._clearWatchdog();
        this._onFlushSettled(statusCode, ids);
    }
    _onFlushSettled(statusCode, ids) {
        const dropped = statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429;
        if (statusCode === 200 || dropped) {
            this._consecutiveFailures = 0;
            this._warnedRetryIds.clear();
        }
        else {
            this._consecutiveFailures++;
            this._queue.incrementRetryCounts(ids);
            this._queue.moveToTail(ids);
            this._warnExcessiveRetries(ids);
        }
        if (statusCode === 200 && this._queue.size > 0) {
            this.triggerFlush();
        }
        else {
            this._startFlushTimer(this._nextFlushDelay());
        }
    }
    _nextFlushDelay() {
        if (this._consecutiveFailures === 0)
            return this._flushInterval;
        return Math.min(CONSTANTS.BASE_RETRY_DELAY * 2 ** (this._consecutiveFailures - 1), CONSTANTS.MAX_RETRY_DELAY);
    }
    _warnExcessiveRetries(ids) {
        const idSet = new Set(ids);
        for (const item of this._queue.peek(this._queue.size)) {
            if (!idSet.has(item.id))
                continue;
            if (item.retryCount > CONSTANTS.MAX_RETRY_COUNT && !this._warnedRetryIds.has(item.id)) {
                this._warnedRetryIds.add(item.id);
                logger.warn(`Event retried ${item.retryCount} times (max ${CONSTANTS.MAX_RETRY_COUNT}), ` +
                    `kept in queue for later retry: ${item.id}`);
            }
        }
    }
    _getSendableItems() {
        const all = this._queue.peek(this._queue.size);
        return all.filter((item) => !item.dead).slice(0, this._maxBatchSize);
    }
    _startFlushTimer(delay) {
        if (this._destroyed)
            return;
        if (this._paused)
            return;
        this._clearFlushTimer();
        this._flushTimer = setInterval(() => {
            if (this._queue.size > 0) {
                this.triggerFlush();
            }
        }, delay ?? this._flushInterval);
    }
    _clearFlushTimer() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
    }
    _startWatchdog() {
        if (this._destroyed || !this._isFlushing)
            return;
        this._clearWatchdog();
        this._watchdogTimer = setTimeout(() => {
            this._watchdogTimer = null;
            if (this._destroyed || this._paused || !this._isFlushing)
                return;
            const finish = this._currentFinish;
            this._currentFinish = null;
            logger.warn('[BatchSender] Request watchdog fired, synthesize failure');
            finish?.({ statusCode: 0, text: 'Watchdog: request did not call back' });
        }, CONSTANTS.REQUEST_WATCHDOG_DELAY_MS);
    }
    _clearWatchdog() {
        if (this._watchdogTimer) {
            clearTimeout(this._watchdogTimer);
            this._watchdogTimer = null;
        }
    }
    destroy() {
        this._destroyed = true;
        this._clearFlushTimer();
        this._clearWatchdog();
        this._currentFinish = null;
        this._isFlushing = false;
        this._paused = false;
        this._started = false;
        this._consecutiveFailures = 0;
        this._warnedRetryIds.clear();
    }
}

class Send {
    constructor(store, presetProps, session) {
        this._utmProvider = null;
        this._store = store;
        this._presetProps = presetProps;
        this._session = session;
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
        mergedProps.$session_id = this._session.getSessionId({ recordActivity: true });
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

const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
class SessionManager {
    constructor(storage) {
        this._lastPersistedActivityTs = 0;
        this._storage = storage;
    }
    getSessionId(options) {
        const recordActivity = !!options?.recordActivity;
        const now = Date.now();
        let state = this._read();
        if (!state ||
            now < state.last_ts ||
            now < state.start_ts ||
            now - state.last_ts > CONSTANTS.SESSION_IDLE_TIMEOUT_MS ||
            now - state.start_ts > CONSTANTS.SESSION_MAX_DURATION_MS) {
            state = { id: generateUUIDv7(), start_ts: now, last_ts: now };
            this._lastPersistedActivityTs = now;
            this._write(state);
            return state.id;
        }
        if (recordActivity) {
            state.last_ts = now;
            if (now - this._lastPersistedActivityTs >= CONSTANTS.SESSION_ACTIVITY_FLUSH_MS) {
                this._lastPersistedActivityTs = now;
                this._write(state);
            }
        }
        return state.id;
    }
    reset() {
        this._storage.removeItem(CONSTANTS.SESSION_STORAGE_KEY);
        this._lastPersistedActivityTs = 0;
    }
    _read() {
        const raw = this._storage.getItem(CONSTANTS.SESSION_STORAGE_KEY);
        if (!raw)
            return null;
        try {
            const parsed = JSON.parse(raw);
            if (!parsed ||
                typeof parsed.id !== 'string' ||
                !UUID_SHAPE_RE.test(parsed.id) ||
                typeof parsed.start_ts !== 'number' ||
                typeof parsed.last_ts !== 'number' ||
                parsed.last_ts < parsed.start_ts) {
                return null;
            }
            return parsed;
        }
        catch {
            return null;
        }
    }
    _write(state) {
        this._storage.setItem(CONSTANTS.SESSION_STORAGE_KEY, JSON.stringify(state));
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
        this._networkEventHandler = null;
        this._networkEventBindings = [];
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
            this._networkEventHandler = handler;
            const tryOn = (target, name) => {
                try {
                    if (target && typeof target.on === 'function') {
                        target.on(name, handler);
                        this._networkEventBindings.push({ target, name });
                    }
                }
                catch {
                }
            };
            if (cc?.event?.on) {
                tryOn(cc.event, 'network-type-change');
                if (cc.EventType && cc.EventType.NETWORK_TYPE_CHANGED) {
                    tryOn(cc.event, cc.EventType.NETWORK_TYPE_CHANGED);
                }
            }
            tryOn(cc?.sys, 'network-type-change');
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
        const handler = this._networkEventHandler;
        if (handler) {
            for (const { target, name } of this._networkEventBindings) {
                try {
                    if (target && typeof target.off === 'function') {
                        target.off(name, handler);
                    }
                }
                catch {
                }
            }
        }
        this._networkEventBindings = [];
        this._networkEventHandler = null;
        this._networkEventsSubscribed = false;
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
        result.deviceId = injectedAppInfo.deviceId || result.deviceId || '';
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
        result.language = injectedAppInfo.language || result.language || '';
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
        if (injectedAppInfo.installTime != null) {
            result.installTime = injectedAppInfo.installTime;
        }
        return result;
    }
    _readInjectedAppInfo() {
        const empty = {
            deviceId: '',
            appId: '',
            appName: '',
            appVersion: '',
            region: '',
            language: '',
            model: '',
            brand: '',
            manufacturer: '',
            installTime: null,
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
                    const rawInstall = v.installTime;
                    const rawFirst = v.firstInstallTime;
                    const installTime = typeof rawInstall === 'number' && Number.isFinite(rawInstall)
                        ? rawInstall
                        : typeof rawFirst === 'number' && Number.isFinite(rawFirst)
                            ? rawFirst
                            : null;
                    return {
                        deviceId: v.deviceId || v.device_id || '',
                        appId: v.appId || v.bundleId || v.packageName || '',
                        appName: v.appName || v.name || '',
                        appVersion: v.appVersion || v.version || '',
                        region: v.region || v.country || v.countryCode || '',
                        language: v.language || v.appLanguage || '',
                        model: v.model || v.deviceModel || '',
                        brand: v.brand || v.deviceBrand || '',
                        manufacturer: v.manufacturer || v.deviceManufacturer || v.vendor || '',
                        installTime,
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
            language: info.language || sys.language,
            installTime: info.installTime ?? sys.installTime,
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
        setIf('language', 'language');
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
function createPlatformAdapter(platformType, ccSys, getSceneName, getDeviceInfo, isOptedOut) {
    switch (platformType) {
        case 'app':
            return new AppPlatformAdapter(ccSys, getSceneName, getDeviceInfo, isOptedOut);
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
const WINDOWS_NT_VERSION_MAP = {
    '5.0': '2000',
    '5.1': 'XP',
    '5.2': 'XP',
    '6.0': 'Vista',
    '6.1': '7',
    '6.2': '8',
    '6.3': '8.1',
    '10.0': '10',
};
function detectOsInfoFromUa(ua) {
    if (typeof ua !== 'string' || ua.length === 0)
        return { os: '', version: '' };
    const iosMatch = /(?:iPhone|iPad|iPod).*?OS (\d+(?:_\d+)*)/.exec(ua);
    if (iosMatch)
        return { os: 'iOS', version: iosMatch[1].replace(/_/g, '.') };
    const androidMatch = /Android (\d+(?:\.\d+)*)/i.exec(ua);
    if (androidMatch)
        return { os: 'Android', version: androidMatch[1] };
    const macMatch = /Mac OS X (\d+(?:[_.]\d+)*)/i.exec(ua);
    if (macMatch)
        return { os: 'Mac OS X', version: macMatch[1].replace(/_/g, '.') };
    if (/Windows/i.test(ua)) {
        if (/arm/i.test(ua))
            return { os: 'Windows', version: 'RT' };
        const ntMatch = /Windows NT ([\d.]+)/i.exec(ua);
        const version = ntMatch ? WINDOWS_NT_VERSION_MAP[ntMatch[1]] || ntMatch[1] : '';
        return { os: 'Windows', version };
    }
    if (/CrOS/i.test(ua))
        return { os: 'Chrome OS', version: '' };
    if (/Linux|debian/i.test(ua))
        return { os: 'Linux', version: '' };
    return { os: '', version: '' };
}
function normalizeNetworkType(networkType) {
    if (!networkType)
        return '';
    const lower = String(networkType).toLowerCase();
    if (lower === '0' || lower === '3')
        return '';
    if (lower === '1')
        return 'wifi';
    if (lower === '2')
        return 'cellular';
    if (lower === 'lan' || lower === 'wifi')
        return 'wifi';
    if (lower === 'wwan' || lower === 'cellular')
        return 'cellular';
    if (lower === 'ethernet')
        return 'ethernet';
    if (lower === 'none' || lower === 'unknown')
        return '';
    if (lower === 'slow-2g')
        return '2g';
    return lower;
}
function isWifiNetworkType(networkType) {
    return normalizeNetworkType(networkType) === 'wifi';
}
function normalizeBcp47Language(lang) {
    if (!lang)
        return '';
    const parts = String(lang)
        .replace(/_/g, '-')
        .split('-')
        .filter((p) => !!p);
    if (parts.length === 0)
        return '';
    return parts
        .map((part, i) => {
        if (i === 0)
            return part.toLowerCase();
        if (part.length === 4) {
            return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        }
        return part.toUpperCase();
    })
        .join('-');
}
function normalizeRegionCode(region) {
    if (!region)
        return '';
    const upper = String(region).trim().toUpperCase();
    return /^[A-Z]{2}$/.test(upper) ? upper : '';
}
class AppPlatformAdapter {
    constructor(sys, getSceneName, getDeviceInfo, isOptedOut) {
        this._currentSceneName = '';
        this._previousSceneName = '';
        this._devicePrefetchStarted = false;
        this._sys = sys;
        this._getSceneName = getSceneName;
        this._isOptedOut = isOptedOut;
        this._nativeBridge = new NativeBridge(sys);
        if (getDeviceInfo) {
            this._nativeBridge.setUserFn(getDeviceInfo);
        }
        if (!this._isOptedOut?.()) {
            this._startDevicePrefetch();
        }
    }
    onOptIn() {
        this._startDevicePrefetch();
    }
    dispose() {
        this._nativeBridge.dispose();
    }
    _startDevicePrefetch() {
        if (this._devicePrefetchStarted)
            return;
        this._devicePrefetchStarted = true;
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
            $language: normalizeBcp47Language(this._sys.language || ''),
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
            $language: normalizeBcp47Language(deviceInfo.language || this._sys.language || ''),
        };
        const region = normalizeRegionCode(deviceInfo.region || this._sys.region || '');
        if (region) {
            props.$region = region;
        }
        if (networkType) {
            const normalized = normalizeNetworkType(networkType);
            if (normalized) {
                props.$network_type = normalized;
            }
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
    getInstallTime() {
        const t = this._nativeBridge.getDeviceInfoSync().installTime;
        return typeof t === 'number' && t > 0 ? t : null;
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
class MPPlatformAdapter {
    constructor(sys, getSceneName) {
        this._systemInfo = null;
        this._accountInfo = null;
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
        try {
            const sdk = getMPSDK();
            if (sdk && typeof sdk.getAccountInfoSync === 'function') {
                this._accountInfo = sdk.getAccountInfoSync();
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
                    this._asyncNetworkType = normalizeNetworkType(res?.networkType || '');
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
                this._asyncNetworkType = normalizeNetworkType(res?.networkType || '');
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
            props.$language = normalizeBcp47Language(info.language || this._sys.language || '');
            props.$brand = info.brand || this._sys.brand || '';
            props.$manufacturer = info.manufacturer || info.brand || this._sys.manufacturer || '';
        }
        else {
            props.$os = formatOs(this._sys.os || '');
            props.$os_version = formatOsVersion(this._sys.osVersion || '');
            props.$model = this._sys.model || '';
            props.$screen_width = this._sys.screenWidth || 0;
            props.$screen_height = this._sys.screenHeight || 0;
            props.$language = normalizeBcp47Language(this._sys.language || '');
            props.$brand = this._sys.brand || '';
            props.$manufacturer = this._sys.manufacturer || '';
        }
        props.$timezone_offset = -new Date().getTimezoneOffset() * 60;
        const networkType = this._resolveNetworkType();
        if (networkType) {
            props.$network_type = networkType;
        }
        const mpInfo = this._accountInfo?.miniProgram;
        props.$app_id = mpInfo?.appId || '';
        props.$app_version = mpInfo?.version || '';
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
        const networkType = this._resolveNetworkType();
        const props = {};
        if (networkType) {
            props.$network_type = networkType;
        }
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
    Edge: [/Edge?\/(\d+(?:\.\d+)*)/],
    Chrome: [/(Chrome|CrMo)\/(\d+(?:\.\d+)*)/],
    'Chrome iOS': [/CriOS\/(\d+(?:\.\d+)*)/],
    Firefox: [/Firefox\/(\d+(?:\.\d+)*)/],
    'Firefox iOS': [/FxiOS\/(\d+(?:\.\d+)*)/],
    Safari: [/Version\/(\d+(?:\.\d+)*)/],
    'Mobile Safari': [/Version\/(\d+(?:\.\d+)*)/],
    Opera: [/(Opera|OPR)\/(\d+(?:\.\d+)*)/],
    'Opera Mini': [/OPR\/(\d+(?:\.\d+)*)/],
    'UC Browser': [/(UCBrowser|UCWEB)\/(\d+(?:\.\d+)*)/],
    'Samsung Internet': [/SamsungBrowser\/(\d+(?:\.\d+)*)/],
    'Android Mobile': [/android\s(\d+(?:\.\d+)*)/i],
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
            $language: normalizeBcp47Language(this._sys.language || ''),
            $timezone_offset: -new Date().getTimezoneOffset() * 60,
        };
        try {
            const g = globalThis;
            if (g.navigator) {
                if (g.navigator.userAgent) {
                    const ua = g.navigator.userAgent;
                    props.$browser = this._detectBrowser(ua);
                    props.$browser_version = this._detectBrowserVersion(ua);
                    if (!props.$os || !props.$os_version) {
                        const uaOs = detectOsInfoFromUa(ua);
                        if (!props.$os && uaOs.os)
                            props.$os = formatOs(uaOs.os);
                        if (!props.$os_version && uaOs.version)
                            props.$os_version = formatOsVersion(uaOs.version);
                    }
                    const detectedDevice = this._detectDevice(ua);
                    if (detectedDevice) {
                        props.$model = detectedDevice;
                    }
                }
                if (g.navigator.language) {
                    props.$language = normalizeBcp47Language(g.navigator.language);
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
            return '';
        for (const regex of regexes) {
            const matches = ua.match(regex);
            if (matches && matches[matches.length - 1]) {
                return matches[matches.length - 1];
            }
        }
        return '';
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

const GAME_EVENT_SHOW = 'game_on_show';
const GAME_EVENT_HIDE = 'game_on_hide';
function resolveGameEventName(game, name, fallback) {
    try {
        if (typeof game?.[name] === 'string')
            return game[name];
        const ctor = game?.constructor;
        if (typeof ctor?.[name] === 'string')
            return ctor[name];
    }
    catch {
    }
    return fallback;
}
class GameLifecyclePlugin {
    constructor(opts) {
        this.NAME = 'GameLifecycle';
        this._startTimestamp = 0;
        this._pageShowTimestamp = 0;
        this._onShowHandler = null;
        this._onHideHandler = null;
        this._onShareHandler = null;
        this._showEventName = GAME_EVENT_SHOW;
        this._hideEventName = GAME_EVENT_HIDE;
        this._destroyed = false;
        this._initTimer = null;
        this._appEndTimer = null;
        this._h5BeforeUnloadHandler = null;
        this._h5LoadHandler = null;
        this._store = opts.store;
        this._send = opts.send;
        this._autoCapture = opts.autoCapture;
        this._ccGame = opts.ccGame;
        this._platformAdapter = opts.platformAdapter;
        this._enableShareTrack = !!opts.enableShareTrack;
        this._enqueueEvent = opts.enqueueEvent;
        this._flushImmediate = opts.flushImmediate;
        this._isOptedOut = opts.isOptedOut ?? (() => false);
    }
    init() {
        if (this._enableShareTrack) {
            this._initShareTracking();
        }
        this._replayPendingAppEndAtLaunch();
        if (!this._autoCapture)
            return;
        const platformType = this._platformAdapter.getPlatformType();
        this._onShowHandler = () => this._handleShow();
        this._onHideHandler = () => this._handleHide();
        try {
            if (this._ccGame && typeof this._ccGame.on === 'function') {
                this._showEventName = resolveGameEventName(this._ccGame, 'EVENT_SHOW', GAME_EVENT_SHOW);
                this._hideEventName = resolveGameEventName(this._ccGame, 'EVENT_HIDE', GAME_EVENT_HIDE);
                this._ccGame.on(this._showEventName, this._onShowHandler);
                this._ccGame.on(this._hideEventName, this._onHideHandler);
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
            }
            else {
                this._initH5Lifecycle();
            }
        }, 0);
    }
    _initAppLifecycle() {
        if (!this._store.isLaunched()) {
            this._trackAppInstall();
            if (!this._isOptedOut()) {
                this._store.setLaunched();
            }
        }
        this._handleShow();
    }
    _initMinigameLifecycle() {
        this._trackMPLaunch();
        if (!this._store.isLaunched() && !this._isOptedOut()) {
            this._store.setLaunched();
        }
        this._handleMPShow();
    }
    _initH5Lifecycle() {
        this._scheduleH5PageEvents();
        this._pageShowTimestamp = Date.now();
        try {
            const g = globalThis;
            if (g.window && typeof g.window.addEventListener === 'function') {
                this._h5BeforeUnloadHandler = () => this._handleH5PageLeave();
                g.window.addEventListener('beforeunload', this._h5BeforeUnloadHandler);
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
                this._h5LoadHandler = fire;
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
        if (this._isOptedOut())
            return;
        const nativeInstallTime = this._platformAdapter.getInstallTime?.() ?? null;
        const persistedInstallTime = this._store.getInstallTime();
        const installTime = nativeInstallTime ?? persistedInstallTime ?? Date.now();
        if (persistedInstallTime == null) {
            this._store.setInstallTime(installTime);
        }
        const event = this._send.sendEvent('$AppInstall', {
            $install_time: new Date(installTime).toISOString(),
        });
        this._enqueueEvent(event);
    }
    _handleAppShow() {
        const pending = this._store.getPendingAppEnd();
        if (pending) {
            this._clearAppEndTimer();
            this._store.clearPendingAppEnd();
        }
        if (this._isOptedOut())
            return;
        if (pending && Date.now() - pending.hideTs < CONSTANTS.APP_END_DEBOUNCE_MS) {
            const foregroundMs = pending.startTs > 0 ? Math.max(0, pending.hideTs - pending.startTs) : 0;
            this._startTimestamp = Date.now() - foregroundMs;
            return;
        }
        if (pending) {
            this._enqueueEvent(pending.event);
            this._flushImmediate();
        }
        this._startTimestamp = Date.now();
        const event = this._send.sendEvent('$AppStart');
        this._enqueueEvent(event);
    }
    _handleAppHide() {
        if (this._isOptedOut())
            return;
        if (this._store.getPendingAppEnd()) {
            this._flushPendingAppEnd();
        }
        const hideTs = Date.now();
        const duration = this._startTimestamp > 0 ? Number(((hideTs - this._startTimestamp) / 1000).toFixed(3)) : 0;
        const event = this._send.sendEvent('$AppEnd', {
            $event_duration: duration,
        });
        if (!this._store.savePendingAppEnd(event, hideTs, this._startTimestamp)) {
            this._enqueueEvent(event);
            this._flushImmediate();
            return;
        }
        this._clearAppEndTimer();
        this._appEndTimer = setTimeout(() => {
            this._appEndTimer = null;
            if (this._destroyed)
                return;
            this._flushPendingAppEnd();
        }, CONSTANTS.APP_END_DEBOUNCE_MS);
        this._flushImmediate();
    }
    _replayPendingAppEndAtLaunch() {
        if (this._platformAdapter.getPlatformType() !== 'app')
            return;
        this._flushPendingAppEnd();
    }
    _flushPendingAppEnd() {
        const pending = this._store.getPendingAppEnd();
        if (!pending)
            return;
        if (this._isOptedOut()) {
            this._store.clearPendingAppEnd();
            return;
        }
        this._enqueueEvent(pending.event);
        this._store.clearPendingAppEnd();
        this._flushImmediate();
    }
    _clearAppEndTimer() {
        if (this._appEndTimer) {
            clearTimeout(this._appEndTimer);
            this._appEndTimer = null;
        }
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
        if (this._isOptedOut())
            return;
        const event = this._send.sendEvent('$MPLaunch', this._extractLaunchProps());
        this._enqueueEvent(event);
    }
    _handleMPShow() {
        if (this._isOptedOut())
            return;
        this._startTimestamp = Date.now();
        const event = this._send.sendEvent('$MPShow', this._extractLaunchProps());
        this._enqueueEvent(event);
    }
    _handleMPHide() {
        if (this._isOptedOut())
            return;
        const duration = this._startTimestamp > 0
            ? Number(((Date.now() - this._startTimestamp) / 1000).toFixed(3))
            : 0;
        const event = this._send.sendEvent('$MPHide', {
            $event_duration: duration,
        });
        this._enqueueEvent(event);
        this._flushImmediate();
    }
    _trackH5PageView() {
        if (this._isOptedOut())
            return;
        const event = this._send.sendEvent('$PageView');
        this._enqueueEvent(event);
    }
    _trackH5PageLoad() {
        if (this._isOptedOut())
            return;
        const g = globalThis;
        const loadStart = g.performance?.timing?.navigationStart;
        const loadEnd = g.performance?.timing?.loadEventEnd || g.performance?.timing?.loadEventStart;
        const props = {};
        if (loadStart && loadEnd) {
            props.$event_duration = Number(((loadEnd - loadStart) / 1000).toFixed(3));
        }
        try {
            const entries = g.performance?.getEntries?.() || [];
            let totalSize = 0;
            for (const entry of entries) {
                if (entry && typeof entry.transferSize === 'number') {
                    totalSize += entry.transferSize;
                }
            }
            if (totalSize > 0 && totalSize < 10737418240) {
                props.$page_resource_size = Number((totalSize / 1024).toFixed(3));
            }
        }
        catch {
        }
        const event = this._send.sendEvent('$PageLoad', props);
        this._enqueueEvent(event);
    }
    _handleH5PageLeave() {
        if (this._isOptedOut())
            return;
        const duration = this._pageShowTimestamp > 0
            ? Number((Math.min(Date.now() - this._pageShowTimestamp, 432000000) / 1000).toFixed(3))
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
                if (this._isOptedOut())
                    return;
                const from = res && typeof res.from === 'string' ? res.from : 'unknown';
                const event = this._send.sendEvent('$MPShare', {
                    $share_method: from,
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
        this._clearAppEndTimer();
        if (this._ccGame && typeof this._ccGame.off === 'function') {
            if (this._onShowHandler)
                this._ccGame.off(this._showEventName, this._onShowHandler);
            if (this._onHideHandler)
                this._ccGame.off(this._hideEventName, this._onHideHandler);
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
        try {
            const g = globalThis;
            if (g.window && typeof g.window.removeEventListener === 'function') {
                if (this._h5BeforeUnloadHandler) {
                    g.window.removeEventListener('beforeunload', this._h5BeforeUnloadHandler);
                }
                if (this._h5LoadHandler) {
                    g.window.removeEventListener('load', this._h5LoadHandler);
                }
            }
        }
        catch {
        }
        this._onShowHandler = null;
        this._onHideHandler = null;
        this._onShareHandler = null;
        this._h5BeforeUnloadHandler = null;
        this._h5LoadHandler = null;
    }
}
GameLifecyclePlugin.NAME = 'GameLifecycle';

class UTMPlugin {
    constructor(opts) {
        this.NAME = 'UTM';
        this._currentUtm = {};
        this._destroyed = false;
        this._userSetTimer = null;
        this._initialUtmSent = false;
        this._store = opts.store;
        this._send = opts.send;
        this._platformAdapter = opts.platformAdapter;
        this._enqueueEvent = opts.enqueueEvent;
        this._isOptedOut = opts.isOptedOut ?? (() => false);
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
        if (this._isOptedOut()) {
            return;
        }
        this._scheduleInitialUtmUserSet();
    }
    _scheduleInitialUtmUserSet() {
        this._initialUtmSent = true;
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
        if (this._userSetTimer) {
            clearTimeout(this._userSetTimer);
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
    onOptIn() {
        if (this._initialUtmSent)
            return;
        this._scheduleInitialUtmUserSet();
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

const ERROR_STRING_PATTERN = /^(?:Uncaught (?:exception: )?)?((?:Eval|Internal|Range|Reference|Syntax|Type|URI)Error): ([\s\S]*)$/;
const OBJECT_MESSAGE_MAX_LEN = 512;
function truncate(str, max) {
    return str.length > max ? str.slice(0, max) : str;
}
function parseErrorString(input) {
    const firstLine = input.split(/\r?\n/, 1)[0];
    const match = firstLine.match(ERROR_STRING_PATTERN);
    if (match) {
        return { type: match[1], message: match[2].trim(), stack: '' };
    }
    return { type: 'Error', message: input.trim(), stack: '' };
}
function isErrorLike(input) {
    return (typeof input === 'object' &&
        input !== null &&
        (typeof input.message === 'string' || typeof input.stack === 'string'));
}
function safeStringify(value) {
    try {
        return JSON.stringify(value) ?? String(value);
    }
    catch {
        return String(value);
    }
}
function normalizeException(input) {
    try {
        if (input == null) {
            return { type: 'Error', message: '', stack: '' };
        }
        if (typeof input === 'string') {
            return parseErrorString(input);
        }
        if (isErrorLike(input)) {
            const obj = input;
            const ctorName = obj.constructor?.name;
            const type = (typeof obj.name === 'string' && obj.name) ||
                (typeof ctorName === 'string' && ctorName !== 'Object' ? ctorName : '') ||
                'Error';
            const message = typeof obj.message === 'string' ? obj.message.trim() : '';
            const stack = typeof obj.stack === 'string' ? obj.stack : '';
            return { type, message, stack };
        }
        if (typeof input === 'number' || typeof input === 'boolean' || typeof input === 'bigint') {
            return { type: 'Error', message: String(input), stack: '' };
        }
        return {
            type: 'Error',
            message: truncate(safeStringify(input), OBJECT_MESSAGE_MAX_LEN),
            stack: '',
        };
    }
    catch {
        return { type: 'Error', message: '', stack: '' };
    }
}
function normalizeOnErrorArgs(message, source, lineno, colno, error) {
    try {
        if (error != null) {
            const fromError = normalizeException(error);
            if (fromError.type !== 'Error' || fromError.message || fromError.stack) {
                return fromError;
            }
        }
        let msg = message;
        if (msg != null && typeof msg !== 'string') {
            msg = typeof msg.message === 'string' ? msg.message : safeStringify(msg);
        }
        const normalized = typeof msg === 'string' && msg.length > 0
            ? parseErrorString(msg)
            : { type: 'Error', message: '', stack: '' };
        if (!normalized.stack && typeof source === 'string' && source.length > 0) {
            normalized.stack = `at ${source}:${lineno ?? 0}:${colno ?? 0}`;
        }
        return normalized;
    }
    catch {
        return { type: 'Error', message: '', stack: '' };
    }
}
function normalizeRejectionReason(reason) {
    try {
        if (reason == null) {
            return { type: 'UnhandledRejection', message: 'unknown reason', stack: '' };
        }
        if (typeof reason === 'string') {
            return parseErrorString(reason);
        }
        if (isErrorLike(reason)) {
            return normalizeException(reason);
        }
        if (typeof reason === 'number' || typeof reason === 'boolean' || typeof reason === 'bigint') {
            return { type: 'UnhandledRejection', message: String(reason), stack: '' };
        }
        return {
            type: 'UnhandledRejection',
            message: truncate(safeStringify(reason), OBJECT_MESSAGE_MAX_LEN),
            stack: '',
        };
    }
    catch {
        return { type: 'UnhandledRejection', message: 'unknown reason', stack: '' };
    }
}
function normalizeCocosErrorHandler(...args) {
    try {
        const strings = args.filter((a) => typeof a === 'string' && a.length > 0);
        if (strings.length === 0) {
            return { type: 'Error', message: '', stack: '' };
        }
        const first = args[0];
        if (args.length >= 3 && typeof args[1] === 'number') {
            const file = first;
            const line = args[1];
            const message = args[2];
            const normalized = typeof message === 'string' && message.length > 0
                ? parseErrorString(message)
                : { type: 'Error', message: '', stack: '' };
            if (!normalized.stack && typeof file === 'string' && file.length > 0) {
                normalized.stack = `at ${file}:${line}`;
            }
            return normalized;
        }
        if (args.length >= 3 && typeof args[2] === 'number') {
            const normalized = typeof first === 'string' && first.length > 0
                ? parseErrorString(first)
                : { type: 'Error', message: '', stack: '' };
            const file = args[1];
            const line = args[2];
            if (!normalized.stack && typeof file === 'string' && file.length > 0) {
                normalized.stack = `at ${file}:${line}`;
            }
            return normalized;
        }
        if (args.length >= 3) {
            const location = first;
            const message = args[1];
            const stack = args[2];
            const msgStr = typeof message === 'string' && message.length > 0 ? message.trim() : '';
            const stackStr = typeof stack === 'string' ? stack : '';
            let type = 'Error';
            let messageText = msgStr;
            const msgMatch = msgStr.split(/\r?\n/, 1)[0].match(ERROR_STRING_PATTERN);
            if (msgMatch) {
                type = msgMatch[1];
                messageText = msgMatch[2].trim();
            }
            else {
                const stackMatch = stackStr.split(/\r?\n/, 1)[0].match(ERROR_STRING_PATTERN);
                if (stackMatch) {
                    type = stackMatch[1];
                    if (messageText.length === 0)
                        messageText = stackMatch[2].trim();
                }
            }
            const stackText = stackStr.length > 0
                ? stackStr
                : typeof location === 'string' && location.length > 0
                    ? `at ${location}`
                    : '';
            return { type, message: messageText, stack: stackText };
        }
        return parseErrorString(strings[0]);
    }
    catch {
        return { type: 'Error', message: '', stack: '' };
    }
}
function normalizeNativeCrash(record) {
    try {
        if (typeof record !== 'object' || record === null)
            return null;
        const r = record;
        if (typeof r.timestamp !== 'number' || !Number.isFinite(r.timestamp))
            return null;
        return {
            type: (typeof r.type === 'string' && r.type) || 'Unknown',
            message: typeof r.message === 'string' ? r.message : '',
            stack: typeof r.stack === 'string' ? r.stack : '',
            timestamp: r.timestamp,
            ...(Array.isArray(r.images) && r.images.length > 0 ? { images: r.images } : {}),
        };
    }
    catch {
        return null;
    }
}

const V8_PAREN_FRAME = /^\s*at\s+(?:async\s+)?(.+?)\s+\((.+?):(\d+)(?::(\d+))?\)\s*$/;
const V8_BARE_FRAME = /^\s*at\s+(?:async\s+)?([^\s()]+?):(\d+)(?::(\d+))?\s*$/;
const GECKO_FRAME = /^(?:(.*)@)?(.+?):(\d+):(\d+)$/;
const JAVA_FRAME = /^\s*at\s+([^\s(]+)\((.*)\)\s*$/;
const JAVA_LOCATION = /^(.*):(\d+)$/;
const IOS_FRAME = /^\s*\d+\s+(\S+)\s+0x([0-9a-fA-F]+)\s*(.*)$/;
const IOS_OFFSET_SUFFIX = /\s+\+\s*\d+$/;
const IOS_FILE_SUFFIX = /\s+\((.+):(\d+)\)$/;
const NATIVE_FRAME = /^\s*#(\d+)\s+pc\s+(?:0x)?([0-9a-fA-F]+)\s+([^\s(]+)\s*(.*)$/;
const NATIVE_SYMBOL_SUFFIX = /\((.*)\)\s*$/;
const NATIVE_OFFSET_SUFFIX = /\+(?:0x)?[0-9a-fA-F]+$/;
function getCurrentOrigin() {
    try {
        const w = globalThis.window;
        const origin = w && w.location && w.location.origin;
        return typeof origin === 'string' ? origin : '';
    }
    catch {
        return '';
    }
}
function capPath(str, max) {
    return str.length > max ? str.slice(0, max) : str;
}
function normalizeHexAddr(raw) {
    const hex = raw.toLowerCase().replace(/^0x/, '');
    return `0x${hex.padStart(16, '0')}`;
}
function cleanFrameFile(file, origin) {
    let cleaned = file;
    const pageOrigin = origin !== undefined ? origin : getCurrentOrigin();
    if (pageOrigin && cleaned.indexOf(pageOrigin) === 0) {
        cleaned = cleaned.substring(pageOrigin.length);
    }
    const qIdx = cleaned.indexOf('?');
    if (qIdx > -1) {
        cleaned = cleaned.substring(0, qIdx);
    }
    const hIdx = cleaned.indexOf('#');
    if (hIdx > -1) {
        cleaned = cleaned.substring(0, hIdx);
    }
    return cleaned;
}
function buildWebFrame(fn, rawFile, lineno, colno, pageOrigin) {
    const function_ = !fn || fn === '<anonymous>' ? '?' : fn;
    const frame = {
        platform: 'web:javascript',
        filename: capPath(cleanFrameFile(rawFile, pageOrigin), CONSTANTS.EXCEPTION_FRAME_PATH_MAX_LENGTH),
        function: function_,
        lineno: Number(lineno),
        abs_path: capPath(rawFile, CONSTANTS.EXCEPTION_FRAME_PATH_MAX_LENGTH),
    };
    if (colno !== undefined) {
        frame.colno = Number(colno);
    }
    return frame;
}
function parseJavaFrame(line) {
    const match = line.match(JAVA_FRAME);
    if (!match)
        return null;
    const qualified = match[1];
    const location = match[2] ?? '';
    const dotIdx = qualified.lastIndexOf('.');
    if (dotIdx <= 0 || dotIdx === qualified.length - 1)
        return null;
    const frame = {
        platform: 'java',
        module: qualified.substring(0, dotIdx),
        function: qualified.substring(dotIdx + 1),
    };
    const locMatch = location.match(JAVA_LOCATION);
    if (locMatch) {
        frame.filename = capPath(cleanFrameFile(locMatch[1]), CONSTANTS.EXCEPTION_FRAME_PATH_MAX_LENGTH);
        frame.lineno = Number(locMatch[2]);
    }
    return frame;
}
function parseIosFrame(line) {
    const match = line.match(IOS_FRAME);
    if (!match)
        return null;
    const image = match[1];
    let symbol = match[3] ?? '';
    const frame = {
        platform: 'cocoa',
        module: image,
        instruction_addr: normalizeHexAddr(match[2]),
    };
    const fileMatch = symbol.match(IOS_FILE_SUFFIX);
    if (fileMatch) {
        frame.filename = capPath(cleanFrameFile(fileMatch[1]), CONSTANTS.EXCEPTION_FRAME_PATH_MAX_LENGTH);
        frame.lineno = Number(fileMatch[2]);
        symbol = symbol.substring(0, fileMatch.index);
    }
    symbol = symbol.replace(IOS_OFFSET_SUFFIX, '').trim();
    frame.function = symbol.length === 0 || symbol.indexOf('0x') === 0 ? '?' : symbol;
    return frame;
}
function parseNativeFrame(line) {
    const match = line.match(NATIVE_FRAME);
    if (!match)
        return null;
    const rawPath = match[3];
    const slashIdx = rawPath.lastIndexOf('/');
    const module = slashIdx > -1 ? rawPath.substring(slashIdx + 1) : rawPath;
    const frame = {
        platform: 'native',
        module: capPath(module, CONSTANTS.EXCEPTION_FRAME_PATH_MAX_LENGTH),
        filename: capPath(cleanFrameFile(module), CONSTANTS.EXCEPTION_FRAME_PATH_MAX_LENGTH),
        instruction_addr: normalizeHexAddr(match[2]),
    };
    const symMatch = (match[4] ?? '').trim().match(NATIVE_SYMBOL_SUFFIX);
    const symbol = (symMatch && symMatch[1] ? symMatch[1] : '')
        .replace(NATIVE_OFFSET_SUFFIX, '')
        .trim();
    frame.function = symbol.length === 0 || symbol.indexOf('0x') === 0 ? '?' : symbol;
    return frame;
}
function parseLine(line, pageOrigin) {
    const v8Paren = line.match(V8_PAREN_FRAME);
    if (v8Paren) {
        return buildWebFrame(v8Paren[1], v8Paren[2], v8Paren[3], v8Paren[4], pageOrigin);
    }
    const v8Bare = line.match(V8_BARE_FRAME);
    if (v8Bare) {
        return buildWebFrame(undefined, v8Bare[1], v8Bare[2], v8Bare[3], pageOrigin);
    }
    const gecko = line.match(GECKO_FRAME);
    if (gecko) {
        return buildWebFrame(gecko[1], gecko[2], gecko[3], gecko[4], pageOrigin);
    }
    return parseJavaFrame(line) ?? parseIosFrame(line) ?? parseNativeFrame(line);
}
function parseExceptionFrames(stack, pageOrigin) {
    try {
        if (typeof stack !== 'string' || stack.length === 0)
            return [];
        const origin = pageOrigin !== undefined ? pageOrigin : getCurrentOrigin();
        const frames = [];
        const lines = stack.split(/\r?\n/);
        for (const line of lines) {
            if (!line || line.length > CONSTANTS.EXCEPTION_STACK_LINE_MAX_LENGTH)
                continue;
            const frame = parseLine(line, origin);
            if (frame) {
                frames.push(frame);
                if (frames.length >= CONSTANTS.EXCEPTION_FRAMES_MAX_COUNT)
                    break;
            }
        }
        frames.reverse();
        return frames;
    }
    catch {
        return [];
    }
}
function enrichIosFrames(frames, images) {
    try {
        if (!Array.isArray(images) || images.length === 0)
            return;
        const byName = new Map();
        for (const img of images) {
            if (typeof img !== 'object' || img === null)
                continue;
            const rec = img;
            if (typeof rec.name !== 'string' || rec.name.length === 0)
                continue;
            if (typeof rec.base !== 'string' || !/^0x[0-9a-fA-F]+$/.test(rec.base))
                continue;
            byName.set(rec.name, {
                base: normalizeHexAddr(rec.base),
                debug_id: typeof rec.debug_id === 'string' && rec.debug_id.length > 0 ? rec.debug_id : undefined,
            });
        }
        if (byName.size === 0)
            return;
        for (const frame of frames) {
            if (frame.platform !== 'cocoa' || !frame.module)
                continue;
            const img = byName.get(frame.module);
            if (!img)
                continue;
            frame.image_addr = img.base;
            if (img.debug_id) {
                frame.debug_id = img.debug_id;
            }
        }
    }
    catch {
    }
}
const COCOA_SYSTEM_PREFIXES = [
    'Foundation',
    'UIKit',
    'UIKitCore',
    'AppKit',
    'CoreFoundation',
    'CoreGraphics',
    'CoreData',
    'CoreLocation',
    'CoreMotion',
    'CoreServices',
    'CoreText',
    'AVFoundation',
    'Metal',
    'MetalKit',
    'SwiftUI',
    'SwiftUICore',
    'Combine',
    'QuartzCore',
    'Security',
    'SystemConfiguration',
    'CFNetwork',
    'WebKit',
    'GraphicsServices',
    'IOKit',
    'Gestures',
    'UIKitMacHelper',
    'Accessibility',
    'AccessibilityUtilities',
    'UpdateCycle',
    'TextInput',
    'UIFoundation',
    'BackBoardServices',
    'FrontBoardServices',
    'SpringBoardServices',
    'RunningBoardServices',
    'JavaScriptCore',
    'libsystem_kernel.dylib',
    'libsystem_pthread.dylib',
    'libsystem_c.dylib',
    'libsystem_malloc.dylib',
    'libsystem_platform.dylib',
    'libdispatch.dylib',
    'libswift',
    'libobjc',
    'libc++abi.dylib',
    'dyld',
];
const JAVA_SYSTEM_PREFIXES = [
    'java.',
    'javax.',
    'android.',
    'androidx.',
    'kotlin.',
    'kotlinx.',
    'dalvik.',
    'com.android.',
    'com.google.android.',
    'libcore.',
];
const NATIVE_SYSTEM_PREFIXES = [
    'ld-musl',
    'libc.so',
    'libc++.so',
    'libc++abi.so',
    'libunwind.so',
    'libbacktrace.so',
    'libbase.so',
    'libcutils.so',
    'libutils.so',
    'liblog.so',
    'libbinder.so',
    'libnativewindow.so',
    'libEGL.so',
    'libGLESv2.so',
    'libvulkan.so',
    'libclang_rt',
];
function matchesPrefixList(target, prefixes) {
    for (const p of prefixes) {
        if (target.indexOf(p) === 0)
            return true;
    }
    return false;
}
function sanitizePrefixList(list) {
    if (!Array.isArray(list))
        return [];
    const out = [];
    for (const item of list) {
        if (typeof item !== 'string')
            continue;
        const trimmed = item.trim();
        if (trimmed.length > 0)
            out.push(trimmed);
    }
    return out;
}
function resolveInApp(frame, includes, excludes) {
    if (frame.platform === 'cocoa' || frame.platform === 'native') {
        const module = frame.module;
        if (typeof module !== 'string' || module.length === 0 || module === 'unknown')
            return false;
    }
    const module = typeof frame.module === 'string' ? frame.module : '';
    const filename = typeof frame.filename === 'string' ? frame.filename : '';
    const target = module || filename;
    if (matchesPrefixList(target, excludes))
        return false;
    if (matchesPrefixList(target, includes))
        return true;
    if (frame.platform === 'cocoa' && matchesPrefixList(target, COCOA_SYSTEM_PREFIXES))
        return false;
    if (frame.platform === 'java' && matchesPrefixList(target, JAVA_SYSTEM_PREFIXES))
        return false;
    if (frame.platform === 'native' && matchesPrefixList(target, NATIVE_SYSTEM_PREFIXES)) {
        return false;
    }
    return true;
}
function markInAppFrames(frames, exceptionConfig) {
    try {
        if (!Array.isArray(frames) || frames.length === 0)
            return;
        const config = typeof exceptionConfig === 'object' && exceptionConfig !== null ? exceptionConfig : {};
        const includes = sanitizePrefixList(config.inAppIncludes);
        const excludes = sanitizePrefixList(config.inAppExcludes);
        for (const frame of frames) {
            if (typeof frame !== 'object' || frame === null)
                continue;
            try {
                frame.in_app = resolveInApp(frame, includes, excludes);
            }
            catch {
                frame.in_app = false;
            }
        }
    }
    catch {
    }
}

function readWatermark(storage) {
    if (!storage)
        return 0;
    try {
        const raw = storage.getItem(CONSTANTS.LAST_CRASH_TS_KEY);
        const ts = Number(raw);
        return raw != null && Number.isFinite(ts) ? ts : 0;
    }
    catch {
        return 0;
    }
}
function readPendingCrashes(storage) {
    try {
        const injected = globalThis[CONSTANTS.PENDING_CRASHES_GLOBAL_KEY];
        if (injected == null)
            return [];
        let list = injected;
        if (typeof injected === 'string') {
            if (injected.length === 0)
                return [];
            list = JSON.parse(injected);
        }
        if (!Array.isArray(list))
            return [];
        const watermark = readWatermark(storage);
        return list
            .map((item) => normalizeNativeCrash(item))
            .filter((r) => r != null && r.timestamp > watermark)
            .sort((a, b) => a.timestamp - b.timestamp);
    }
    catch {
        return [];
    }
}
function markCrashesReported(maxTimestamp, storage) {
    if (!storage || !Number.isFinite(maxTimestamp))
        return;
    try {
        if (maxTimestamp > readWatermark(storage)) {
            storage.setItem(CONSTANTS.LAST_CRASH_TS_KEY, String(maxTimestamp));
        }
    }
    catch {
    }
}

const APP_HOOK_FLAG = '__sensorswave_exception_hooked__';
class ExceptionPlugin {
    constructor(opts) {
        this.NAME = 'Exception';
        this._dedupMap = new Map();
        this._sessionCount = 0;
        this._sessionCapWarned = false;
        this._h5Window = null;
        this._h5PrevOnError = null;
        this._h5OnErrorWrapper = null;
        this._h5RejectionHandler = null;
        this._mpErrorHandler = null;
        this._mpRejectionHandler = null;
        this._appErrorHandler = null;
        this._appPrevErrorHandler = null;
        this._appHookInstalled = false;
        this._ohosHookActive = false;
        this._crashRecheckTimers = [];
        this._send = opts.send;
        this._platformAdapter = opts.platformAdapter;
        this._safeStorage = opts.safeStorage;
        this._enableCrashTrack = !!opts.enableCrashTrack;
        this._enableErrorTrack = !!opts.enableErrorTrack;
        this._exceptionConfig = opts.exceptionConfig ?? {};
        this._enqueueEvent = opts.enqueueEvent;
        this._flushImmediate = opts.flushImmediate;
        this._isOptedOut = opts.isOptedOut ?? (() => false);
    }
    init() {
        const platformType = this._platformAdapter.getPlatformType();
        if (this._enableCrashTrack && platformType !== 'app') {
            logger.info(`[Exception] enableCrashTrack only takes effect on app platform, ignored on ${platformType}`);
        }
        if (platformType === 'app' && this._enableCrashTrack) {
            this._reportPendingNativeCrashes();
            this._scheduleCrashRechecks();
        }
        if (!this._enableErrorTrack)
            return;
        try {
            if (platformType === 'h5') {
                this._installH5Hooks();
            }
            else if (platformType === 'minigame') {
                this._installMinigameHooks();
            }
            else if (platformType === 'app') {
                this._installAppHook();
            }
        }
        catch (e) {
            logger.warn('[Exception] Failed to install error hooks:', e);
        }
    }
    trackException(throwable, properties) {
        try {
            const normalized = normalizeException(throwable);
            this._emit('error', normalized, properties);
        }
        catch (e) {
            logger.warn('[Exception] trackException failed:', e);
        }
    }
    destroy() {
        this._clearCrashRechecks();
        this._destroyH5Hooks();
        this._destroyMinigameHooks();
        this._destroyAppHook();
    }
    _reportPendingNativeCrashes() {
        if (this._isOptedOut())
            return;
        const records = readPendingCrashes(this._safeStorage);
        if (records.length === 0)
            return;
        let lastEmittedTs = 0;
        for (const record of records) {
            const emitted = this._reportAuto({ type: record.type, message: record.message, stack: record.stack }, 'fatal', record.images);
            if (emitted) {
                lastEmittedTs = Math.max(lastEmittedTs, record.timestamp);
            }
        }
        if (lastEmittedTs > 0) {
            markCrashesReported(lastEmittedTs, this._safeStorage);
        }
    }
    _scheduleCrashRechecks() {
        try {
            for (const delay of CONSTANTS.EXCEPTION_CRASH_RECHECK_DELAYS_MS) {
                this._crashRecheckTimers.push(setTimeout(() => this._reportPendingNativeCrashes(), delay));
            }
        }
        catch (e) {
            logger.warn('[Exception] Failed to schedule crash rechecks:', e);
        }
    }
    _clearCrashRechecks() {
        for (const timer of this._crashRecheckTimers) {
            clearTimeout(timer);
        }
        this._crashRecheckTimers = [];
    }
    _reportAuto(normalized, level = 'error', images) {
        try {
            if (this._isOptedOut())
                return false;
            const key = `${normalized.type}|` +
                `${normalized.message.slice(0, CONSTANTS.EXCEPTION_DEDUP_KEY_MAX_LEN)}`;
            const now = Date.now();
            const last = this._dedupMap.get(key);
            if (last != null && now - last < CONSTANTS.EXCEPTION_DEDUP_WINDOW_MS) {
                return false;
            }
            if (this._dedupMap.size >= CONSTANTS.EXCEPTION_DEDUP_MAP_MAX_SIZE) {
                this._dedupMap.clear();
            }
            this._dedupMap.set(key, now);
            return this._emit(level, normalized, undefined, images);
        }
        catch (e) {
            logger.warn('[Exception] auto report failed:', e);
            return false;
        }
    }
    _emit(level, normalized, properties, images) {
        if (this._isOptedOut())
            return false;
        if (this._sessionCount >= CONSTANTS.EXCEPTION_MAX_PER_SESSION) {
            if (!this._sessionCapWarned) {
                logger.warn(`[Exception] Session limit (${CONSTANTS.EXCEPTION_MAX_PER_SESSION}) reached, dropping further exceptions`);
                this._sessionCapWarned = true;
            }
            return false;
        }
        const frames = parseExceptionFrames(normalized.stack);
        enrichIosFrames(frames, images);
        markInAppFrames(frames, this._exceptionConfig);
        const props = {
            ...(properties || {}),
            $exception_level: level,
            $exception_type: normalized.type,
            $exception_message: normalized.message,
        };
        if (frames.length > 0) {
            props.$exception_frames = frames;
        }
        else {
            delete props.$exception_frames;
        }
        const event = this._send.sendEvent(CONSTANTS.EXCEPTION_EVENT_NAME, props);
        this._enqueueEvent(event);
        this._sessionCount++;
        this._flushImmediate();
        return true;
    }
    _installH5Hooks() {
        const g = globalThis;
        const w = g.window;
        if (!w) {
            logger.warn('[Exception] window not available, skip H5 error hooks');
            return;
        }
        try {
            this._h5Window = w;
            this._h5PrevOnError = typeof w.onerror === 'function' ? w.onerror : null;
            this._h5OnErrorWrapper = (message, source, lineno, colno, error) => {
                try {
                    this._reportAuto(normalizeOnErrorArgs(message, source, lineno, colno, error));
                }
                catch {
                }
                const prev = this._h5PrevOnError;
                if (typeof prev === 'function') {
                    try {
                        return prev.call(w, message, source, lineno, colno, error);
                    }
                    catch {
                    }
                }
                return undefined;
            };
            w.onerror = this._h5OnErrorWrapper;
            this._h5RejectionHandler = (ev) => {
                try {
                    const reason = ev && ev.reason !== undefined ? ev.reason : ev;
                    this._reportAuto(normalizeRejectionReason(reason));
                }
                catch {
                }
            };
            if (typeof w.addEventListener === 'function') {
                w.addEventListener('unhandledrejection', this._h5RejectionHandler);
            }
        }
        catch (e) {
            logger.warn('[Exception] Failed to install H5 error hooks:', e);
        }
    }
    _destroyH5Hooks() {
        if (!this._h5Window)
            return;
        try {
            const w = this._h5Window;
            if (this._h5OnErrorWrapper && w.onerror === this._h5OnErrorWrapper) {
                if (this._h5PrevOnError) {
                    w.onerror = this._h5PrevOnError;
                }
                else {
                    delete w.onerror;
                }
            }
            if (this._h5RejectionHandler && typeof w.removeEventListener === 'function') {
                w.removeEventListener('unhandledrejection', this._h5RejectionHandler);
            }
        }
        catch {
        }
        this._h5Window = null;
        this._h5PrevOnError = null;
        this._h5OnErrorWrapper = null;
        this._h5RejectionHandler = null;
    }
    _installMinigameHooks() {
        try {
            const sdk = getMPSDK();
            if (!sdk) {
                logger.warn('[Exception] MP SDK global not found, skip minigame error hooks');
                return;
            }
            if (typeof sdk.onError === 'function') {
                this._mpErrorHandler = (err) => {
                    try {
                        this._reportAuto(normalizeException(err));
                    }
                    catch {
                    }
                };
                sdk.onError(this._mpErrorHandler);
            }
            if (typeof sdk.onUnhandledRejection === 'function') {
                this._mpRejectionHandler = (res) => {
                    try {
                        const reason = res && res.reason !== undefined ? res.reason : res;
                        this._reportAuto(normalizeRejectionReason(reason));
                    }
                    catch {
                    }
                };
                sdk.onUnhandledRejection(this._mpRejectionHandler);
            }
        }
        catch (e) {
            logger.warn('[Exception] Failed to install minigame error hooks:', e);
        }
    }
    _destroyMinigameHooks() {
        try {
            const sdk = getMPSDK();
            if (sdk) {
                if (this._mpErrorHandler && typeof sdk.offError === 'function') {
                    sdk.offError(this._mpErrorHandler);
                }
                if (this._mpRejectionHandler && typeof sdk.offUnhandledRejection === 'function') {
                    sdk.offUnhandledRejection(this._mpRejectionHandler);
                }
            }
        }
        catch {
        }
        this._mpErrorHandler = null;
        this._mpRejectionHandler = null;
    }
    _installAppHook() {
        const g = globalThis;
        try {
            if (g[APP_HOOK_FLAG] === true)
                return;
            const jsbObj = g.jsb;
            if (jsbObj && typeof jsbObj.swInstallExceptionHook === 'function') {
                jsbObj.swInstallExceptionHook((location, linenum, message, stack) => {
                    this._ohosDispatchException(location, linenum, message, stack);
                });
                this._ohosHookActive = true;
                logger.info('[Exception] OHOS jsvm exception hook installed (jsb.swInstallExceptionHook)');
            }
            this._appPrevErrorHandler = typeof g.__errorHandler === 'function' ? g.__errorHandler : null;
            this._appErrorHandler = (...args) => {
                try {
                    this._reportAuto(normalizeCocosErrorHandler(...args));
                }
                catch {
                }
                const prev = this._appPrevErrorHandler;
                if (typeof prev === 'function') {
                    try {
                        prev(...args);
                    }
                    catch {
                    }
                }
            };
            g.__errorHandler = this._appErrorHandler;
            g[APP_HOOK_FLAG] = true;
            this._appHookInstalled = true;
        }
        catch (e) {
            logger.warn('[Exception] Failed to install app error hook:', e);
        }
    }
    _ohosDispatchException(location, linenum, message, stack) {
        if (!this._ohosHookActive)
            return;
        try {
            this._reportAuto(normalizeCocosErrorHandler(location, linenum, message, stack));
        }
        catch {
        }
    }
    _destroyAppHook() {
        if (!this._appHookInstalled)
            return;
        const g = globalThis;
        try {
            if (this._appErrorHandler && g.__errorHandler === this._appErrorHandler) {
                if (this._appPrevErrorHandler) {
                    g.__errorHandler = this._appPrevErrorHandler;
                }
                else {
                    delete g.__errorHandler;
                }
            }
            delete g[APP_HOOK_FLAG];
        }
        catch {
        }
        this._appErrorHandler = null;
        this._appPrevErrorHandler = null;
        this._appHookInstalled = false;
        this._ohosHookActive = false;
    }
}
ExceptionPlugin.NAME = 'Exception';

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
        this._fetchTimeoutTimer = null;
        this._refreshTimer = null;
        this._store = opts.store;
        this._send = opts.send;
        this._enableAB = opts.enableAB;
        this._apiHost = opts.apiHost;
        this._sourceToken = opts.sourceToken;
        this._refreshInterval = Math.max(opts.refreshInterval, CONSTANTS.MIN_AB_REFRESH_INTERVAL);
        this._requestFn = opts.requestFn;
        this._enqueueEvent = opts.enqueueEvent;
        this._isOptedOut = opts.isOptedOut;
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
        if (this._isOptedOut())
            return Promise.resolve([]);
        const cached = this._store.getABData();
        if (cached.length > 0) {
            return Promise.resolve(cached);
        }
        if (this._fetchingPromise) {
            return this._fetchingPromise;
        }
        this._fetchingPromise = this._fetchFromServer();
        return this._fetchingPromise;
    }
    _fetchFromServer() {
        return new Promise((resolve) => {
            let settled = false;
            const settle = (fn) => {
                if (settled)
                    return;
                settled = true;
                if (this._fetchTimeoutTimer) {
                    clearTimeout(this._fetchTimeoutTimer);
                    this._fetchTimeoutTimer = null;
                }
                fn();
            };
            this._fetchTimeoutTimer = setTimeout(() => {
                settle(() => {
                    this._fetchingPromise = null;
                    logger.warn('AB fetch timeout, resolve with empty results');
                    resolve([]);
                });
            }, CONSTANTS.REQUEST_WATCHDOG_DELAY_MS);
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
                    settle(() => {
                        this._fetchingPromise = null;
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
                    });
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
        if (this._isOptedOut())
            return;
        const userProps = unset
            ? { $unset: { [getABPropKey(abData)]: null } }
            : { $set: { [getABPropKey(abData)]: abData.vid } };
        const event = this._send.sendEvent('$FeatureImpress', buildABEventProps(abData), userProps);
        this._enqueueEvent(event);
    }
    _trackExpImpress(abData, unset = false) {
        if (this._isOptedOut())
            return;
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
        if (this._fetchTimeoutTimer) {
            clearTimeout(this._fetchTimeoutTimer);
            this._fetchTimeoutTimer = null;
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
        this._sessionManager = null;
        this._pluginManager = null;
        this._emitter = new EventEmitter();
        this._sourceToken = '';
        this._apiHost = '';
        this._optOutCapturing = false;
        this._persistOptOut = false;
        this._platformAdapter = null;
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
        this._persistOptOut = !!mergedConfig.persistOptOut;
        if (this._optOutCapturing) {
            if (this._persistOptOut)
                this._store.setOptOut(true);
        }
        else if (mergedConfig.optOutCapturing) {
            this._optOutCapturing = true;
            if (this._persistOptOut)
                this._store.setOptOut(true);
        }
        else if (this._persistOptOut && this._store.isOptedOut()) {
            this._optOutCapturing = true;
        }
        this._queue = new PersistentQueue(safeStorage);
        this._batchSender = new BatchSender(this._queue, this._requestFn, mergedConfig.maxBatchSize, mergedConfig.flushInterval);
        const platformType = detectPlatform(ccSys);
        const platformAdapter = createPlatformAdapter(platformType, ccSys, mergedConfig.getSceneName, platformType === 'app' ? mergedConfig.getDeviceInfo : undefined, () => this._optOutCapturing);
        this._platformAdapter = platformAdapter;
        this._presetProps = new PresetProperties(platformAdapter);
        this._sessionManager = new SessionManager(safeStorage);
        this._send = new Send(this._store, this._presetProps, this._sessionManager);
        this._pluginManager = new PluginManager(this._emitter);
        this._pluginManager.register(GameLifecyclePlugin);
        this._pluginManager.register(UTMPlugin);
        this._pluginManager.register(ExceptionPlugin);
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
            safeStorage,
            enableCrashTrack: mergedConfig.enableCrashTrack,
            enableErrorTrack: mergedConfig.enableErrorTrack,
            exceptionConfig: mergedConfig.exceptionConfig,
            isOptedOut: () => this._optOutCapturing,
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
        if (this._optOutCapturing) {
            this._batchSender.pause();
        }
        this.inited = true;
        this._emitter.emit('INIT_READY');
        logger.info('init success', { sourceToken, platform: platformType });
    }
    trackEvent(eventName, properties) {
        if (!this._ensureInited())
            return;
        if (this._optOutCapturing)
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
        if (this._optOutCapturing)
            return;
        if (!Send.isValidEventName(eventData.event)) {
            logger.warn('track() requires a non-empty event name');
            return;
        }
        const event = this._send.sendEvent(eventData.event, eventData.properties, eventData.user_properties, eventData.subject_properties);
        if (eventData.time !== undefined)
            event.time = eventData.time;
        if (eventData.trace_id !== undefined)
            event.trace_id = eventData.trace_id;
        if (eventData.anon_id !== undefined)
            event.anon_id = eventData.anon_id;
        if (eventData.login_id !== undefined)
            event.login_id = eventData.login_id;
        this._enqueueEvent(event);
    }
    trackException(throwable, properties) {
        if (!this._ensureInited())
            return;
        if (this._optOutCapturing)
            return;
        const plugin = this._pluginManager.getPlugin('Exception');
        if (!plugin) {
            logger.warn('Exception plugin not available');
            return;
        }
        try {
            plugin.trackException(throwable, properties);
        }
        catch (e) {
            logger.warn('trackException failed:', e);
        }
    }
    identify(loginId) {
        if (!this._ensureInited())
            return;
        if (this._optOutCapturing)
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
        if (this._optOutCapturing)
            return;
        this._store.setLoginId(String(loginId));
    }
    reset(resetAnonId) {
        if (!this._ensureInited())
            return;
        if (this._optOutCapturing)
            return;
        this._store.clearLoginId();
        if (resetAnonId) {
            this._store.resetAnonId();
        }
        this._store.clearABData();
        this._sessionManager.reset();
    }
    getAnonId() {
        if (!this._store || this._optOutCapturing)
            return '';
        return this._store.getAnonId();
    }
    getLoginId() {
        if (!this._store || this._optOutCapturing)
            return '';
        return this._store.getLoginId();
    }
    getSessionId() {
        if (!this._sessionManager || this._optOutCapturing)
            return '';
        return this._sessionManager.getSessionId();
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
        if (keys !== undefined && !Array.isArray(keys)) {
            logger.warn('clearCommonProperties() requires an array of keys');
            return;
        }
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
        if (!Array.isArray(keys)) {
            logger.warn('profileUnset() requires an array of keys');
            return;
        }
        const unsetProps = {};
        for (const key of keys) {
            unsetProps[key] = null;
        }
        this._profileOp('$unset', unsetProps);
    }
    profileDelete() {
        if (!this._ensureInited())
            return;
        if (this._optOutCapturing)
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
        if (!this.inited || !this._pluginManager || this._optOutCapturing)
            return Promise.resolve(false);
        const abPlugin = this._pluginManager.getPlugin('ABTest');
        if (!abPlugin)
            return Promise.resolve(false);
        return abPlugin.checkFeatureGate(key);
    }
    getFeatureConfig(key) {
        if (!this.inited || !this._pluginManager || this._optOutCapturing)
            return Promise.resolve({});
        const abPlugin = this._pluginManager.getPlugin('ABTest');
        if (!abPlugin)
            return Promise.resolve({});
        return abPlugin.getFeatureConfig(key);
    }
    getExperiment(key) {
        if (!this.inited || !this._pluginManager || this._optOutCapturing)
            return Promise.resolve(null);
        const abPlugin = this._pluginManager.getPlugin('ABTest');
        if (!abPlugin)
            return Promise.resolve(null);
        return abPlugin.getExperiment(key);
    }
    flush() {
        if (!this._batchSender || this._optOutCapturing)
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
    optOutCapturing() {
        this._optOutCapturing = true;
        if (this.inited) {
            if (this._persistOptOut && this._store)
                this._store.setOptOut(true);
            if (this._batchSender)
                this._batchSender.pause();
        }
    }
    optInCapturing() {
        this._optOutCapturing = false;
        if (this.inited) {
            if (this._persistOptOut && this._store)
                this._store.setOptOut(false);
            if (this._batchSender)
                this._batchSender.resume();
            try {
                this._platformAdapter?.onOptIn?.();
            }
            catch (e) {
                logger.warn('Failed to resume device info prefetch on opt-in:', e);
            }
            const utmPlugin = this._pluginManager?.getPlugin('UTM');
            if (utmPlugin) {
                try {
                    utmPlugin.onOptIn();
                }
                catch (e) {
                    logger.warn('Failed to replay initial UTM on opt-in:', e);
                }
            }
        }
    }
    hasOptedOutCapturing() {
        return this._optOutCapturing;
    }
    destroy() {
        if (this._pluginManager) {
            this._pluginManager.destroy();
        }
        if (this._batchSender) {
            this._batchSender.destroy();
        }
        try {
            this._platformAdapter?.dispose?.();
        }
        catch (e) {
            logger.warn('Failed to dispose platform adapter:', e);
        }
        this._platformAdapter = null;
        this._emitter.removeAllListeners();
        this.inited = false;
        this._optOutCapturing = false;
        this._persistOptOut = false;
        this._store = null;
        this._queue = null;
        this._batchSender = null;
        this._batchSendEnabled = false;
        this._send = null;
        this._presetProps = null;
        this._sessionManager = null;
        this._pluginManager = null;
    }
    _profileOp(operator, props) {
        if (!this._ensureInited())
            return;
        if (this._optOutCapturing)
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
        if (this._optOutCapturing)
            return;
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
            xhr.onerror = () => {
                config.callback?.({ statusCode: 0, text: 'Network error' });
            };
            xhr.ontimeout = () => {
                config.callback?.({ statusCode: 0, text: 'Request timeout' });
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
