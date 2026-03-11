import { BrowserWindow } from 'electron'

// electron-updater and electron-log are CJS modules
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require('electron-log') as typeof import('electron-log')

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours

export function setupAutoUpdater(mainWindow: BrowserWindow): void {
  // Route autoUpdater logs through electron-log
  autoUpdater.logger = log

  // Don't auto-install — let the user decide
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info: { version: string }) => {
    log.info(`Update available: ${info.version}`)
  })

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    log.info(`Update downloaded: ${info.version}`)
    mainWindow.webContents.send('menu-action', 'update-downloaded', info.version)
  })

  autoUpdater.on('error', (err: Error) => {
    log.error('Auto-update error:', err.message)
  })

  // Initial check after 10s delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      log.error('Update check failed:', err.message)
    })
  }, 10_000)

  // Periodic checks
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      log.error('Update check failed:', err.message)
    })
  }, CHECK_INTERVAL_MS)
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates()
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}
