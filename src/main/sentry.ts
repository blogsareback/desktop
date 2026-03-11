import * as Sentry from '@sentry/electron/main'
import { app } from 'electron'
import { getInstallationId } from './telemetry'

const IS_DEV = !app.isPackaged
const SENTRY_DSN = process.env.SENTRY_DSN ||
  'https://4f61f4b39878e7506881100c155c8370@o4510609172987904.ingest.us.sentry.io/4511011481583616'

/**
 * Initialize Sentry for the main process.
 * Must be called as early as possible in the app lifecycle.
 */
export function initSentry(): void {
  Sentry.init({
    dsn: SENTRY_DSN,
    release: `blogsareback@${app.getVersion()}`,
    environment: IS_DEV ? 'development' : 'production',

    // Don't send events in dev
    beforeSend(event) {
      if (IS_DEV) return null
      return event
    },
  })

  console.log('[Sentry] Initialized', IS_DEV ? '(dev)' : '(production)')
}

/**
 * Set the Sentry user context to the installation ID.
 * Call this after telemetry has initialized so the ID is available.
 */
export function setSentryUser(): void {
  try {
    const installationId = getInstallationId()
    Sentry.setUser({ id: installationId })
    console.log('[Sentry] User context set')
  } catch {
    // telemetry not ready yet — not critical
  }
}
