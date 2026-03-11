import { Notification, BrowserWindow } from 'electron'
import { getDesktopSettings } from './desktop-settings'
import { trackEngagement } from './engagement'

let mainWindowRef: BrowserWindow | null = null
let lastDirectoryCount = 0
let lastCommunityCount = 0
let lastCustomCount = 0

export function setNotificationWindow(win: BrowserWindow): void {
  mainWindowRef = win
}

function showAndFocus(): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.show()
    mainWindowRef.focus()
  }
}

/**
 * Format a list of blog names for display in a notification body.
 * Shows up to `max` names, with "+N more" suffix if truncated.
 */
function formatBlogNames(blogs: Array<{ title: string }>, max = 3): string {
  if (blogs.length === 0) return ''
  const names = blogs.slice(0, max).map(b => b.title).filter(Boolean)
  if (names.length === 0) return ''
  const remaining = blogs.length - names.length
  const list = names.join(', ')
  return remaining > 0 ? `${list} +${remaining} more` : list
}

/**
 * Build and show a notification with action buttons.
 * On macOS, `actions` show as buttons in the notification.
 * On other platforms, clicking the notification itself opens the app.
 */
function showRichNotification(opts: {
  title: string
  body: string
  blogNames?: string
}): void {
  const notification = new Notification({
    title: opts.title,
    body: opts.body,
    subtitle: opts.blogNames || undefined,
    actions: [
      { type: 'button', text: 'Open' },
    ],
  })

  notification.on('click', () => {
    trackEngagement('notificationClicks')
    showAndFocus()
  })
  notification.on('action', (_event, index) => {
    if (index === 0) {
      trackEngagement('notificationClicks')
      showAndFocus()
    }
  })

  trackEngagement('notificationsShown')
  notification.show()
}

/**
 * Send a notification for catalog blog updates (directory + community combined).
 * Only fires when the count increases from the last notification.
 */
export function sendBlogUpdatesNotification(
  directoryCount: number,
  communityCount: number,
  updatedBlogs?: Array<{ id: string; title: string }>,
): void {
  const totalNew = directoryCount + communityCount
  const lastTotal = lastDirectoryCount + lastCommunityCount

  if (totalNew <= 0 || totalNew <= lastTotal) return
  if (!getDesktopSettings().notificationsEnabled) return

  lastDirectoryCount = directoryCount
  lastCommunityCount = communityCount

  const body = totalNew === 1
    ? '1 blog has a new post'
    : `${totalNew} blogs have new posts`

  const blogNames = updatedBlogs ? formatBlogNames(updatedBlogs) : undefined

  showRichNotification({ title: 'Blogs Are Back', body, blogNames })
}

/**
 * Send a notification for custom blog updates.
 * Only fires when the count increases from the last notification.
 */
export function sendCustomBlogNotification(
  updatedCount: number,
  totalCount: number,
  updatedBlogs?: Array<{ title: string }>,
): void {
  if (updatedCount <= 0 || updatedCount <= lastCustomCount) return
  if (!getDesktopSettings().notificationsEnabled) return

  lastCustomCount = updatedCount

  const body = updatedCount === 1
    ? `1 of your ${totalCount} blogs has a new post`
    : `${updatedCount} of your ${totalCount} blogs have new posts`

  const blogNames = updatedBlogs ? formatBlogNames(updatedBlogs) : undefined

  showRichNotification({ title: 'Blogs Are Back', body, blogNames })
}

/** Reset notification counters (e.g. after acknowledge). */
export function resetNotificationCounts(): void {
  lastDirectoryCount = 0
  lastCommunityCount = 0
  lastCustomCount = 0
}
