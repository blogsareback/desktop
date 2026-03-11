import {
  savePostOffline, isPostSaved, deleteSavedPost,
  getSavedPostsCount, getAllSavedPostGuids, reextractSavedPost,
  getSavedPostsIndex, getSavedPostContent, saveByUrl,
} from '../saved-posts'
import { getSyncData } from '../sync-service'
import { trackEngagement } from '../engagement'
import type { HandlerMap } from './types'
import { success, failure } from './types'

export const savedPostHandlers: HandlerMap = {
  SAVE_POST_OFFLINE: async (message) => {
    const result = await savePostOffline(message)
    if (result.success && !result.alreadySaved) trackEngagement('postsSaved')
    return {
      type: 'SAVE_POST_OFFLINE_RESPONSE',
      requestId: message.requestId,
      success: result.success,
      alreadySaved: result.alreadySaved,
      error: result.error,
    }
  },

  IS_POST_SAVED: (message) => {
    const guid = message.guid as string
    return {
      type: 'IS_POST_SAVED_RESPONSE',
      requestId: message.requestId,
      success: true,
      isSaved: isPostSaved(guid),
    }
  },

  DELETE_SAVED_POST: (message) => {
    const guid = message.guid as string
    deleteSavedPost(guid)
    return {
      type: 'DELETE_SAVED_POST_RESPONSE',
      requestId: message.requestId,
      success: true,
    }
  },

  GET_SAVED_POSTS_COUNT: (message) => {
    const counts = getSavedPostsCount()
    return {
      type: 'SAVED_POSTS_COUNT_RESPONSE',
      requestId: message.requestId,
      success: true,
      count: counts.count,
      totalSizeBytes: counts.totalSizeBytes,
    }
  },

  REEXTRACT_SAVED_POST: async (message) => {
    const guid = message.guid as string
    const result = await reextractSavedPost(guid)
    return {
      type: 'REEXTRACT_SAVED_POST_RESPONSE',
      requestId: message.requestId,
      success: result.success,
      error: result.error,
    }
  },

  GET_ALL_SAVED_POST_GUIDS: (message) => {
    return {
      type: 'ALL_SAVED_POST_GUIDS_RESPONSE',
      requestId: message.requestId,
      success: true,
      guids: getAllSavedPostGuids(),
    }
  },

  GET_SAVED_POSTS_INDEX: (message) => {
    return success(message.requestId, 'SAVED_POSTS_INDEX_RESPONSE', getSavedPostsIndex())
  },

  GET_SAVED_POST_CONTENT: (message) => {
    const guid = message.guid as string
    const content = getSavedPostContent(guid)
    if (content === null) {
      return failure(message.requestId, 'SAVED_POST_CONTENT_RESPONSE', 'Post not found')
    }
    return success(message.requestId, 'SAVED_POST_CONTENT_RESPONSE', content)
  },

  SAVE_BY_URL: async (message) => {
    const url = message.url as string
    const result = await saveByUrl(url)
    if (result.success) trackEngagement('postsSavedByUrl')
    return {
      type: 'SAVE_BY_URL_RESPONSE',
      requestId: message.requestId,
      success: result.success,
      post: result.post,
      error: result.error,
    }
  },

  GET_SYNC_DATA: (message) => {
    return success(message.requestId, 'SYNC_DATA_RESPONSE', getSyncData())
  },
}
