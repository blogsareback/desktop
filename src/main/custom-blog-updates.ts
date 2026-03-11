import { readJsonFile, writeJsonFile } from './storage'
import { getSyncData } from './sync-service'

const STATE_FILE = 'custom-blog-updates.json'
const HEAD_TIMEOUT_MS = 5_000
const FETCH_TIMEOUT_MS = 15_000
const MAX_CONCURRENT = 10
const USER_AGENT = 'BlogsAreBack-Desktop/0.1.0'

export interface CustomBlogUpdatesState {
  updatedCount: number
  totalCount: number
  lastCheckedAt: number | null
  blogs: Array<{
    feedUrl: string
    title: string
    hasUpdates: boolean
    lastKnownPostDate: number | null
    latestPostDate: number | null
  }>
}

const DEFAULT_STATE: CustomBlogUpdatesState = {
  updatedCount: 0,
  totalCount: 0,
  lastCheckedAt: null,
  blogs: [],
}

// Date patterns found in RSS/Atom feeds
const DATE_PATTERNS = [
  /<pubDate>\s*([^<]+)\s*<\/pubDate>/i,
  /<updated>\s*([^<]+)\s*<\/updated>/i,
  /<dc:date>\s*([^<]+)\s*<\/dc:date>/i,
  /<published>\s*([^<]+)\s*<\/published>/i,
]

function extractLatestPostDate(xml: string): number | null {
  // Find first <item> or <entry> block — that's the latest post
  const itemMatch = xml.match(/<(?:item|entry)[\s>]([\s\S]*?)(?:<\/(?:item|entry)>)/i)
  if (!itemMatch) return null

  const itemContent = itemMatch[1]
  for (const pattern of DATE_PATTERNS) {
    const match = itemContent.match(pattern)
    if (match) {
      const date = new Date(match[1].trim())
      if (!isNaN(date.getTime())) return date.getTime()
    }
  }
  return null
}

async function checkSingleBlog(
  feedUrl: string,
  lastKnownPostDate: number | null
): Promise<{ modified: boolean; latestPostDate: number | null }> {
  // HEAD request first for fast path
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS)
    const headResp = await fetch(feedUrl, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    })
    clearTimeout(timeout)

    // If we have a Last-Modified and a baseline, try the fast path
    const lm = headResp.headers.get('last-modified')
    if (lm && lastKnownPostDate) {
      const serverDate = new Date(lm).getTime()
      if (!isNaN(serverDate) && serverDate <= lastKnownPostDate) {
        return { modified: false, latestPostDate: lastKnownPostDate }
      }
    }
  } catch {
    // HEAD failed, fall through to full fetch
  }

  // Full fetch to extract actual post date
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetch(feedUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    })
    clearTimeout(timeout)

    if (!resp.ok) return { modified: false, latestPostDate: lastKnownPostDate }

    const xml = await resp.text()
    const latestPostDate = extractLatestPostDate(xml)

    if (latestPostDate && lastKnownPostDate && latestPostDate > lastKnownPostDate) {
      return { modified: true, latestPostDate }
    }

    return { modified: false, latestPostDate: latestPostDate || lastKnownPostDate }
  } catch {
    return { modified: false, latestPostDate: lastKnownPostDate }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Check all custom blogs for new posts.
 * Uses HEAD-first fast path + full fetch with date extraction.
 */
export async function checkCustomBlogUpdates(): Promise<CustomBlogUpdatesState> {
  const syncData = getSyncData()
  const customBlogs = syncData.customBlogs

  if (customBlogs.length === 0) {
    const state: CustomBlogUpdatesState = { ...DEFAULT_STATE }
    writeJsonFile(STATE_FILE, state)
    return state
  }

  // Load existing state to preserve lastKnownPostDate baselines
  const existing = readJsonFile<CustomBlogUpdatesState>(STATE_FILE, DEFAULT_STATE)
  const baselineMap = new Map(existing.blogs.map(b => [b.feedUrl, b.lastKnownPostDate]))

  const blogResults: CustomBlogUpdatesState['blogs'] = []

  // Process in batches of MAX_CONCURRENT
  for (let i = 0; i < customBlogs.length; i += MAX_CONCURRENT) {
    const batch = customBlogs.slice(i, i + MAX_CONCURRENT)
    const results = await Promise.allSettled(
      batch.map(async (blog) => {
        const baseline = baselineMap.get(blog.feedUrl) ?? blog.lastPostDate
        const { modified, latestPostDate } = await checkSingleBlog(blog.feedUrl, baseline)
        return {
          feedUrl: blog.feedUrl,
          title: blog.title,
          hasUpdates: modified,
          lastKnownPostDate: baseline,
          latestPostDate,
        }
      })
    )

    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      if (result.status === 'fulfilled') {
        blogResults.push(result.value)
      } else {
        blogResults.push({
          feedUrl: batch[j].feedUrl,
          title: batch[j].title,
          hasUpdates: false,
          lastKnownPostDate: baselineMap.get(batch[j].feedUrl) ?? batch[j].lastPostDate,
          latestPostDate: null,
        })
      }
    }
  }

  const updatedCount = blogResults.filter(b => b.hasUpdates).length
  const state: CustomBlogUpdatesState = {
    updatedCount,
    totalCount: blogResults.length,
    lastCheckedAt: Date.now(),
    blogs: blogResults,
  }

  writeJsonFile(STATE_FILE, state)
  console.log(`[CustomBlogUpdates] ${updatedCount}/${blogResults.length} blogs have new posts`)
  return state
}

export function getCustomBlogState(): CustomBlogUpdatesState {
  return readJsonFile<CustomBlogUpdatesState>(STATE_FILE, DEFAULT_STATE)
}

/** Advance baselines for acknowledged custom blogs and clear hasUpdates. */
export function acknowledgeCustomBlogUpdates(): void {
  const state = getCustomBlogState()
  for (const blog of state.blogs) {
    if (blog.hasUpdates && blog.latestPostDate) {
      blog.lastKnownPostDate = blog.latestPostDate
    }
    blog.hasUpdates = false
  }
  state.updatedCount = 0
  writeJsonFile(STATE_FILE, state)
}
