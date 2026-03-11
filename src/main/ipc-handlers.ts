import { app, ipcMain } from 'electron'
import { feedHandlers } from './ipc/feed-handlers'
import { contentHandlers } from './ipc/content-handlers'
import { savedPostHandlers } from './ipc/saved-post-handlers'
import { ttsHandlers } from './ipc/tts-handlers'
import { desktopHandlers } from './ipc/desktop-handlers'
import { syncHandlers } from './ipc/sync-handlers'
import type { HandlerMap, IpcMessage } from './ipc/types'
import { failure } from './ipc/types'

const allHandlers: HandlerMap = {
  ...feedHandlers,
  ...contentHandlers,
  ...savedPostHandlers,
  ...ttsHandlers,
  ...desktopHandlers,
  ...syncHandlers,
}

// Build response type mapping from registered handlers
const responseTypeMap: Record<string, string> = {}
for (const type of Object.keys(allHandlers)) {
  // Convention: request type -> response type
  // Most follow TYPE -> TYPE_RESPONSE, but some have custom mappings
  const customMappings: Record<string, string> = {
    FETCH_FEED: 'FEED_RESPONSE',
    FETCH_FEEDS_BATCH: 'FEEDS_BATCH_RESPONSE',
    FETCH_PAGE: 'PAGE_RESPONSE',
    EXTRACT_READABLE_TEXT: 'READABLE_TEXT_RESPONSE',
    EXTRACT_READABLE_HTML: 'READABLE_HTML_RESPONSE',
    SYNC_ALL_BLOGS: 'SYNC_RESPONSE',
    SYNC_FOLLOWED_BLOGS: 'SYNC_RESPONSE',
    GET_NETWORK_STATUS: 'NETWORK_STATUS_RESPONSE',
    GET_ANALYTICS: 'ANALYTICS_RESPONSE',
    GET_UPDATE_STATE: 'UPDATE_STATE_RESPONSE',
    GET_SAVED_POSTS_COUNT: 'SAVED_POSTS_COUNT_RESPONSE',
    GET_ALL_SAVED_POST_GUIDS: 'ALL_SAVED_POST_GUIDS_RESPONSE',
    GET_SYNC_DATA: 'SYNC_DATA_RESPONSE',
    GET_DESKTOP_SETTINGS: 'DESKTOP_SETTINGS_RESPONSE',
    SET_DESKTOP_SETTINGS: 'DESKTOP_SETTINGS_RESPONSE',
  }
  responseTypeMap[type] = customMappings[type] || `${type}_RESPONSE`
}

/**
 * Register all IPC handlers for the electron bridge.
 *
 * Each handler matches a message type from the extension bridge protocol.
 * The response shapes match what the extension returns so the web app's
 * existing parsing code works unchanged.
 */
export function registerIpcHandlers(): void {
  // Sync handler so the preload script can read the version from package.json
  ipcMain.on('get-app-version', (event) => {
    event.returnValue = app.getVersion()
  })

  ipcMain.handle('electron-bridge', async (_event, message: Record<string, unknown>) => {
    const { type, requestId } = message as IpcMessage
    console.log(`[IPC] → ${type}`, requestId?.slice(0, 8))

    const handler = allHandlers[type]
    if (!handler) {
      console.log(`[IPC] Unhandled message type: ${type}`)
      return failure(requestId, 'UNKNOWN_RESPONSE', `Unknown message type: ${type}`)
    }

    try {
      return await handler(message as IpcMessage, _event)
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[IPC] Error handling ${type}:`, errorMessage)
      const responseType = responseTypeMap[type] || `${type}_RESPONSE`
      return failure(requestId, responseType, errorMessage)
    }
  })
}
