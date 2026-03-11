import { extractReadableContent } from '../readability-service'
import { discoverFeeds, discoverImages } from '../feed-discovery-service'
import { safeFetch } from '../fetch-service'
import { trackOperation, categorizeError } from '../analytics'
import type { HandlerMap } from './types'

export const contentHandlers: HandlerMap = {
  EXTRACT_READABLE_TEXT: async (message) => {
    const { requestId } = message
    const url = message.url as string
    try {
      const content = await extractReadableContent(url)
      trackOperation('readableText', true)
      return {
        type: 'READABLE_TEXT_RESPONSE',
        requestId,
        success: true,
        data: {
          title: content.title,
          textContent: content.textContent,
          image: content.image,
        },
      }
    } catch (err) {
      trackOperation('readableText', false, categorizeError(err))
      throw err
    }
  },

  EXTRACT_READABLE_HTML: async (message) => {
    const { requestId } = message
    const url = message.url as string
    try {
      const content = await extractReadableContent(url)
      trackOperation('readableHtml', true)
      return {
        type: 'READABLE_HTML_RESPONSE',
        requestId,
        success: true,
        data: {
          title: content.title,
          htmlContent: content.htmlContent,
          textContent: content.textContent,
          excerpt: content.excerpt,
          byline: content.byline,
          image: content.image,
        },
      }
    } catch (err) {
      trackOperation('readableHtml', false, categorizeError(err))
      throw err
    }
  },

  DISCOVER_FEEDS: async (message) => {
    const blogUrl = message.blogUrl as string
    const feeds = await discoverFeeds(blogUrl)
    return {
      type: 'DISCOVER_FEEDS_RESPONSE',
      requestId: message.requestId,
      success: true,
      feeds,
    }
  },

  DISCOVER_IMAGES: async (message) => {
    const blogUrl = message.blogUrl as string
    const images = await discoverImages(blogUrl)
    return {
      type: 'DISCOVER_IMAGES_RESPONSE',
      requestId: message.requestId,
      success: true,
      images,
    }
  },

  DISCOVER_IMAGES_BATCH: async (message) => {
    const { requestId } = message
    const blogUrls = message.blogUrls as string[]
    const maxConcurrent = (message.maxConcurrent as number) || 5

    const results: Array<{
      blogUrl: string
      success: boolean
      images?: { siteIcon?: string; ogImage?: string }
      error?: string
    }> = []

    for (let i = 0; i < blogUrls.length; i += maxConcurrent) {
      const batch = blogUrls.slice(i, i + maxConcurrent)
      const batchResults = await Promise.allSettled(
        batch.map(async (blogUrl) => {
          const images = await discoverImages(blogUrl)
          return { blogUrl, success: true as const, images }
        })
      )

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j]
        if (result.status === 'fulfilled') {
          results.push(result.value)
        } else {
          results.push({
            blogUrl: batch[j],
            success: false,
            error: result.reason?.message || 'Unknown error',
          })
        }
      }
    }

    const successCount = results.filter((r) => r.success).length
    return {
      type: 'DISCOVER_IMAGES_BATCH_RESPONSE',
      requestId,
      success: true,
      results,
      totalProcessed: results.length,
      successCount,
      errorCount: results.length - successCount,
    }
  },

  TEST_BLOG_STATUS: async (message) => {
    const { requestId } = message
    const feedUrl = message.feedUrl as string

    try {
      const feedResult = await safeFetch(feedUrl)
      const feedSuccess = feedResult.status >= 200 && feedResult.status < 400

      return {
        type: 'TEST_BLOG_STATUS_RESPONSE',
        requestId,
        success: true,
        result: {
          requiresProxy: false,
          hasFullContent: null,
          postsRequireProxy: false,
          blocksIframe: null,
          errors: feedSuccess ? [] : [`Feed returned status ${feedResult.status}`],
        },
      }
    } catch (err: unknown) {
      return {
        type: 'TEST_BLOG_STATUS_RESPONSE',
        requestId,
        success: true,
        result: {
          requiresProxy: false,
          hasFullContent: null,
          postsRequireProxy: false,
          blocksIframe: null,
          errors: [err instanceof Error ? err.message : 'Unknown error'],
        },
      }
    }
  },
}
