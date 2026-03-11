import { readJsonFile, writeJsonFile } from './storage'

const SYNC_FILE = 'sync-data.json'

export interface SyncData {
  directoryBlogs: Array<{ id: string; title: string; feedUrl?: string; lastPostDate?: number }>
  communityBlogs: Array<{ id: string; title: string; feedUrl?: string; lastPostDate?: number }>
  customBlogs: Array<{ feedUrl: string; title: string; lastPostDate: number | null }>
  followedFeedUrls: string[]
  lastVisit: number | null
  lastSyncAt: number
}

const DEFAULT_SYNC: SyncData = {
  directoryBlogs: [],
  communityBlogs: [],
  customBlogs: [],
  followedFeedUrls: [],
  lastVisit: null,
  lastSyncAt: 0,
}

/**
 * Handle the full SYNC_ALL_BLOGS message from the web app.
 * Persists all followed blog data for use by the update monitor.
 */
export function handleSyncAllBlogs(message: Record<string, unknown>): { success: boolean } {
  const data: SyncData = {
    directoryBlogs: (message.directoryBlogs as SyncData['directoryBlogs']) || [],
    communityBlogs: (message.communityBlogs as SyncData['communityBlogs']) || [],
    customBlogs: (message.customBlogs as SyncData['customBlogs']) || [],
    followedFeedUrls: (message.followedFeedUrls as string[]) || [],
    lastVisit: (message.lastVisit as number) ?? null,
    lastSyncAt: Date.now(),
  }
  writeJsonFile(SYNC_FILE, data)
  console.log(
    `[Sync] Saved: ${data.directoryBlogs.length} directory, ` +
    `${data.communityBlogs.length} community, ` +
    `${data.customBlogs.length} custom blogs`
  )
  return { success: true }
}

/**
 * Handle legacy SYNC_FOLLOWED_BLOGS message.
 * Only carries directory blog IDs and lastVisit.
 */
export function handleSyncFollowedBlogs(message: Record<string, unknown>): { success: boolean } {
  const existing = getSyncData()
  const blogIds = (message.blogIds as string[]) || []
  const lastVisit = (message.lastVisit as number) ?? existing.lastVisit

  // Update directory blogs from IDs (keep existing titles if available)
  const existingById = new Map(existing.directoryBlogs.map(b => [b.id, b]))
  existing.directoryBlogs = blogIds.map(id => existingById.get(id) || { id, title: '' })
  existing.lastVisit = lastVisit
  existing.lastSyncAt = Date.now()

  writeJsonFile(SYNC_FILE, existing)
  console.log(`[Sync] Legacy sync: ${blogIds.length} directory blogs`)
  return { success: true }
}

/** Read current sync state from disk. */
export function getSyncData(): SyncData {
  return readJsonFile<SyncData>(SYNC_FILE, DEFAULT_SYNC)
}
