import { BrowserWindow } from 'electron'
import { checkCatalogUpdates } from './catalog-updates'
import { checkCustomBlogUpdates } from './custom-blog-updates'
import {
  setNotificationWindow,
  sendBlogUpdatesNotification,
  sendCustomBlogNotification,
} from './notifications'
import { getDesktopSettings } from './desktop-settings'
import { prefetchFollowedFeeds } from './feed-prefetch'

const CATALOG_INTERVAL_MS = 10 * 60 * 1000  // 10 minutes
const CUSTOM_INTERVAL_MS = 10 * 60 * 1000   // 10 minutes
const CUSTOM_OFFSET_MS = 5 * 60 * 1000      // offset by 5 minutes
const INITIAL_DELAY_MS = 15 * 1000           // 15 seconds after start

let catalogTimer: ReturnType<typeof setInterval> | null = null
let customTimer: ReturnType<typeof setInterval> | null = null
let initialTimer: ReturnType<typeof setTimeout> | null = null
let customOffsetTimer: ReturnType<typeof setTimeout> | null = null
let monitorWindow: BrowserWindow | null = null

async function runCatalogCheck(): Promise<void> {
  if (!getDesktopSettings().backgroundUpdatesEnabled) return
  try {
    const { directory, community } = await checkCatalogUpdates()
    const allUpdated = [...directory.updatedBlogs, ...community.updatedBlogs]
    sendBlogUpdatesNotification(directory.updatedCount, community.updatedCount, allUpdated)
  } catch (err) {
    console.error('[UpdateMonitor] Catalog check failed:', err)
  }
}

async function runCustomBlogCheck(): Promise<void> {
  if (!getDesktopSettings().backgroundUpdatesEnabled) return
  try {
    const state = await checkCustomBlogUpdates()
    const updatedBlogs = state.blogs.filter(b => b.hasUpdates)
    sendCustomBlogNotification(state.updatedCount, state.totalCount, updatedBlogs)
  } catch (err) {
    console.error('[UpdateMonitor] Custom blog check failed:', err)
  }
}

async function runFeedPrefetch(): Promise<void> {
  if (!getDesktopSettings().backgroundUpdatesEnabled) return
  try {
    await prefetchFollowedFeeds()
  } catch (err) {
    console.error('[UpdateMonitor] Feed prefetch failed:', err)
  }
}

/**
 * Start periodic update monitoring.
 * Called once after app is ready and window is created.
 */
export function startUpdateMonitor(mainWindow: BrowserWindow): void {
  monitorWindow = mainWindow
  setNotificationWindow(mainWindow)

  if (!getDesktopSettings().backgroundUpdatesEnabled) {
    console.log('[UpdateMonitor] Disabled by settings')
    return
  }

  // Initial check after short delay
  initialTimer = setTimeout(async () => {
    await runCatalogCheck()
    await runCustomBlogCheck()
    await runFeedPrefetch()
  }, INITIAL_DELAY_MS)

  // Periodic catalog checks + feed prefetch
  catalogTimer = setInterval(async () => {
    await runCatalogCheck()
    await runFeedPrefetch()
  }, CATALOG_INTERVAL_MS)

  // Periodic custom blog checks (offset by 5 minutes)
  customOffsetTimer = setTimeout(() => {
    customTimer = setInterval(runCustomBlogCheck, CUSTOM_INTERVAL_MS)
  }, CUSTOM_OFFSET_MS)

  console.log('[UpdateMonitor] Started')
}

/** Stop all timers. Called on app quit. */
export function stopUpdateMonitor(): void {
  if (initialTimer) clearTimeout(initialTimer)
  if (catalogTimer) clearInterval(catalogTimer)
  if (customTimer) clearInterval(customTimer)
  if (customOffsetTimer) clearTimeout(customOffsetTimer)
  initialTimer = null
  catalogTimer = null
  customTimer = null
  customOffsetTimer = null
  console.log('[UpdateMonitor] Stopped')
}

/** Restart the monitor (stop then conditionally start based on settings). */
export function restartUpdateMonitor(): void {
  stopUpdateMonitor()
  if (monitorWindow && !monitorWindow.isDestroyed()) {
    startUpdateMonitor(monitorWindow)
  }
}

/** Trigger an immediate check (e.g. after SYNC_ALL_BLOGS). */
export async function triggerImmediateCheck(): Promise<void> {
  await runCatalogCheck()
  await runCustomBlogCheck()
}
