import { readJsonFile, writeJsonFile } from './storage'

const ENGAGEMENT_FILE = 'engagement.json'

export interface EngagementCounters {
  notificationsShown: number
  notificationClicks: number
  postsSaved: number
  postsSavedByUrl: number
  ttsGenerated: number
  deepLinksOpened: number
  feedsRefreshed: number
}

const DEFAULT_ENGAGEMENT: EngagementCounters = {
  notificationsShown: 0,
  notificationClicks: 0,
  postsSaved: 0,
  postsSavedByUrl: 0,
  ttsGenerated: 0,
  deepLinksOpened: 0,
  feedsRefreshed: 0,
}

/** Read engagement counters from disk. */
export function getEngagement(): EngagementCounters {
  const stored = readJsonFile<Partial<EngagementCounters>>(ENGAGEMENT_FILE, {})
  return { ...DEFAULT_ENGAGEMENT, ...stored }
}

/**
 * Increment a single engagement counter. Best-effort — never throws.
 *
 * @example
 * trackEngagement('postsSaved')
 * trackEngagement('notificationsShown')
 */
export function trackEngagement(counter: keyof EngagementCounters): void {
  try {
    const current = getEngagement()
    current[counter] += 1
    writeJsonFile(ENGAGEMENT_FILE, current)
  } catch (err) {
    console.warn('[Engagement] Failed to increment counter:', counter, err)
  }
}
