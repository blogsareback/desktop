import * as fs from 'fs'
import * as path from 'path'
import { app, BrowserWindow, Notification } from 'electron'
import { getDesktopSettings, setDesktopSettings, type DesktopSettings } from '../desktop-settings'
import { getNetworkStatus } from '../network-status'
import { checkForUpdates, installUpdate } from '../auto-updater'
import { restartUpdateMonitor } from '../update-monitor'
import { updateTrayTooltip } from '../tray'
import type { HandlerMap } from './types'
import { success, failure } from './types'

// Offline readiness state (set by the web app's service worker)
let offlineReady = false
let hasNotifiedOfflineReady = false

export const desktopHandlers: HandlerMap = {
  SET_UNREAD_COUNT: (message) => {
    const count = (message.count as number) || 0
    if (process.platform === 'darwin' && app.dock) {
      if (getDesktopSettings().showBadge) {
        app.dock.setBadge(count > 0 ? String(count) : '')
      } else {
        app.dock.setBadge('')
      }
    }
    return success(message.requestId, 'SET_UNREAD_COUNT_RESPONSE', { count })
  },

  GET_NETWORK_STATUS: (message) => {
    return success(message.requestId, 'NETWORK_STATUS_RESPONSE', {
      status: getNetworkStatus(),
    })
  },

  RETRY_DASHBOARD: (message, event) => {
    const APP_ORIGIN = process.env.BAB_URL || 'https://www.blogsareback.com'
    const dashboardUrl = `${APP_ORIGIN}/dashboard`
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      console.log('[IPC] Retrying dashboard load:', dashboardUrl)
      win.loadURL(dashboardUrl).catch((err) => {
        console.error('[IPC] Dashboard retry failed:', err.message)
      })
    }
    return success(message.requestId, 'RETRY_DASHBOARD_RESPONSE', null)
  },

  CHECK_FOR_UPDATES: (message) => {
    checkForUpdates()
    return success(message.requestId, 'CHECK_FOR_UPDATES_RESPONSE', null)
  },

  INSTALL_UPDATE: (message) => {
    installUpdate()
    return success(message.requestId, 'INSTALL_UPDATE_RESPONSE', null)
  },

  READ_FILE: (message) => {
    const { requestId } = message
    const filePath = message.filePath as string
    if (!filePath) {
      return failure(requestId, 'READ_FILE_RESPONSE', 'No file path provided')
    }
    // Security: only allow reading files the user explicitly chose
    // (the file path comes from dialog.showOpenDialog in the menu)
    const resolved = path.resolve(filePath)
    const ext = path.extname(resolved).toLowerCase()
    const allowed = ['.opml', '.xml', '.txt', '.json']
    if (!allowed.includes(ext)) {
      return failure(requestId, 'READ_FILE_RESPONSE', `File type not allowed: ${ext}`)
    }
    const data = fs.readFileSync(resolved, 'utf-8')
    return success(requestId, 'READ_FILE_RESPONSE', data)
  },

  GET_DESKTOP_SETTINGS: (message) => {
    return success(message.requestId, 'DESKTOP_SETTINGS_RESPONSE', getDesktopSettings())
  },

  SET_DESKTOP_SETTINGS: (message) => {
    const partial = message as Partial<DesktopSettings> & Record<string, unknown>
    const { type: _t, requestId: _r, ...settingsPayload } = partial
    const prev = getDesktopSettings()
    const updated = setDesktopSettings(settingsPayload as Partial<DesktopSettings>)

    // Apply side effects
    if (prev.backgroundUpdatesEnabled !== updated.backgroundUpdatesEnabled) {
      restartUpdateMonitor()
    }
    if (!updated.showBadge && process.platform === 'darwin' && app.dock) {
      app.dock.setBadge('')
    }
    if (prev.launchAtLogin !== updated.launchAtLogin) {
      app.setLoginItemSettings({ openAtLogin: updated.launchAtLogin })
    }

    return success(message.requestId, 'DESKTOP_SETTINGS_RESPONSE', updated)
  },

  SET_OFFLINE_READINESS: (message) => {
    const { requestId } = message
    const ready = message.ready as boolean
    const categories = message.categories as Record<string, string> | undefined
    const wasReady = offlineReady
    offlineReady = ready

    // Update tray tooltip
    if (ready) {
      updateTrayTooltip('Blogs Are Back — Offline Ready')
    } else {
      const pending: string[] = []
      if (categories) {
        for (const [key, status] of Object.entries(categories)) {
          if (status === 'pending') pending.push(key)
        }
      }
      updateTrayTooltip(
        pending.length
          ? `Blogs Are Back — Loading: ${pending.join(', ')}`
          : 'Blogs Are Back'
      )
    }

    // One-time notification on first ready
    if (ready && !wasReady && !hasNotifiedOfflineReady) {
      hasNotifiedOfflineReady = true
      if (Notification.isSupported()) {
        new Notification({
          title: 'Blogs Are Back',
          body: 'Offline mode is ready.',
          silent: true,
        }).show()
      }
    }

    return success(requestId, 'SET_OFFLINE_READINESS_RESPONSE', { ready })
  },
}
