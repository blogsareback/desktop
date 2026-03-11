/**
 * Network status detection for offline mode.
 *
 * Uses Electron's net.isOnline() as the primary signal, with a periodic
 * lightweight ping to confirm real connectivity (net.isOnline only checks
 * for a network interface, not actual internet access).
 */

import { net, BrowserWindow } from 'electron'

const PING_INTERVAL_MS = 30_000 // 30 seconds
const PING_TIMEOUT_MS = 5_000
const PING_URL = 'https://www.blogsareback.com/api/health'

let currentStatus: 'online' | 'offline' = 'online'
let pingTimer: ReturnType<typeof setInterval> | null = null
let mainWindowRef: BrowserWindow | null = null

/** Get the current network status. */
export function getNetworkStatus(): 'online' | 'offline' {
  return currentStatus
}

/** Check connectivity with a lightweight fetch. */
async function pingCheck(): Promise<boolean> {
  // Quick check — if the OS reports no network, skip the ping
  if (!net.isOnline()) return false

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
    const response = await net.fetch(PING_URL, {
      method: 'HEAD',
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

function setStatus(status: 'online' | 'offline'): void {
  if (status === currentStatus) return

  const previous = currentStatus
  currentStatus = status
  console.log(`[Network] Status changed: ${previous} → ${status}`)

  // Push to renderer
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('network-status-changed', status)
  }
}

async function runCheck(): Promise<void> {
  const isOnline = await pingCheck()
  setStatus(isOnline ? 'online' : 'offline')
}

/** Start monitoring network status. Call once after window creation. */
export function startNetworkMonitor(win: BrowserWindow): void {
  mainWindowRef = win

  // Initialize from OS-level check
  currentStatus = net.isOnline() ? 'online' : 'offline'
  console.log(`[Network] Initial status: ${currentStatus}`)

  // Run an actual ping check shortly after startup
  setTimeout(() => runCheck(), 3_000)

  // Periodic connectivity checks
  pingTimer = setInterval(() => runCheck(), PING_INTERVAL_MS)
}

/** Stop the network monitor. */
export function stopNetworkMonitor(): void {
  if (pingTimer) {
    clearInterval(pingTimer)
    pingTimer = null
  }
  mainWindowRef = null
}
