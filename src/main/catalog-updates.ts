import { readJsonFile, writeJsonFile } from './storage'
import { getSyncData } from './sync-service'

const DIRECTORY_FILE = 'directory-updates.json'
const COMMUNITY_FILE = 'community-updates.json'
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

const APP_ORIGIN = process.env.BAB_URL || 'https://www.blogsareback.com'
const SNAPSHOT_URL = `${APP_ORIGIN}/api/catalog/snapshot`

export interface CatalogSourceUpdatesState {
  status: 'idle' | 'checking' | 'success' | 'error' | 'disabled'
  isEnabled: boolean
  updatedCount: number
  followedCount: number
  totalBlogs: number
  lastCheckedAt: number | null
  nextCheckAt: number | null
  sinceTimestamp: number | null
  syncStatus: 'synced' | 'unsynced'
  updatedBlogs: Array<{ id: string; title: string }>
}

const DEFAULT_STATE: CatalogSourceUpdatesState = {
  status: 'idle',
  isEnabled: true,
  updatedCount: 0,
  followedCount: 0,
  totalBlogs: 0,
  lastCheckedAt: null,
  nextCheckAt: null,
  sinceTimestamp: null,
  syncStatus: 'unsynced',
  updatedBlogs: [],
}

interface SnapshotResponse {
  directory: { blog_last_post_dates: Record<string, string>; total_blogs: number }
  community: { blog_last_post_dates: Record<string, string>; total_blogs: number }
}

let lastSnapshotFetch = 0
let cachedSnapshot: SnapshotResponse | null = null

async function fetchSnapshot(): Promise<SnapshotResponse | null> {
  // Respect 15-minute cache TTL
  if (cachedSnapshot && Date.now() - lastSnapshotFetch < CACHE_TTL_MS) {
    return cachedSnapshot
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    const response = await fetch(SNAPSHOT_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BlogsAreBack-Desktop/0.1.0' },
    })
    clearTimeout(timeout)

    if (!response.ok) return null
    cachedSnapshot = (await response.json()) as SnapshotResponse
    lastSnapshotFetch = Date.now()
    return cachedSnapshot
  } catch (err) {
    console.error('[CatalogUpdates] Failed to fetch snapshot:', err)
    return null
  }
}

/**
 * Check for new posts from directory + community catalog blogs.
 * Compares API snapshot dates against user's lastVisit.
 */
export async function checkCatalogUpdates(): Promise<{
  directory: CatalogSourceUpdatesState
  community: CatalogSourceUpdatesState
}> {
  const syncData = getSyncData()
  const dirState = readJsonFile<CatalogSourceUpdatesState>(DIRECTORY_FILE, { ...DEFAULT_STATE })
  const comState = readJsonFile<CatalogSourceUpdatesState>(COMMUNITY_FILE, { ...DEFAULT_STATE })

  if (syncData.directoryBlogs.length === 0 && syncData.communityBlogs.length === 0) {
    dirState.syncStatus = 'unsynced'
    comState.syncStatus = 'unsynced'
    writeJsonFile(DIRECTORY_FILE, dirState)
    writeJsonFile(COMMUNITY_FILE, comState)
    return { directory: dirState, community: comState }
  }

  dirState.status = 'checking'
  comState.status = 'checking'

  const snapshot = await fetchSnapshot()
  if (!snapshot) {
    dirState.status = 'error'
    comState.status = 'error'
    writeJsonFile(DIRECTORY_FILE, dirState)
    writeJsonFile(COMMUNITY_FILE, comState)
    return { directory: dirState, community: comState }
  }

  const sinceTimestamp = syncData.lastVisit
  const now = Date.now()

  // Directory blogs
  const dirFollowed = syncData.directoryBlogs
  const dirUpdated: Array<{ id: string; title: string }> = []
  for (const blog of dirFollowed) {
    const dateStr = snapshot.directory.blog_last_post_dates[blog.id]
    if (dateStr && sinceTimestamp) {
      const postDate = new Date(dateStr).getTime()
      if (postDate > sinceTimestamp) {
        dirUpdated.push({ id: blog.id, title: blog.title })
      }
    }
  }

  dirState.status = 'success'
  dirState.isEnabled = true
  dirState.updatedCount = dirUpdated.length
  dirState.followedCount = dirFollowed.length
  dirState.totalBlogs = snapshot.directory.total_blogs || 0
  dirState.lastCheckedAt = now
  dirState.nextCheckAt = now + 10 * 60 * 1000
  dirState.sinceTimestamp = sinceTimestamp
  dirState.syncStatus = 'synced'
  dirState.updatedBlogs = dirUpdated

  // Community blogs
  const comFollowed = syncData.communityBlogs
  const comUpdated: Array<{ id: string; title: string }> = []
  for (const blog of comFollowed) {
    const dateStr = snapshot.community.blog_last_post_dates[blog.id]
    if (dateStr && sinceTimestamp) {
      const postDate = new Date(dateStr).getTime()
      if (postDate > sinceTimestamp) {
        comUpdated.push({ id: blog.id, title: blog.title })
      }
    }
  }

  comState.status = 'success'
  comState.isEnabled = true
  comState.updatedCount = comUpdated.length
  comState.followedCount = comFollowed.length
  comState.totalBlogs = snapshot.community.total_blogs || 0
  comState.lastCheckedAt = now
  comState.nextCheckAt = now + 10 * 60 * 1000
  comState.sinceTimestamp = sinceTimestamp
  comState.syncStatus = 'synced'
  comState.updatedBlogs = comUpdated

  writeJsonFile(DIRECTORY_FILE, dirState)
  writeJsonFile(COMMUNITY_FILE, comState)

  console.log(
    `[CatalogUpdates] Directory: ${dirUpdated.length}/${dirFollowed.length} updated, ` +
    `Community: ${comUpdated.length}/${comFollowed.length} updated`
  )

  return { directory: dirState, community: comState }
}

export function getDirectoryState(): CatalogSourceUpdatesState {
  return readJsonFile<CatalogSourceUpdatesState>(DIRECTORY_FILE, { ...DEFAULT_STATE })
}

export function getCommunityState(): CatalogSourceUpdatesState {
  return readJsonFile<CatalogSourceUpdatesState>(COMMUNITY_FILE, { ...DEFAULT_STATE })
}

/** Reset updated counts and blogs (after acknowledgement). */
export function acknowledgeDirectoryUpdates(): void {
  const state = getDirectoryState()
  state.updatedCount = 0
  state.updatedBlogs = []
  writeJsonFile(DIRECTORY_FILE, state)
}

export function acknowledgeCommunityUpdates(): void {
  const state = getCommunityState()
  state.updatedCount = 0
  state.updatedBlogs = []
  writeJsonFile(COMMUNITY_FILE, state)
}
