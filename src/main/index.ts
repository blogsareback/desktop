// Only load dotenv in development — it's not bundled in the packaged app
try { require('dotenv/config') } catch {}
import { initSentry, setSentryUser } from './sentry'

// Initialize Sentry before anything else so it captures all errors
initSentry()

import { app, BrowserWindow, shell } from 'electron'
import * as path from 'path'
import { registerIpcHandlers } from './ipc-handlers'
import { loadWindowState, trackWindowState } from './window-state'
import { setupMenu } from './app-menu'
import { createTray } from './tray'
import { handleDeepLink } from './deep-link'
import { setupAutoUpdater } from './auto-updater'
import { startUpdateMonitor, stopUpdateMonitor } from './update-monitor'
import { getDesktopSettings } from './desktop-settings'
import { startNetworkMonitor, stopNetworkMonitor } from './network-status'
import { startTelemetry, stopTelemetry, setTelemetryWindow } from './telemetry'
import { trackWindowFocus, installCrashHandlers } from './session-tracker'
import { getReleaseChannel } from './release-channel'

const APP_ORIGIN = process.env.BAB_URL || 'https://www.blogsareback.com'
const APP_URL = `${APP_ORIGIN}/dashboard`
const IS_DEV = !app.isPackaged
const PROTOCOL = 'blogsareback'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

