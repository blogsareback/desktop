import * as fs from 'fs'
import * as path from 'path'
import { app, dialog, BrowserWindow } from 'electron'
import { synthesizeChunk, getVoices } from '../tts-service'
import type { HandlerMap } from './types'
import { success, failure } from './types'

export const ttsHandlers: HandlerMap = {
  TTS_SYNTHESIZE_CHUNK: async (message) => {
    const text = message.text as string
    const voice = message.voice as string
    if (!text || !voice) {
      return failure(message.requestId, 'TTS_SYNTHESIZE_CHUNK_RESPONSE', 'Missing text or voice')
    }

    const prosody: Record<string, string> = {}
    if (message.rate) prosody.rate = message.rate as string
    if (message.pitch) prosody.pitch = message.pitch as string
    if (message.volume) prosody.volume = message.volume as string

    const result = await synthesizeChunk(text, voice, prosody)
    return success(message.requestId, 'TTS_SYNTHESIZE_CHUNK_RESPONSE', result)
  },

  TTS_GET_VOICES: async (message) => {
    const voices = await getVoices()
    return success(message.requestId, 'TTS_GET_VOICES_RESPONSE', voices)
  },

  TTS_SAVE_AUDIO: async (message) => {
    const { requestId } = message
    const audioBase64 = message.audioBase64 as string
    if (!audioBase64) {
      return failure(requestId, 'TTS_SAVE_AUDIO_RESPONSE', 'No audio data provided')
    }

    const title = (message.title as string) || 'narration'
    const safeName = title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
    const defaultPath = path.join(app.getPath('downloads'), `${safeName}.mp3`)

    const win = BrowserWindow.getFocusedWindow()
    const dialogResult = await dialog.showSaveDialog(win || ({} as any), {
      title: 'Save Audio',
      defaultPath,
      filters: [{ name: 'MP3 Audio', extensions: ['mp3'] }],
    })

    if (dialogResult.canceled || !dialogResult.filePath) {
      return success(requestId, 'TTS_SAVE_AUDIO_RESPONSE', { saved: false })
    }

    const audioBuffer = Buffer.from(audioBase64, 'base64')
    fs.writeFileSync(dialogResult.filePath, audioBuffer)
    console.log(`[TTS] Saved audio to ${dialogResult.filePath}`)
    return success(requestId, 'TTS_SAVE_AUDIO_RESPONSE', {
      saved: true,
      filePath: dialogResult.filePath,
    })
  },
}
