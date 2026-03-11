import { app } from 'electron'
import { handleSyncAllBlogs, handleSyncFollowedBlogs } from '../sync-service'
import { triggerImmediateCheck } from '../update-monitor'
import { getDirectoryState, getCommunityState, acknowledgeDirectoryUpdates, acknowledgeCommunityUpdates } from '../catalog-updates'
import { getCustomBlogState, acknowledgeCustomBlogUpdates } from '../custom-blog-updates'
import { resetNotificationCounts } from '../notifications'
import { getAnalyticsSummary } from '../analytics'
import { getEngagement } from '../engagement'
import type { HandlerMap } from './types'

export const syncHandlers: HandlerMap = {
  SYNC_ALL_BLOGS: (message) => {
    const result = handleSyncAllBlogs(message)
    // Trigger background update check after fresh sync
    triggerImmediateCheck().catch(() => {})
    return { type: 'SYNC_RESPONSE', requestId: message.requestId, success: result.success }
  },

  SYNC_FOLLOWED_BLOGS: (message) => {
    const result = handleSyncFollowedBlogs(message)
    return { type: 'SYNC_RESPONSE', requestId: message.requestId, success: result.success }
  },

  GET_ANALYTICS: (message) => {
    return {
      type: 'ANALYTICS_RESPONSE',
      requestId: message.requestId,
      success: true,
      data: getAnalyticsSummary(),
      engagement: getEngagement(),
    }
  },

  GET_UPDATE_STATE: (message) => {
    const dirState = getDirectoryState()
    const comState = getCommunityState()
    const customState = getCustomBlogState()

    const totalUpdatedCount =
      dirState.updatedCount + comState.updatedCount + customState.updatedCount

    return {
      type: 'UPDATE_STATE_RESPONSE',
      requestId: message.requestId,
      success: true,
      data: {
        directory: {
          updatedCount: dirState.updatedCount,
          followedCount: dirState.followedCount,
          lastCheckedAt: dirState.lastCheckedAt,
          isEnabled: dirState.isEnabled,
          status: dirState.status,
        },
        community: {
          updatedCount: comState.updatedCount,
          followedCount: comState.followedCount,
          lastCheckedAt: comState.lastCheckedAt,
          isEnabled: comState.isEnabled,
          status: comState.status,
        },
        custom: {
          updatedCount: customState.updatedCount,
          totalCount: customState.totalCount,
          lastCheckedAt: customState.lastCheckedAt,
          blogs: customState.blogs.map(b => ({
            feedUrl: b.feedUrl,
            title: b.title,
            hasUpdates: b.hasUpdates,
          })),
        },
        mode: 'featured' as const,
        totalUpdatedCount,
      },
    }
  },

  ACKNOWLEDGE_UPDATES: (message) => {
    const sources = (message.sources as string[] | undefined) || ['directory', 'community', 'custom']
    let acknowledgedCount = 0

    if (sources.includes('directory')) {
      acknowledgedCount += getDirectoryState().updatedCount
      acknowledgeDirectoryUpdates()
    }
    if (sources.includes('community')) {
      acknowledgedCount += getCommunityState().updatedCount
      acknowledgeCommunityUpdates()
    }
    if (sources.includes('custom')) {
      acknowledgedCount += getCustomBlogState().updatedCount
      acknowledgeCustomBlogUpdates()
    }

    resetNotificationCounts()

    // Clear dock badge
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setBadge('')
    }

    return {
      type: 'ACKNOWLEDGE_UPDATES_RESPONSE',
      requestId: message.requestId,
      success: true,
      acknowledgedCount,
    }
  },
}
