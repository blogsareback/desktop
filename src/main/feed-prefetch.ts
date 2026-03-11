/**
 * Proactive feed caching — pre-fetches feeds for all followed blogs
 * so content is available offline even for feeds the user hasn't viewed.
 *
 * Runs in the background after update checks, with concurrency control
 * to avoid overwhelming the network.
 */

import { getSyncData } from './sync-service'
import { safeFetchWithConditional } from './fetch-service'
import {
  getCachedFeed, setCachedFeed,
  getConditionalHeaders, getHeaderCachedContent, updateFeedHeaders,
} from './feed-cache'
import { getNetworkStatus } from './network-status'

const MAX_CONCURRENT = 5
const BATCH_DELAY_MS = 500

/** Prefetch a single feed, using conditional headers to avoid re-downloading unchanged content. */
async function prefetchFeed(feedUrl: string): Promise<boolean> {
  // Skip if already in the fresh in-memory cache
  if (getCachedFeed(feedUrl) !== undefined) return false

  try {
    const conditionalHeaders = getConditionalHeaders(feedUrl)
    const result = await safeFetchWithConditional(feedUrl, conditionalHeaders)

    if (result.notModified) {
      // Content unchanged — promote to in-memory cache
      const content = getHeaderCachedContent(feedUrl)
      if (content) setCachedFeed(feedUrl, content)
      return false
    }

    if (result.data) {
      setCachedFeed(feedUrl, result.data)
      updateFeedHeaders(feedUrl, result.etag, result.lastModified, result.data)
      return true
    }
  } catch {
    // Silently skip — this is background work
  }
  return false
}

/**
 * Prefetch all followed feeds for offline availability.
 * Returns the count of newly cached feeds.
 */
export async function prefetchFollowedFeeds(): Promise<{ cached: number; total: number }> {
  // Don't prefetch if offline
  if (getNetworkStatus() === 'offline') {
    return { cached: 0, total: 0 }
  }

  const sync = getSyncData()

  // Collect all unique feed URLs from all blog sources
  const feedUrls = new Set<string>()
  for (const url of sync.followedFeedUrls) {
    feedUrls.add(url)
  }
  for (const blog of sync.directoryBlogs) {
    if (blog.feedUrl) feedUrls.add(blog.feedUrl)
  }
  for (const blog of sync.communityBlogs) {
    if (blog.feedUrl) feedUrls.add(blog.feedUrl)
  }
  for (const blog of sync.customBlogs) {
    if (blog.feedUrl) feedUrls.add(blog.feedUrl)
  }

  const urls = Array.from(feedUrls)
  if (urls.length === 0) return { cached: 0, total: 0 }

  let cached = 0

  // Process in batches with concurrency control
  for (let i = 0; i < urls.length; i += MAX_CONCURRENT) {
    // Abort if we go offline mid-prefetch
    if (getNetworkStatus() === 'offline') break

    const batch = urls.slice(i, i + MAX_CONCURRENT)
    const results = await Promise.allSettled(batch.map(url => prefetchFeed(url)))

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        cached++
      }
    }

    // Small delay between batches to be gentle on network
    if (i + MAX_CONCURRENT < urls.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS))
    }
  }

  if (cached > 0) {
    console.log(`[FeedPrefetch] Cached ${cached} new feeds out of ${urls.length} total`)
  }

  return { cached, total: urls.length }
}
