import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

let dataDir: string | null = null

/** Returns userData/data/, creating it on first call. */
export function getDataDir(): string {
  if (dataDir) return dataDir
  dataDir = path.join(app.getPath('userData'), 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  return dataDir
}

/** Sync read + JSON.parse, returns defaultValue on any error. */
export function readJsonFile<T>(filename: string, defaultValue: T): T {
  try {
    const filePath = path.join(getDataDir(), filename)
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return defaultValue
  }
}

/** Atomic write: write to .tmp then rename. */
export function writeJsonFile<T>(filename: string, data: T): void {
  try {
    const filePath = path.join(getDataDir(), filename)
    const tmpPath = filePath + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    console.error(`[Storage] Failed to write ${filename}:`, err)
  }
}
