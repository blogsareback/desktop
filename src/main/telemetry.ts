import { app, Notification, BrowserWindow } from 'electron'
import os from 'node:os'
import { readJsonFile, writeJsonFile } from './storage'
import { getAnalyticsSummary } from './analytics'
import { getEngagement } from './engagement'
import { getDesktopSettings, DEFAULT_SETTINGS, type DesktopSettings } from './desktop-settings'
import { getSyncData } from './sync-service'
import { getSavedPostsCount } from './saved-posts'
import { getSessionMetrics } from './session-tracker'
import { trackEngagement } from './engagement'

const TELEMETRY_FILE = 'telemetry.json'
const SEEN_ANNOUNCEMENTS_FILE = 'seen-announcements.json'
const TELEMETRY_API = 'https://www.blogsareback.com/api/analytics/desktop-telemetry'
const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

type HeartbeatReason = 'launch' | 'update' | 'interval'

interface Announcement {
  id: string
  title: string
  body: string
  actionUrl?: string
}

/** Server response from the telemetry endpoint. */
interface HeartbeatResponse {
  ok: boolean
  recorded?: boolean
  minVersion?: string | null
  announcements?: Announcement[]
  featureFlags?: Record<string, unknown>
}

/** Last response received from the server (available for other modules). */
let lastServerResponse: HeartbeatResponse | null = null

/** Reference to main window for announcement click-through. */
let mainWindowRef: BrowserWindow | null = null

interface TelemetryStore {
  installationId: string
  installedAt: number
  lastHeartbeatAt: number | null
}

interface SeenAnnouncementsStore {
  seenIds: string[]
}

const DEFAULT_STORE: TelemetryStore = {
  installationId: '',
  installedAt: Date.now(),
  lastHeartbeatAt: null,
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

/** Get or create a persistent installation ID. */
function getOrCreateInstallationId(): { id: string; isNew: boolean } {
  const store = readJsonFile<TelemetryStore>(TELEMETRY_FILE, { ...DEFAULT_STORE, installedAt: Date.now() })

  if (store.installationId) {
    return { id: store.installationId, isNew: false }
  }

  const id = crypto.randomUUID()
  store.installationId = id
  store.installedAt = Date.now()
  writeJsonFile(TELEMETRY_FILE, store)
  console.log('[Telemetry] Generated installation ID:', id)
  return { id, isNew: true }
}

/** Compute desktop settings that differ from defaults. */
function getCustomizations(): Partial<DesktopSettings> | undefined {
  const settings = getDesktopSettings()
  const customizations: Partial<DesktopSettings> = {}
  let hasCustomizations = false

  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof DesktopSettings>) {
    if (settings[key] !== DEFAULT_SETTINGS[key]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(customizations as Record<string, any>)[key] = settings[key]
      hasCustomizations = true
    }
  }

  return hasCustomizations ? customizations : undefined
}

/** Build the telemetry payload. */
function buildPayload(reason: HeartbeatReason, previousVersion?: string) {
  const { id: installationId } = getOrCreateInstallationId()
  const store = readJsonFile<TelemetryStore>(TELEMETRY_FILE, DEFAULT_STORE)
  const syncData = getSyncData()
  const savedPosts = getSavedPostsCount()

  return {
    installationId,
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    installedAt: store.installedAt,
    osVersion: os.release(),
    heartbeatReason: reason,
    ...(previousVersion && { previousVersion }),

    ...getSessionMetrics(),

    analytics: getAnalyticsSummary(),
    engagement: getEngagement(),
    customizations: getCustomizations(),

    features: {
      ...getDesktopSettings(),
      followedBlogCount: syncData.directoryBlogs.length + syncData.communityBlogs.length,
      customBlogCount: syncData.customBlogs.length,
      savedPostsCount: savedPosts.count,
    },
  }
}

/**
 * Send a telemetry heartbeat to the server.
 * Best-effort: failures are logged but never thrown.
 */
