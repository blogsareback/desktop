import { BrowserWindow } from 'electron'
import * as Sentry from '@sentry/electron/main'

const sessionStartedAt = Date.now()
let focusStartedAt: number | null = null
let accumulatedFocusMs = 0
let crashCount = 0

/** Start tracking window focus/blur for focus duration. */
export function trackWindowFocus(window: BrowserWindow): void {
  // If window starts focused, begin tracking immediately
  if (window.isFocused()) {
    focusStartedAt = Date.now()
  }

  window.on('focus', () => {
    focusStartedAt = Date.now()
  })

  window.on('blur', () => {
    if (focusStartedAt) {
      accumulatedFocusMs += Date.now() - focusStartedAt
      focusStartedAt = null
    }
  })
}

/** Install global error handlers that count crashes. */
export function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    crashCount++
    console.error('[CrashHandler] Uncaught exception:', err)
    Sentry.captureException(err)
  })

  process.on('unhandledRejection', (reason) => {
    crashCount++
    console.error('[CrashHandler] Unhandled rejection:', reason)
    Sentry.captureException(reason)
  })
}

/** Get session metrics for telemetry. */
export function getSessionMetrics(): {
  sessionDurationMs: number
  focusDurationMs: number
  crashCount: number
  memoryUsageMb: number
} {
  // Include current focus period if window is focused right now
  let totalFocus = accumulatedFocusMs
  if (focusStartedAt) {
    totalFocus += Date.now() - focusStartedAt
  }

  return {
    sessionDurationMs: Date.now() - sessionStartedAt,
    focusDurationMs: totalFocus,
    crashCount,
    memoryUsageMb: Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 100) / 100,
  }
}
