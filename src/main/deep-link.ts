import { BrowserWindow } from 'electron'
import { trackEngagement } from './engagement'

export interface DeepLinkAction {
  action: string
  target: string
}

/**
 * Parse a blogsareback:// URL into an action and target.
 *
 * Supported routes:
 * - blogsareback://follow/<domain>
 * - blogsareback://post/<encoded-url>
 * - blogsareback://settings
 */
export function parseDeepLink(url: string): DeepLinkAction | null {
  try {
    // blogsareback://follow/example.com → action=follow, target=example.com
    const stripped = url.replace(/^blogsareback:\/\//, '')
    const slashIdx = stripped.indexOf('/')
    if (slashIdx === -1) {
      // No target, e.g. blogsareback://settings
      return { action: stripped, target: '' }
    }
    const action = stripped.slice(0, slashIdx)
    const target = stripped.slice(slashIdx + 1)
    return { action, target }
  } catch {
    return null
  }
}

/**
 * Handle a deep link URL by navigating the main window.
 */
export function handleDeepLink(mainWindow: BrowserWindow, url: string): void {
  const parsed = parseDeepLink(url)
  if (!parsed) return

  trackEngagement('deepLinksOpened')

  // Bring window to front
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()

  // Send to renderer for routing
  mainWindow.webContents.send('menu-action', 'deep-link', parsed.action, parsed.target)
}