async function sendHeartbeat(reason: HeartbeatReason, previousVersion?: string): Promise<void> {
  try {
    const payload = buildPayload(reason, previousVersion)

    const response = await fetch(TELEMETRY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (response.ok) {
      try {
        const body = (await response.json()) as HeartbeatResponse
        lastServerResponse = body
        console.log('[Telemetry] Heartbeat sent successfully, recorded:', body.recorded)

        // Process server directives
        if (body.minVersion) {
          console.log('[Telemetry] Server minVersion:', body.minVersion)
        }
        if (body.announcements?.length) {
          console.log('[Telemetry] Server announcements:', body.announcements.length)
          processAnnouncements(body.announcements)
        }
        if (body.featureFlags && Object.keys(body.featureFlags).length > 0) {
          console.log('[Telemetry] Server feature flags:', Object.keys(body.featureFlags))
        }
      } catch {
        console.log('[Telemetry] Heartbeat sent successfully (no parseable response)')
      }
    } else {
      console.warn('[Telemetry] Heartbeat failed:', response.status)
    }

    // Record last heartbeat time regardless of success
    const store = readJsonFile<TelemetryStore>(TELEMETRY_FILE, DEFAULT_STORE)
    store.lastHeartbeatAt = Date.now()
    writeJsonFile(TELEMETRY_FILE, store)
  } catch (err) {
    console.warn('[Telemetry] Heartbeat error:', err)
  }
}

/**
 * Start the telemetry service.
 * Sends a launch heartbeat immediately, then every 24 hours.
 */
export function startTelemetry(): void {
  // Send launch heartbeat (delayed slightly to let the app finish starting)
  setTimeout(() => {
    sendHeartbeat('launch')
  }, 10_000)

  // Periodic heartbeat every 24 hours
  heartbeatTimer = setInterval(() => {
    sendHeartbeat('interval')
  }, HEARTBEAT_INTERVAL_MS)
}

/** Stop the telemetry service. */
export function stopTelemetry(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

/** Send an update heartbeat (call after app auto-update). */
export function sendUpdateHeartbeat(previousVersion: string): void {
  sendHeartbeat('update', previousVersion)
}

/** Set the main window reference for announcement click-through navigation. */
export function setTelemetryWindow(win: BrowserWindow): void {
  mainWindowRef = win
}

/**
 * Process announcements from the server response.
 * Shows native notifications for unseen announcements and tracks them.
 */
function processAnnouncements(announcements: Announcement[]): void {
  if (!getDesktopSettings().notificationsEnabled) return

  const store = readJsonFile<SeenAnnouncementsStore>(SEEN_ANNOUNCEMENTS_FILE, { seenIds: [] })
  const unseenAnnouncements = announcements.filter((a) => !store.seenIds.includes(a.id))

  if (unseenAnnouncements.length === 0) return

  // Show a notification for each unseen announcement
  for (const announcement of unseenAnnouncements) {
    showAnnouncementNotification(announcement)
    store.seenIds.push(announcement.id)
  }

  // Persist seen IDs (keep last 100 to avoid unbounded growth)
  store.seenIds = store.seenIds.slice(-100)
  writeJsonFile(SEEN_ANNOUNCEMENTS_FILE, store)
}

/** Show a native notification for a server announcement. */
function showAnnouncementNotification(announcement: Announcement): void {
  const notification = new Notification({
    title: announcement.title,
    body: announcement.body,
    actions: announcement.actionUrl
      ? [{ type: 'button', text: 'Open' }]
      : [],
  })

  notification.on('click', () => {
    trackEngagement('notificationClicks')
    handleAnnouncementAction(announcement)
  })

  notification.on('action', (_event, index) => {
    if (index === 0) {
      trackEngagement('notificationClicks')
      handleAnnouncementAction(announcement)
    }
  })

  trackEngagement('notificationsShown')
  notification.show()
}

/** Handle announcement click — navigate to action URL or just focus the window. */
function handleAnnouncementAction(announcement: Announcement): void {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return

  mainWindowRef.show()
  mainWindowRef.focus()

  if (announcement.actionUrl) {
    mainWindowRef.loadURL(announcement.actionUrl)
  }
}

/** Get the last server response from a heartbeat (for other modules to check directives). */
export function getLastServerResponse(): HeartbeatResponse | null {
  return lastServerResponse
}

/** Get the persistent installation ID (for other modules that need it). */
export function getInstallationId(): string {
  return getOrCreateInstallationId().id
}
