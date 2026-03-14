import { readJsonFile, writeJsonFile } from './storage'

const FILENAME = 'desktop-settings.json'

export interface DesktopSettings {
  showBadge: boolean
  notificationsEnabled: boolean
  backgroundUpdatesEnabled: boolean
  minimizeToTray: boolean
  autoUpdatesEnabled: boolean
  monochromeMenuBarIcon: boolean
  launchAtLogin: boolean
  startMinimized: boolean
  showReleaseBadge: boolean
}

export const DEFAULT_SETTINGS: DesktopSettings = {
  showBadge: true,
  notificationsEnabled: true,
  backgroundUpdatesEnabled: true,
  minimizeToTray: true,
  autoUpdatesEnabled: true,
  monochromeMenuBarIcon: process.platform === 'darwin',
  launchAtLogin: false,
  startMinimized: false,
  showReleaseBadge: true,
}

export function getDesktopSettings(): DesktopSettings {
  return readJsonFile<DesktopSettings>(FILENAME, DEFAULT_SETTINGS)
}

export function setDesktopSettings(partial: Partial<DesktopSettings>): DesktopSettings {
  const current = getDesktopSettings()
  const updated = { ...current, ...partial }
  writeJsonFile(FILENAME, updated)
  return updated
}
