import * as fs from 'fs'
import * as path from 'path'
import { getDataDir, readJsonFile, writeJsonFile } from './storage'
import { extractReadableContent } from './readability-service'

const INDEX_FILE = 'saved-posts-index.json'
const POSTS_DIR = 'saved-posts'
const MAX_POSTS = 500
const MAX_TOTAL_BYTES = 200 * 1024 * 1024 // 200MB
const MIN_RSS_CONTENT_LENGTH = 500

interface SavedPostMeta {
  id: string
  guid: string
  link: string
  title: string
  author?: string
  pubDate: number | null
  description?: string
  image?: string
  blogId?: string
  blogTitle?: string
  blogIcon?: string
  blogFeedUrl?: string
  savedAt: number
  sizeBytes: number
  domain?: string
  saveSource?: 'blog-post' | 'url'
}

// In-memory index, loaded lazily
let indexCache: SavedPostMeta[] | null = null

function guidToId(guid: string): string {
  let hash = 5381
  for (let i = 0; i < guid.length; i++) {
    hash = ((hash << 5) + hash + guid.charCodeAt(i)) & 0xffffffff
  }
  return Math.abs(hash).toString(36)
}

function getPostsDir(): string {
  const dir = path.join(getDataDir(), POSTS_DIR)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function loadIndex(): SavedPostMeta[] {
  if (indexCache === null) {
    indexCache = readJsonFile<SavedPostMeta[]>(INDEX_FILE, [])
  }
  return indexCache
}

function saveIndex(): void {
  if (indexCache) writeJsonFile(INDEX_FILE, indexCache)
}

function getTotalSize(): number {
  return loadIndex().reduce((sum, p) => sum + p.sizeBytes, 0)
}

function evictOldest(): void {
  const index = loadIndex()
  while (index.length >= MAX_POSTS || getTotalSize() > MAX_TOTAL_BYTES) {
    const oldest = index.shift()
    if (!oldest) break
    try {
      fs.unlinkSync(path.join(getPostsDir(), `${oldest.id}.html`))
    } catch { /* file may not exist */ }
  }
}

function writeHtmlFile(id: string, html: string): number {
  const filePath = path.join(getPostsDir(), `${id}.html`)
  fs.writeFileSync(filePath, html, 'utf-8')
  return Buffer.byteLength(html, 'utf-8')
}

/**
 * Save a post offline. Uses rssContent if >= 500 chars, otherwise fetches via Readability.
 */
export async function savePostOffline(message: Record<string, unknown>): Promise<{
  success: boolean
  alreadySaved?: boolean
  error?: string
}> {
  const post = message.post as Record<string, unknown> | undefined
  if (!post || !post.guid) {
    return { success: false, error: 'Missing post data or guid' }
  }

  const guid = post.guid as string
  const id = guidToId(guid)
  const index = loadIndex()

  // Already saved?
  if (index.some(p => p.guid === guid)) {
    return { success: true, alreadySaved: true }
  }

  // Determine content
  let html: string
  const rssContent = post.rssContent as string | undefined

  if (rssContent && rssContent.length >= MIN_RSS_CONTENT_LENGTH) {
    html = rssContent
  } else {
    const link = post.link as string
    if (!link) return { success: false, error: 'No link to fetch content from' }
    try {
      const extracted = await extractReadableContent(link)
      html = extracted.htmlContent
    } catch (err) {
      return { success: false, error: `Failed to extract content: ${err instanceof Error ? err.message : 'Unknown'}` }
    }
  }

  // Evict if needed
  evictOldest()

  // Write content file
  const sizeBytes = writeHtmlFile(id, html)

  // Add to index
  const meta: SavedPostMeta = {
    id,
    guid,
    link: (post.link as string) || '',
    title: (post.title as string) || '',
    author: post.author as string | undefined,
    pubDate: (post.pubDate as number) ?? null,
    description: post.description as string | undefined,
    image: post.image as string | undefined,
    blogId: post.blogId as string | undefined,
    blogTitle: post.blogTitle as string | undefined,
    blogIcon: post.blogIcon as string | undefined,
    blogFeedUrl: post.blogFeedUrl as string | undefined,
    savedAt: Date.now(),
    sizeBytes,
  }
  index.push(meta)
  saveIndex()

  console.log(`[SavedPosts] Saved: "${meta.title}" (${id}, ${sizeBytes} bytes)`)
  return { success: true }
}

/** Check if a post is saved by GUID. */
export function isPostSaved(guid: string): boolean {
  return loadIndex().some(p => p.guid === guid)
}

/** Delete a saved post by GUID. */
export function deleteSavedPost(guid: string): boolean {
  const index = loadIndex()
  const idx = index.findIndex(p => p.guid === guid)
  if (idx === -1) return false

  const post = index[idx]
  try {
    fs.unlinkSync(path.join(getPostsDir(), `${post.id}.html`))
  } catch { /* file may not exist */ }

  index.splice(idx, 1)
  saveIndex()
  console.log(`[SavedPosts] Deleted: ${post.id}`)
  return true
}

/** Get count and total size of saved posts. */
export function getSavedPostsCount(): { count: number; totalSizeBytes: number } {
  const index = loadIndex()
  return {
    count: index.length,
    totalSizeBytes: index.reduce((sum, p) => sum + p.sizeBytes, 0),
  }
}

/** Get all saved post GUIDs. */
export function getAllSavedPostGuids(): string[] {
  return loadIndex().map(p => p.guid)
}

/** Get the full saved posts index with metadata. */
export function getSavedPostsIndex(): SavedPostMeta[] {
  return loadIndex()
}

/** Get the HTML content of a saved post by GUID. */
export function getSavedPostContent(guid: string): string | null {
  const index = loadIndex()
  const post = index.find(p => p.guid === guid)
  if (!post) return null

  const filePath = path.join(getPostsDir(), `${post.id}.html`)
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Re-extract a saved post's content via Readability.
 * Overwrites the existing HTML file.
 */
export async function reextractSavedPost(guid: string): Promise<{ success: boolean; error?: string }> {
  const index = loadIndex()
  const post = index.find(p => p.guid === guid)
  if (!post) return { success: false, error: 'Post not found' }
  if (!post.link) return { success: false, error: 'No link to re-extract from' }

  try {
    const extracted = await extractReadableContent(post.link)
    const sizeBytes = writeHtmlFile(post.id, extracted.htmlContent)
    post.sizeBytes = sizeBytes
    saveIndex()
    console.log(`[SavedPosts] Re-extracted: ${post.id} (${sizeBytes} bytes)`)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Save an arbitrary URL as a post by fetching + extracting via Readability.
 */
export async function saveByUrl(url: string): Promise<{
  success: boolean
  post?: { guid: string; title: string; domain: string }
  error?: string
}> {
  const guid = guidToId(url)
  const id = guidToId(guid)
  const index = loadIndex()

  // Already saved?
  if (index.some(p => p.guid === guid)) {
    const domain = new URL(url).hostname
    return { success: true, post: { guid, title: 'Already saved', domain } }
  }

  try {
    const extracted = await extractReadableContent(url)
    const domain = new URL(url).hostname
    const title = extracted.title || domain

    evictOldest()

    const sizeBytes = writeHtmlFile(id, extracted.htmlContent)

    const meta: SavedPostMeta = {
      id,
      guid,
      link: url,
      title,
      author: extracted.byline || undefined,
      pubDate: extracted.publishedDate ?? null,
      description: extracted.description || extracted.excerpt || undefined,
      image: extracted.image || undefined,
      savedAt: Date.now(),
      sizeBytes,
      domain,
      saveSource: 'url',
    }
    index.push(meta)
    saveIndex()

    console.log(`[SavedPosts] Saved URL: "${title}" from ${domain} (${id}, ${sizeBytes} bytes)`)
    return { success: true, post: { guid, title, domain } }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
