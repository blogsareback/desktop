import { trackOperation, categorizeError } from './analytics'
import { trackEngagement } from './engagement'

// edge-tts-universal has CJS exports; use require for reliable resolution
// eslint-disable-next-line @typescript-eslint/no-var-requires
const edgeTts = require('edge-tts-universal')

// ---- Types ----

interface ProsodyOptions {
  rate?: string
  volume?: string
  pitch?: string
}

interface WordBoundary {
  offset: number
  duration: number
  text: string
}

interface SynthesisResult {
  audio: Blob
  subtitle: WordBoundary[]
}

export interface SynthesizeChunkResult {
  audioBase64: string
  subtitle: WordBoundary[]
}

export interface Voice {
  Name: string
  ShortName: string
  Gender: string
  Locale: string
  FriendlyName: string
}

// ---- Voice cache (24h in-memory) ----

let cachedVoices: Voice[] | null = null
let voicesCachedAt = 0
const VOICE_CACHE_TTL = 24 * 60 * 60 * 1000

export async function getVoices(): Promise<Voice[]> {
  if (cachedVoices && Date.now() - voicesCachedAt < VOICE_CACHE_TTL) {
    return cachedVoices
  }

  const voices: Voice[] = await edgeTts.listVoices()
  cachedVoices = voices
  voicesCachedAt = Date.now()
  return voices
}

// ---- Synthesis ----

export async function synthesizeChunk(
  text: string,
  voice: string,
  prosody?: ProsodyOptions
): Promise<SynthesizeChunkResult> {
  const startTime = Date.now()

  try {
    const tts = new edgeTts.EdgeTTS(text, voice, prosody || {})
    const result: SynthesisResult = await tts.synthesize()

    if (!result.audio) {
      throw new Error('No audio returned from EdgeTTS')
    }

    // Convert Blob to base64 for JSON-safe IPC transport
    const arrayBuffer = await result.audio.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    const elapsed = Date.now() - startTime
    console.log(`[TTS] Synthesized ${text.length} chars in ${elapsed}ms`)
    trackOperation('ttsSynthesize', true)
    trackEngagement('ttsGenerated')

    return {
      audioBase64: base64,
      subtitle: result.subtitle || [],
    }
  } catch (err) {
    trackOperation('ttsSynthesize', false, categorizeError(err))
    throw err
  }
}
