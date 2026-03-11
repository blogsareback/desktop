import { URL } from 'url'
import * as dns from 'dns/promises'
import * as net from 'net'

const USER_AGENT = 'BlogsAreBack-Desktop/0.1.0'
const FETCH_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024 // 5MB

/**
 * Private/reserved IP ranges that should be blocked (SSRF protection)
 */
const PRIVATE_RANGES = [
  // IPv4
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' }, // Link-local
  { start: '0.0.0.0', end: '0.255.255.255' },
]

/**
 * Cloud metadata endpoints to block
 */
const BLOCKED_HOSTS = [
  'metadata.google.internal',
  '169.254.169.254', // AWS/GCP metadata
  'metadata.azure.com',
]

function ipToNumber(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
}

function isPrivateIP(ip: string): boolean {
  // IPv6 loopback
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return true

  // IPv4-mapped IPv6
  const v4Match = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  const v4 = v4Match ? v4Match[1] : ip

  if (!net.isIPv4(v4)) return false

  const num = ipToNumber(v4)
  return PRIVATE_RANGES.some(({ start, end }) => {
    const s = ipToNumber(start)
    const e = ipToNumber(end)
    return num >= s && num <= e
  })
}

/**
 * Validate a URL for SSRF safety
 */
async function validateUrl(urlString: string): Promise<void> {
  const url = new URL(urlString)

  // Must be http or https
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked protocol: ${url.protocol}`)
  }

  // Block known metadata hosts
  if (BLOCKED_HOSTS.includes(url.hostname)) {
    throw new Error(`Blocked host: ${url.hostname}`)
  }

  // Block direct IP access to private ranges
  if (net.isIP(url.hostname)) {
    if (isPrivateIP(url.hostname)) {
      throw new Error(`Blocked private IP: ${url.hostname}`)
    }
    return
  }

  // DNS resolution check — block if hostname resolves to private IP
  try {
    const addresses = await dns.resolve4(url.hostname)
    for (const addr of addresses) {
      if (isPrivateIP(addr)) {
        throw new Error(`Hostname ${url.hostname} resolves to private IP ${addr}`)
      }
    }
  } catch (err: unknown) {
    // If DNS resolution fails, let the fetch itself handle it
    if (err instanceof Error && err.message.startsWith('Blocked')) {
      throw err
    }
  }
}

export interface FetchResult {
  data: string
  status: number
  contentType?: string
  etag?: string
  lastModified?: string
}

/**
 * Fetch a URL with SSRF protection, timeout, and size limits.
 * Used by all IPC handlers for HTTP requests.
 */
export async function safeFetch(url: string): Promise<FetchResult> {
  await validateUrl(url)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
      },
      redirect: 'follow',
    })

    // Check final URL after redirects for SSRF
    if (response.url !== url) {
      await validateUrl(response.url)
    }

    const contentType = response.headers.get('content-type') || undefined
    const etag = response.headers.get('etag') || undefined
    const lastModified = response.headers.get('last-modified') || undefined

    // Check content length before reading
    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      throw new Error(`Response too large: ${contentLength} bytes (max ${MAX_RESPONSE_BYTES})`)
    }

    // Read response with size limit
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const chunks: Uint8Array[] = []
    let totalBytes = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      totalBytes += value.byteLength
      if (totalBytes > MAX_RESPONSE_BYTES) {
        reader.cancel()
        throw new Error(`Response exceeded ${MAX_RESPONSE_BYTES} bytes`)
      }

      chunks.push(value)
    }

    const decoder = new TextDecoder()
    const data = chunks.map((c) => decoder.decode(c, { stream: true })).join('') + decoder.decode()

    return {
      data,
      status: response.status,
      contentType,
      etag,
      lastModified,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export interface ConditionalHeaders {
  etag?: string
  lastModified?: string
}

export interface ConditionalFetchResult {
  data: string | null
  status: number
  contentType?: string
  etag?: string
  lastModified?: string
  notModified: boolean
}

/**
 * Fetch with conditional headers (If-None-Match / If-Modified-Since).
 * Returns notModified: true on 304 with null data.
 */
export async function safeFetchWithConditional(
  url: string,
  conditionalHeaders?: ConditionalHeaders
): Promise<ConditionalFetchResult> {
  await validateUrl(url)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept': '*/*',
    }
    if (conditionalHeaders?.etag) {
      headers['If-None-Match'] = conditionalHeaders.etag
    }
    if (conditionalHeaders?.lastModified) {
      headers['If-Modified-Since'] = conditionalHeaders.lastModified
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers,
      redirect: 'follow',
    })

    if (response.url !== url) {
      await validateUrl(response.url)
    }

    const contentType = response.headers.get('content-type') || undefined
    const etag = response.headers.get('etag') || undefined
    const lastModified = response.headers.get('last-modified') || undefined

    if (response.status === 304) {
      return { data: null, status: 304, contentType, etag, lastModified, notModified: true }
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      throw new Error(`Response too large: ${contentLength} bytes (max ${MAX_RESPONSE_BYTES})`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const chunks: Uint8Array[] = []
    let totalBytes = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_RESPONSE_BYTES) {
        reader.cancel()
        throw new Error(`Response exceeded ${MAX_RESPONSE_BYTES} bytes`)
      }
      chunks.push(value)
    }

    const decoder = new TextDecoder()
    const data = chunks.map((c) => decoder.decode(c, { stream: true })).join('') + decoder.decode()

    return { data, status: response.status, contentType, etag, lastModified, notModified: false }
  } finally {
    clearTimeout(timeout)
  }
}
