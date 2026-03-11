/**
 * In-memory TTL cache for feed responses + persistent ETag/Last-Modified cache.
 *
 * Two layers:
 * 1. In-memory TTL cache — fast path for repeat requests within minutes
 * 2. Persistent header cache — stores ETag/Last-Modified for conditional GETs
 */

import { readJsonFile, writeJsonFile } from './storage'

const TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_ENTRIES = 200
const HEADERS_FILE = 'feed-headers.json'
const MAX_HEADER_ENTRIES = 200

// ================================================================
// In-memory TTL cache (unchanged behavior)
// ================================================================

interface CacheEntry {
  data: string
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

/** Return cached data if fresh, or undefined if stale/missing. */
export function getCachedFeed(url: string): string | undefined {
  const entry = cache.get(url)
  if (!entry) return undefined

  if (Date.now() - entry.fetchedAt > TTL_MS) {
    cache.delete(url)
    return undefined
  }

  // Move to end for LRU ordering (Map preserves insertion order)
  cache.delete(url)
  cache.set(url, entry)
  return entry.data
}

/** Store a feed response in the cache, evicting oldest if at capacity. */
export function setCachedFeed(url: string, data: string): void {
  // Evict oldest entries if at capacity
  if (cache.size >= MAX_ENTRIES && !cache.has(url)) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }

  cache.set(url, { data, fetchedAt: Date.now() })
}

/** Clear the entire cache (e.g. on manual refresh). */
export function clearFeedCache(): void {
  cache.clear()
}

// ================================================================
// Persistent ETag/Last-Modified cache
// ================================================================

interface FeedHeaderEntry {
  etag?: string
  lastModified?: string
  content: string
  cachedAt: number
  size: number
}

type HeaderStore = Record<string, FeedHeaderEntry>

// In-memory mirror loaded lazily
let headerCache: HeaderStore | null = null

function loadHeaderCache(): HeaderStore {
  if (headerCache === null) {
    headerCache = readJsonFile<HeaderStore>(HEADERS_FILE, {})
  }
  return headerCache
}

function saveHeaderCache(): void {
  if (headerCache) writeJsonFile(HEADERS_FILE, headerCache)
}

/** Get conditional request headers for a URL (ETag / Last-Modified). */
export function getConditionalHeaders(url: string): { etag?: string; lastModified?: string } {
  const store = loadHeaderCache()
  const entry = store[url]
  if (!entry) return {}
  return { etag: entry.etag, lastModified: entry.lastModified }
}

/** Get cached content from the persistent header store (for 304 responses). */
export function getHeaderCachedContent(url: string): string | undefined {
  const store = loadHeaderCache()
  return store[url]?.content
}

/** Get full cache entry including cachedAt timestamp (for offline fallback). */
export function getHeaderCacheEntry(url: string): FeedHeaderEntry | undefined {
  const store = loadHeaderCache()
  return store[url]
}

/** Update persistent header cache with new ETag/Last-Modified + content.
 *  Always stores the content for offline fallback, even without conditional headers. */
export function updateFeedHeaders(
  url: string,
  etag: string | undefined,
  lastModified: string | undefined,
  content: string
): void {
  const store = loadHeaderCache()

  // Evict oldest entries if at capacity
  const keys = Object.keys(store)
  if (keys.length >= MAX_HEADER_ENTRIES && !store[url]) {
    let oldestKey = keys[0]
    let oldestTime = store[keys[0]].cachedAt
    for (const key of keys) {
      if (store[key].cachedAt < oldestTime) {
        oldestTime = store[key].cachedAt
        oldestKey = key
      }
    }
    delete store[oldestKey]
  }

  store[url] = {
    etag,
    lastModified,
    content,
    cachedAt: Date.now(),
    size: content.length,
  }
  saveHeaderCache()
}
