// ============================================================================
// In-Memory TTL Cache
//
// Generic Map<key, {value, expiry}> wrapper with auto-expiry on read.
// - TTL-only: no manual invalidation hooks
// - 5-min default TTL; per-call override allowed
// - In-memory single-instance; swap to Redis if/when scaled out
//
// Lazy eviction: expired entries are dropped on next get(). No timer thread.
// ============================================================================

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
}

export interface TTLCache<T> {
    get(key: string): T | undefined;
    set(key: string, value: T, ttlMs?: number): void;
    invalidate(key: string): void;
    clear(): void;
    size(): number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 min

export function createCache<T>(defaultTtlMs: number = DEFAULT_TTL_MS): TTLCache<T> {
    const store = new Map<string, CacheEntry<T>>();

    return {
        get(key) {
            const entry = store.get(key);
            if (!entry) return undefined;
            if (Date.now() >= entry.expiresAt) {
                store.delete(key);
                return undefined;
            }
            return entry.value;
        },
        set(key, value, ttlMs = defaultTtlMs) {
            store.set(key, { value, expiresAt: Date.now() + ttlMs });
        },
        invalidate(key) {
            store.delete(key);
        },
        clear() {
            store.clear();
        },
        size() {
            return store.size;
        },
    };
}
