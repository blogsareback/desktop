import { app } from 'electron'
import { readJsonFile, writeJsonFile } from './storage'

const ANALYTICS_FILE = 'analytics.json'

export type OperationType = 'feedFetch' | 'pageFetch' | 'readableText' | 'readableHtml' | 'ttsSynthesize'
export type ErrorCategory = 'network' | 'timeout' | 'server' | 'client' | 'validation'

interface DayStats {
  date: string // YYYY-MM-DD
  totalOperations: number
  successCount: number
  errorCount: number
  operationBreakdown: Record<OperationType, number>
  errorsByCategory: Record<ErrorCategory, number>
}

interface AnalyticsStore {
  firstUseAt: number
  days: DayStats[]
  lifetime: {
    totalOperations: number
    successCount: number
    errorCount: number
    operationBreakdown: Record<OperationType, number>
  }
}

/** Summary returned by getAnalyticsSummary(), matching the extension's format for web app compatibility. */
export interface AnalyticsSummary {
  extensionVersion: string
  last7Days: PeriodSummary
  last30Days: PeriodSummary
  lifetime: LifetimeSummary
  today: TodaySummary
}

interface PeriodSummary {
  totalOperations: number
  successRate: number
  operationBreakdown: Record<OperationType, number>
  errorsByCategory: Record<ErrorCategory, number>
  daysActive: number
}

interface LifetimeSummary {
  firstUseAt: number
  daysActive: number
  totalOperations: number
  successRate: number
  operationBreakdown: Record<OperationType, number>
}

interface TodaySummary {
  totalOperations: number
  successCount: number
  errorCount: number
  operationBreakdown: Record<OperationType, number>
}

const EMPTY_OP_BREAKDOWN: Record<OperationType, number> = {
  feedFetch: 0,
  pageFetch: 0,
  readableText: 0,
  readableHtml: 0,
  ttsSynthesize: 0,
}

const EMPTY_ERR_BREAKDOWN: Record<ErrorCategory, number> = {
  network: 0,
  timeout: 0,
  server: 0,
  client: 0,
  validation: 0,
}

const DEFAULT_STORE: AnalyticsStore = {
  firstUseAt: Date.now(),
  days: [],
  lifetime: {
    totalOperations: 0,
    successCount: 0,
    errorCount: 0,
    operationBreakdown: { ...EMPTY_OP_BREAKDOWN },
  },
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function getOrCreateDay(store: AnalyticsStore): DayStats {
  const key = todayKey()
  let day = store.days.find(d => d.date === key)
  if (!day) {
    day = {
      date: key,
      totalOperations: 0,
      successCount: 0,
      errorCount: 0,
      operationBreakdown: { ...EMPTY_OP_BREAKDOWN },
      errorsByCategory: { ...EMPTY_ERR_BREAKDOWN },
    }
    store.days.push(day)
    // Keep only 30 days of history
    if (store.days.length > 30) {
      store.days = store.days.slice(-30)
    }
  }
  return day
}

/** Track a single operation. Call after feed/page/extraction completes. */
export function trackOperation(type: OperationType, succeeded: boolean, errorCategory?: ErrorCategory): void {
  const store = readJsonFile<AnalyticsStore>(ANALYTICS_FILE, { ...DEFAULT_STORE, firstUseAt: Date.now() })

  const day = getOrCreateDay(store)
  day.totalOperations++
  day.operationBreakdown[type]++
  if (succeeded) {
    day.successCount++
  } else {
    day.errorCount++
    if (errorCategory) day.errorsByCategory[errorCategory]++
  }

  store.lifetime.totalOperations++
  store.lifetime.operationBreakdown[type]++
  if (succeeded) {
    store.lifetime.successCount++
  } else {
    store.lifetime.errorCount++
  }

  writeJsonFile(ANALYTICS_FILE, store)
}

/** Categorize an error for analytics. */
export function categorizeError(err: unknown, status?: number): ErrorCategory {
  if (status) {
    if (status >= 500) return 'server'
    if (status >= 400) return 'client'
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    if (msg.includes('timeout') || msg.includes('abort')) return 'timeout'
    if (msg.includes('blocked') || msg.includes('not allowed')) return 'validation'
  }
  return 'network'
}

/**
 * Build the analytics summary matching the extension's ExtensionAnalyticsSummary format.
 * The web app's analytics sync hook parses this shape, so it must stay compatible.
 */
export function getAnalyticsSummary(): AnalyticsSummary {
  const store = readJsonFile<AnalyticsStore>(ANALYTICS_FILE, DEFAULT_STORE)
  const now = Date.now()
  const days = store.days

  const last7 = days.filter(d => {
    const daysAgo = (now - new Date(d.date).getTime()) / (24 * 60 * 60 * 1000)
    return daysAgo <= 7
  })

  const last30 = days.filter(d => {
    const daysAgo = (now - new Date(d.date).getTime()) / (24 * 60 * 60 * 1000)
    return daysAgo <= 30
  })

  const today = days.find(d => d.date === todayKey())

  function aggregatePeriod(periodDays: DayStats[]): PeriodSummary {
    const total = periodDays.reduce((s, d) => s + d.totalOperations, 0)
    const successTotal = periodDays.reduce((s, d) => s + d.successCount, 0)
    const ops: Record<OperationType, number> = { ...EMPTY_OP_BREAKDOWN }
    const errs: Record<ErrorCategory, number> = { ...EMPTY_ERR_BREAKDOWN }
    for (const d of periodDays) {
      for (const k of Object.keys(ops) as OperationType[]) {
        ops[k] += d.operationBreakdown[k] || 0
      }
      for (const k of Object.keys(errs) as ErrorCategory[]) {
        errs[k] += d.errorsByCategory[k] || 0
      }
    }
    return {
      totalOperations: total,
      successRate: total > 0 ? successTotal / total : 1,
      operationBreakdown: ops,
      errorsByCategory: errs,
      daysActive: periodDays.length,
    }
  }

  const lt = store.lifetime
  const lifetimeTotal = lt.totalOperations
  const lifetimeSuccess = lt.successCount

  return {
    extensionVersion: app.getVersion(),
    last7Days: aggregatePeriod(last7),
    last30Days: aggregatePeriod(last30),
    lifetime: {
      firstUseAt: store.firstUseAt,
      daysActive: days.length,
      totalOperations: lifetimeTotal,
      successRate: lifetimeTotal > 0 ? lifetimeSuccess / lifetimeTotal : 1,
      operationBreakdown: lt.operationBreakdown,
    },
    today: today
      ? {
          totalOperations: today.totalOperations,
          successCount: today.successCount,
          errorCount: today.errorCount,
          operationBreakdown: today.operationBreakdown,
        }
      : {
          totalOperations: 0,
          successCount: 0,
          errorCount: 0,
          operationBreakdown: { ...EMPTY_OP_BREAKDOWN },
        },
  }
}
