import { safeFetch, safeFetchWithConditional } from '../fetch-service'
import {
  getCachedFeed, setCachedFeed, clearFeedCache,
  getConditionalHeaders, getHeaderCachedContent, getHeaderCacheEntry, updateFeedHeaders,
} from '../feed-cache'
import { trackOperation, categorizeError } from '../analytics'
import { trackEngagement } from '../engagement'
import type { HandlerMap } from './types'
import { success } from './types'

export const feedHandlers: HandlerMap = {
  FETCH_FEED: async (message) => {
    const { requestId } = message
    const feedUrl = message.feedUrl as string

    // 1. In-memory TTL cache (fast path)
    const cached = getCachedFeed(feedUrl)
    if (cached !== undefined) {
      console.log(`[IPC] Cache hit: ${feedUrl}`)
      trackOperation('feedFetch', true)
      return success(requestId, 'FEED_RESPONSE', cached)
    }

    // 2. Conditional fetch with ETag/Last-Modified
    try {
      const conditionalHeaders = getConditionalHeaders(feedUrl)
      const result = await safeFetchWithConditional(feedUrl, conditionalHeaders)

      if (result.notModified) {
        // 304: serve from persistent header cache
        const headerCached = getHeaderCachedContent(feedUrl)
        if (headerCached) {
          setCachedFeed(feedUrl, headerCached)
          trackOperation('feedFetch', true)
          return success(requestId, 'FEED_RESPONSE', headerCached)
        }
      }

      // 200: update both caches
      if (result.data) {
        setCachedFeed(feedUrl, result.data)
        updateFeedHeaders(feedUrl, result.etag, result.lastModified, result.data)
      }
      trackOperation('feedFetch', true)
      return success(requestId, 'FEED_RESPONSE', result.data)
    } catch (err) {
      // 3. Offline fallback: serve stale persistent cache if available
      const staleEntry = getHeaderCacheEntry(feedUrl)
      if (staleEntry) {
        console.log(`[IPC] Offline fallback for: ${feedUrl} (cached ${new Date(staleEntry.cachedAt).toISOString()})`)
        trackOperation('feedFetch', true)
        return {
          type: 'FEED_RESPONSE',
          requestId,
          success: true,
          data: staleEntry.content,
          _offline: true,
          _cachedAt: staleEntry.cachedAt,
        }
      }
      trackOperation('feedFetch', false, categorizeError(err))
      throw err
    }
  },

  FETCH_FEEDS_BATCH: async (message) => {
    const { requestId } = message
    const feeds = message.feeds as Array<{ feedUrl: string }>
    const maxConcurrent = (message.maxConcurrent as number) || 10

    const results: Array<{
      feedUrl: string
      success: boolean
      data?: string
      error?: string
      status?: number
      _offline?: boolean
      _cachedAt?: number
    }> = []

    for (let i = 0; i < feeds.length; i += maxConcurrent) {
      const batch = feeds.slice(i, i + maxConcurrent)
      const batchResults = await Promise.allSettled(
        batch.map(async (feed) => {
          const cached = getCachedFeed(feed.feedUrl)
          if (cached !== undefined) {
            return {
              feedUrl: feed.feedUrl,
              success: true,
              data: cached,
              status: 200,
            }
          }
          const result = await safeFetch(feed.feedUrl)
          if (result.data) {
            setCachedFeed(feed.feedUrl, result.data)
            updateFeedHeaders(feed.feedUrl, result.etag, result.lastModified, result.data)
          }
          return {
            feedUrl: feed.feedUrl,
            success: true,
            data: result.data,
            status: result.status,
          }
        })
      )

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j]
        if (result.status === 'fulfilled') {
          results.push(result.value)
        } else {
          // Offline fallback: try persistent cache for failed feeds
          const staleEntry = getHeaderCacheEntry(batch[j].feedUrl)
          if (staleEntry) {
            console.log(`[IPC] Batch offline fallback for: ${batch[j].feedUrl}`)
            results.push({
              feedUrl: batch[j].feedUrl,
              success: true,
              data: staleEntry.content,
              status: 200,
              _offline: true,
              _cachedAt: staleEntry.cachedAt,
            })
          } else {
            results.push({
              feedUrl: batch[j].feedUrl,
              success: false,
              error: result.reason?.message || 'Unknown error',
            })
          }
        }
      }
    }

    const successCount = results.filter((r) => r.success).length
    return {
      type: 'FEEDS_BATCH_RESPONSE',
      requestId,
      success: true,
      results,
      totalProcessed: results.length,
      successCount,
      errorCount: results.length - successCount,
    }
  },

  FETCH_PAGE: async (message) => {
    const { requestId } = message
    const url = message.url as string
    try {
      const result = await safeFetch(url)
      trackOperation('pageFetch', true)
      return success(requestId, 'PAGE_RESPONSE', result.data)
    } catch (err) {
      trackOperation('pageFetch', false, categorizeError(err))
      throw err
    }
  },

  CLEAR_FEED_CACHE: (message) => {
    clearFeedCache()
    trackEngagement('feedsRefreshed')
    console.log('[IPC] Feed cache cleared')
    return success(message.requestId, 'CLEAR_FEED_CACHE_RESPONSE', null)
  },
}
