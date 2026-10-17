/**
 * src/services/dataCache.ts
 *
 * High-performance, in-memory Stale-While-Revalidate (SWR) cache
 * with in-flight Promise deduplication.
 *
 * Guarantees:
 * 1. 0ms initial render for previously fetched data.
 * 2. Background revalidation without screen flashing.
 * 3. Never fires duplicate simultaneous network requests for the same resource.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

class InMemoryDataCache {
  private cache = new Map<string, CacheEntry<any>>();
  private inFlight = new Map<string, Promise<any>>();

  /**
   * Retrieves data from cache if present and fresh (unexpired).
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    const isExpired = Date.now() - entry.timestamp > entry.ttlMs;
    return isExpired ? null : (entry.data as T);
  }

  /**
   * Returns cached data even if expired (for SWR 0ms initial renders).
   */
  getStale<T>(key: string): T | null {
    const entry = this.cache.get(key);
    return entry ? (entry.data as T) : null;
  }

  /**
   * Checks if any entry exists in cache.
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Stores data in memory with a designated TTL.
   */
  set<T>(key: string, data: T, ttlMs: number = 60000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttlMs,
    });
  }

  /**
   * Invalidate a specific cache key or prefix.
   */
  invalidate(keyOrPrefix: string): void {
    for (const key of this.cache.keys()) {
      if (key === keyOrPrefix || key.startsWith(`${keyOrPrefix}_`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clears all cached in-memory entries (e.g. on logout).
   */
  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  /**
   * Stale-While-Revalidate execution with promise deduplication.
   *
   * 1. If fresh data exists -> return immediately (0ms).
   * 2. If stale data exists -> return immediately (0ms) AND fetch fresh in background.
   * 3. If no data exists -> fetch with deduplication.
   */
  async executeSWR<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number = 60000,
    onBackgroundUpdate?: (fresh: T) => void
  ): Promise<T> {
    const fresh = this.get<T>(key);
    if (fresh !== null) {
      return fresh;
    }

    const stale = this.getStale<T>(key);

    // If an identical request is already active in-flight, reuse its promise
    if (this.inFlight.has(key)) {
      if (stale !== null) {
        return stale;
      }
      return this.inFlight.get(key)!;
    }

    const networkPromise = (async () => {
      try {
        const result = await fetcher();
        this.set(key, result, ttlMs);
        if (stale !== null && onBackgroundUpdate) {
          try {
            onBackgroundUpdate(result);
          } catch (err) {
            console.warn('[DataCache] Error in onBackgroundUpdate callback:', err);
          }
        }
        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, networkPromise);

    // If stale data is available, return it immediately so the screen opens in 0ms
    if (stale !== null) {
      return stale;
    }

    return networkPromise;
  }
}

export const dataCache = new InMemoryDataCache();
