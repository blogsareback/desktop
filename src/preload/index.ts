import { contextBridge, ipcRenderer } from 'electron'

/**
 * Preload script — exposes a minimal, type-safe bridge to the renderer.
 *
 * The renderer (web app) calls `window.electronBridge.invoke(type, payload)`
 * which maps to ipcRenderer.invoke('electron-bridge', { type, ...payload }).
 *
 * Detection flags:
 * - __BLOGS_ARE_BACK_DESKTOP__: true  → desktop-specific detection
 * - __BLOGS_ARE_BACK_EXTENSION__: true → makes all existing extension checks pass
 * - __BLOGS_ARE_BACK_EXTENSION_VERSION__: '99.0.0' → all feature gates pass
 */

// Expose the IPC bridge
contextBridge.exposeInMainWorld('electronBridge', {
  invoke: (type: string, payload?: Record<string, unknown>): Promise<unknown> => {
    return ipcRenderer.invoke('electron-bridge', { type, ...payload })
  },
  getAppVersion: (): string => {
    return ipcRenderer.sendSync('get-app-version')
  },
  platform: process.platform,
  onMenuAction: (callback: (action: string, ...args: unknown[]) => void): void => {
    ipcRenderer.on('menu-action', (_event, action: string, ...args: unknown[]) => {
      callback(action, ...args)
    })
  },
  onNetworkStatusChanged: (callback: (status: 'online' | 'offline') => void): void => {
    ipcRenderer.on('network-status-changed', (_event, status: 'online' | 'offline') => {
      callback(status)
    })
  },
})

// Set detection flags via contextBridge (these are simple primitives)
contextBridge.exposeInMainWorld('__BLOGS_ARE_BACK_DESKTOP__', true)
contextBridge.exposeInMainWorld('__BLOGS_ARE_BACK_EXTENSION__', true)
contextBridge.exposeInMainWorld('__BLOGS_ARE_BACK_EXTENSION_VERSION__', '99.0.0')
