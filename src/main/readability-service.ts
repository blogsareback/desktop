import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { safeFetch } from './fetch-service'

export interface ReadableResult {
  title: string
  textContent: string
  htmlContent: string
  excerpt: string | null
  byline: string | null
  image: string | null
  publishedDate: number | null
  description: string | null
}

/**
 * Fetch a URL and extract readable content using Mozilla Readability.
 * Returns both plain text and HTML versions.
 */
export async function extractReadableContent(url: string): Promise<ReadableResult> {
  const { data: html } = await safeFetch(url)
  return extractFromHtml(html, url)
}

/**
 * Extract readable content from raw HTML string.
 */
export function extractFromHtml(html: string, url: string): ReadableResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { document } = parseHTML(html) as any

  // Extract metadata before Readability modifies the DOM
  const image = extractImage(document)
  const publishedDate = extractPublishedDate(document)
  const metaDescription = extractDescription(document)

  // Set the document URL for Readability's relative URL resolution
  // linkedom doesn't have a proper baseURI, so we add a <base> tag
  const base = document.createElement('base')
  base.setAttribute('href', url)
  document.head.prepend(base)

  const reader = new Readability(document as unknown as Document)
  const article = reader.parse()

  if (!article) {
    throw new Error('Readability failed to extract content')
  }

  // Description: prefer meta tags, fall back to content excerpt
  const description = metaDescription || generateExcerpt(article.content || '')

  return {
    title: article.title || '',
    textContent: article.textContent || '',
    htmlContent: article.content || '',
    excerpt: article.excerpt || null,
    byline: article.byline || null,
    image,
    publishedDate,
    description,
  }
}

/**
 * Extract published date from HTML meta tags and structured data.
 * Checks common sources in priority order:
 * 1. article:published_time (Open Graph)
 * 2. datePublished in JSON-LD (schema.org)
 * 3. Common meta name tags (date, DC.date, parsely-pub-date, etc.)
 * 4. <time> element with itemprop="datePublished"
 */
function extractPublishedDate(document: any): number | null {
  // 1. Open Graph article:published_time
  const ogDate = document.querySelector('meta[property="article:published_time"]')
  if (ogDate) {
    const ts = Date.parse(ogDate.getAttribute('content') || '')
    if (!isNaN(ts)) return ts
  }

  // 2. JSON-LD schema.org datePublished
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]')
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script.textContent || '')
      const dateStr = extractDateFromJsonLd(data)
      if (dateStr) {
        const ts = Date.parse(dateStr)
        if (!isNaN(ts)) return ts
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  // 3. Common meta tags (by name attribute)
  const metaNameCandidates = [
    'date', 'DC.date.issued', 'DC.date.created', 'DC.date', 'dcterms.date',
    'parsely-pub-date', 'sailthru.date', 'publish-date', 'pub_date',
  ]
  for (const name of metaNameCandidates) {
    const el = document.querySelector(`meta[name="${name}"]`)
    if (el) {
      const ts = Date.parse(el.getAttribute('content') || '')
      if (!isNaN(ts)) return ts
    }
  }

  // 4. <time> element with itemprop="datePublished"
  const timeEl = document.querySelector('time[itemprop="datePublished"]')
  if (timeEl) {
    const datetime = timeEl.getAttribute('datetime') || timeEl.textContent
    if (datetime) {
      const ts = Date.parse(datetime)
      if (!isNaN(ts)) return ts
    }
  }

  return null
}

/**
 * Recursively search JSON-LD data for datePublished.
 */
function extractDateFromJsonLd(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null

  if (Array.isArray(data)) {
    for (const item of data) {
      const result = extractDateFromJsonLd(item)
      if (result) return result
    }
    return null
  }

  const obj = data as Record<string, unknown>
  if (typeof obj.datePublished === 'string') return obj.datePublished

  // Check @graph array (common in WordPress, etc.)
  if (Array.isArray(obj['@graph'])) {
    return extractDateFromJsonLd(obj['@graph'])
  }

  return null
}

/**
 * Extract the best description from meta tags.
 * Checks og:description, then meta name="description", then twitter:description.
 */
function extractDescription(document: any): string | null {
  const ogDesc = document.querySelector('meta[property="og:description"]')
  if (ogDesc) {
    const content = ogDesc.getAttribute('content')?.trim()
    if (content) return content
  }

  const metaDesc = document.querySelector('meta[name="description"]')
  if (metaDesc) {
    const content = metaDesc.getAttribute('content')?.trim()
    if (content) return content
  }

  const twitterDesc = document.querySelector('meta[name="twitter:description"]')
  if (twitterDesc) {
    const content = twitterDesc.getAttribute('content')?.trim()
    if (content) return content
  }

  return null
}

/**
 * Generate a clean text excerpt from HTML content.
 * Strips tags, decodes entities, truncates at a word boundary.
 */
function generateExcerpt(html: string, maxLength: number = 200): string {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length <= maxLength) return text

  const truncated = text.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > maxLength * 0.5 ? truncated.substring(0, lastSpace) : truncated) + '…'
}

/**
 * Extract the best image from a page's meta tags.
 */
function extractImage(document: any): string | null {
  // Try og:image first
  const ogImage = document.querySelector('meta[property="og:image"]')
  if (ogImage) {
    const content = ogImage.getAttribute('content')
    if (content) return content
  }

  // Try twitter:image
  const twitterImage =
    document.querySelector('meta[name="twitter:image"]') ||
    document.querySelector('meta[property="twitter:image"]')
  if (twitterImage) {
    const content = twitterImage.getAttribute('content')
    if (content) return content
  }

  return null
}
