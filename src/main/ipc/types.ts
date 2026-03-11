import type { IpcMainInvokeEvent } from 'electron'

export interface IpcMessage {
  type: string
  requestId: string
  [key: string]: unknown
}

export interface BridgeResponse {
  type: string
  requestId: string
  success: boolean
  data?: unknown
  error?: string
  status?: number
  [key: string]: unknown
}

export type IpcHandler = (
  message: IpcMessage,
  event: IpcMainInvokeEvent
) => Promise<BridgeResponse> | BridgeResponse

export type HandlerMap = Record<string, IpcHandler>

export function success(requestId: string, type: string, data: unknown): BridgeResponse {
  return { type, requestId, success: true, data }
}

export function failure(requestId: string, type: string, error: string, status?: number): BridgeResponse {
  return { type, requestId, success: false, error, status }
}