// --- Deep link: register protocol before ready ---
if (!IS_DEV) {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

// --- Single instance lock (Windows/Linux deep link support) ---
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // On Windows/Linux, the deep link URL is passed as the last argument
    const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))
    if (url && mainWindow) {
      handleDeepLink(mainWindow, url)
    } else if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
    }
  })
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const savedState = loadWindowState()

  mainWindow = new BrowserWindow({
    width: savedState?.width ?? 1280,
    height: savedState?.height ?? 860,
    x: savedState?.x,
    y: savedState?.y,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0f0f0f',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  })

  if (savedState?.isMaximized) {
    mainWindow.maximize()
  }

  // Track window bounds for next launch
  trackWindowState(mainWindow)

  // Set up native app menu
  setupMenu(mainWindow)

  // Set up system tray
  createTray(mainWindow)

  // Show window when ready to avoid flash (unless starting minimized to tray)
  mainWindow.once('ready-to-show', () => {
    if (getDesktopSettings().startMinimized) {
      // Stay hidden — tray icon is available to show the window
      return
    }
    mainWindow?.show()
  })

  // Hide to tray instead of quitting (unless disabled in settings)
  mainWindow.on('close', (event) => {
    if (!isQuitting && getDesktopSettings().minimizeToTray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // macOS: inject drag regions so the frameless title bar area is draggable
  if (isMac) {
    const titleBarCSS = `
      /* Sidebar header — the "Blogs Are Back" bar */
      [data-sidebar="header"] {
        -webkit-app-region: drag;
      }

      /* All interactive elements inside drag regions stay clickable */
      [data-sidebar="header"] button,
      [data-sidebar="header"] a,
      [data-sidebar="header"] input,
      [data-sidebar="header"] [role="button"],
      [data-sidebar="header"] [role="menuitem"] {
        -webkit-app-region: no-drag;
      }
    `
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow?.webContents.insertCSS(titleBarCSS)
    })
  }

  // Inject release channel badge (ALPHA/BETA/DEV ribbon)
  const channel = getReleaseChannel()
  if (channel && getDesktopSettings().showReleaseBadge) {
    const badgeCSS = `
      #bab-release-badge {
        position: fixed;
        bottom: 32px;
        right: -40px;
        z-index: 99999;
        width: 160px;
        text-align: center;
        padding: 4px 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        background-color: ${channel.backgroundColor};
        color: ${channel.textColor};
        transform: rotate(-45deg);
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        pointer-events: none;
        opacity: 0.85;
        user-select: none;
      }
    `
    const badgeJS = `
      if (!document.getElementById('bab-release-badge')) {
        const el = document.createElement('div');
        el.id = 'bab-release-badge';
        el.textContent = ${JSON.stringify(channel.label)};
        document.body.appendChild(el);
      }
    `
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow?.webContents.insertCSS(badgeCSS)
      mainWindow?.webContents.executeJavaScript(badgeJS)
    })
  }

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_ORIGIN)) {
      return { action: 'allow' }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Intercept navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow app URL, localhost (dev), and file:// (loading screen)
    if (
      url.startsWith(APP_ORIGIN) ||
      url.startsWith('http://localhost') ||
      url.startsWith('file://')
    ) {
      return
    }
    event.preventDefault()
    shell.openExternal(url)
  })

  // Load loading screen first, then navigate to the real app
  // const appUrl = APP_URL
  // const appUrl = IS_DEV ? 'http://localhost:3000/dashboard' : APP_URL
  const appUrl = APP_URL
  const loadingPath = path.join(__dirname, '..', '..', 'assets', 'loading.html')
  const offlinePath = path.join(__dirname, '..', '..', 'assets', 'offline.html')

  mainWindow.loadFile(loadingPath).then(() => {
    console.log('[Main] Loading screen shown, navigating to:', appUrl)
    return mainWindow?.loadURL(appUrl)
  }).catch((err) => {
    console.error('[Main] Failed to load app URL:', err)
    // Show offline shell if the web app can't be reached
    console.log('[Main] Loading offline fallback')
    mainWindow?.loadFile(offlinePath).catch(() => {
      // Last resort: try direct load
      mainWindow?.loadURL(appUrl)
    })
  })

  // Also handle load failures that happen after the initial load attempt
  // (e.g., ERR_INTERNET_DISCONNECTED, ERR_NAME_NOT_RESOLVED)
  //
  // SW coexistence: Once the service worker is installed, it intercepts all
  // fetch requests (including navigations) and serves cached responses when
  // offline. This means did-fail-load becomes dormant — the SW always responds
  // to navigation requests, so Chromium never fires a load failure. This handler
  // remains valuable as a first-visit fallback before the SW can register, and
  // as a safety net if the SW is ever unregistered.
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    // Ignore aborted loads (e.g., navigating away before page finishes)
    if (errorCode === -3) return
    // Only intercept failures for the app URL, not for the offline page itself
    if (validatedURL && (validatedURL.startsWith(APP_ORIGIN) || validatedURL.startsWith('http://localhost'))) {
      console.log(`[Main] Page load failed (${errorCode}: ${errorDescription}), showing offline fallback`)
      mainWindow?.loadFile(offlinePath)
    }
  })

  // Auto-updater (only in packaged builds)
  if (!IS_DEV) {
    setupAutoUpdater(mainWindow)
  }

  // Start background update monitor
  startUpdateMonitor(mainWindow)

  // Start network status monitor
  startNetworkMonitor(mainWindow)

  // Track window focus/blur for telemetry
  trackWindowFocus(mainWindow)

  // Start telemetry (launch heartbeat + 24h interval)
  setTelemetryWindow(mainWindow)
  startTelemetry()

  // Link Sentry errors to the telemetry installation ID
  setSentryUser()

  // Open DevTools in dev mode
  if (IS_DEV) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

// Install crash handlers early (before anything else can throw)
installCrashHandlers()

// Register IPC handlers before window creation
registerIpcHandlers()

// Allow real quit via Cmd+Q / tray Quit
app.on('before-quit', () => {
  isQuitting = true
  stopUpdateMonitor()
  stopNetworkMonitor()
  stopTelemetry()
})

// Keep app alive when window is hidden to tray
app.on('window-all-closed', () => {
  // Don't quit — tray keeps the app alive
})

// macOS: Recreate/show window on dock click
app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  } else if (!mainWindow.isVisible()) {
    mainWindow.show()
    mainWindow.focus()
  }
})

// macOS: deep link handler
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (mainWindow) {
    handleDeepLink(mainWindow, url)
  }
})

app.whenReady().then(() => {
  // Sync login item state with saved setting
  const settings = getDesktopSettings()
  if (!IS_DEV) {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
  }

  createWindow()
})
