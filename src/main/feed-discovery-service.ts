import { parseHTML } from 'linkedom'
import { safeFetch } from './fetch-service'

export interface DiscoveredFeed {
  url: string
  title?: string
  type: 'rss' | 'atom' | 'unknown'
}

/**
 * Common feed paths to probe when <link> parsing finds nothing.
 */
const COMMON_FEED_PATHS = [
  '/feed',
  '/feed/',
  '/rss',
  '/rss.xml',
  '/atom.xml',
  '/feed.xml',
  '/index.xml',
  '/blog/feed',
  '/blog/rss',
  '/blog/rss.xml',
  '/blog/atom.xml',
  '/blog/feed.xml',
  '/.rss',
  '/rss/feed',
]

/**
 * Discover RSS/Atom feeds from a blog URL.
 *
 * 1. Fetches the page HTML
 * 2. Parses <link rel="alternate"> tags for feed URLs
 * 3. Falls back to probing common feed paths
 */
export async function discoverFeeds(blogUrl: string): Promise<DiscoveredFeed[]> {
  // Ensure URL has a protocol
  let normalizedUrl = blogUrl.trim()
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`
  }
  if (normalizedUrl.endsWith('/')) {
    normalizedUrl = normalizedUrl.slice(0, -1)
  }

  // Step 1: Fetch and parse the page
  let feeds: DiscoveredFeed[] = []
  try {
    const { data: html } = await safeFetch(normalizedUrl)
    feeds = parseLinkTags(html, normalizedUrl)
  } catch {
    // Page fetch failed — fall through to probing
  }

  if (feeds.length > 0) {
    return feeds
  }

  // Step 2: Probe common feed paths
  return await probeCommonPaths(normalizedUrl)
}

/**
 * Parse <link rel="alternate"> tags from HTML to find feed URLs.
 */
function parseLinkTags(html: string, baseUrl: string): DiscoveredFeed[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { document } = parseHTML(html) as any
  const feeds: DiscoveredFeed[] = []

  const links = document.querySelectorAll(
    'link[rel="alternate"][type="application/rss+xml"], ' +
    'link[rel="alternate"][type="application/atom+xml"], ' +
    'link[rel="alternate"][type="application/feed+json"], ' +
    'link[rel="alternate"][type="application/xml"], ' +
    'link[rel="alternate"][type="text/xml"]'
  )

  for (const link of links) {
    const href = link.getAttribute('href')
    if (!href) continue

    const title = link.getAttribute('title') || undefined
    const type = link.getAttribute('type') || ''

    let feedType: DiscoveredFeed['type'] = 'unknown'
    if (type.includes('rss')) feedType = 'rss'
    else if (type.includes('atom')) feedType = 'atom'

    // Resolve relative URLs
    let url: string
    try {
      url = new URL(href, baseUrl).toString()
    } catch {
      continue
    }

    feeds.push({ url, title, type: feedType })
  }

  return feeds
}

/**
 * Probe common feed paths to see if any return valid feed content.
 */
async function probeCommonPaths(baseUrl: string): Promise<DiscoveredFeed[]> {
  const feeds: DiscoveredFeed[] = []

  // Probe in parallel with a concurrency limit
  const CONCURRENCY = 3
  const paths = [...COMMON_FEED_PATHS]

  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const batch = paths.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async (feedPath) => {
        const url = `${baseUrl}${feedPath}`
        const { data, contentType, status } = await safeFetch(url)

        if (status !== 200) return null

        // Check if it looks like a feed
        const isFeed =
          contentType?.includes('xml') ||
          contentType?.includes('rss') ||
          contentType?.includes('atom') ||
          data.trimStart().startsWith('<?xml') ||
          data.trimStart().startsWith('<rss') ||
          data.trimStart().startsWith('<feed')

        if (!isFeed) return null

        let type: DiscoveredFeed['type'] = 'unknown'
        if (data.includes('<rss') || contentType?.includes('rss')) type = 'rss'
        else if (data.includes('<feed') || contentType?.includes('atom')) type = 'atom'

        return { url, type } as DiscoveredFeed
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        feeds.push(result.value)
      }
    }

    // Stop probing once we find feeds
    if (feeds.length > 0) break
  }

  return feeds
}

/**
 * Discover images (site icon and OG image) from a blog URL.
 */
export async function discoverImages(
  blogUrl: string
): Promise<{ siteIcon?: string; ogImage?: string }> {
  // Ensure URL has a protocol
  let url = blogUrl.trim()
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }
  const { data: html } = await safeFetch(url)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { document } = parseHTML(html) as any

  let siteIcon: string | undefined
  let ogImage: string | undefined

  // Find favicon
  const iconSelectors = [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
    'link[rel="apple-touch-icon-precomposed"]',
  ]

  for (const selector of iconSelectors) {
    const el = document.querySelector(selector)
    if (el) {
      const href = el.getAttribute('href')
      if (href) {
        try {
          siteIcon = new URL(href, blogUrl).toString()
          break
        } catch {
          // Invalid URL, try next
        }
      }
    }
  }

  // Fallback: try /favicon.ico
  if (!siteIcon) {
    try {
      const faviconUrl = new URL('/favicon.ico', blogUrl).toString()
      const result = await safeFetch(faviconUrl)
      if (result.status === 200) {
        siteIcon = faviconUrl
      }
    } catch {
      // No favicon found
    }
  }

  // Find og:image
  const ogEl = document.querySelector('meta[property="og:image"]')
  if (ogEl) {
    const content = ogEl.getAttribute('content')
    if (content) {
      try {
        ogImage = new URL(content, blogUrl).toString()
      } catch {
        // Invalid URL
      }
    }
  }

  // Try twitter:image as fallback
  if (!ogImage) {
    const twitterEl =
      document.querySelector('meta[name="twitter:image"]') ||
      document.querySelector('meta[property="twitter:image"]')
    if (twitterEl) {
      const content = twitterEl.getAttribute('content')
      if (content) {
        try {
          ogImage = new URL(content, blogUrl).toString()
        } catch {
          // Invalid URL
        }
      }
    }
  }

  return { siteIcon, ogImage }
}
