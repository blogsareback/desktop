/**
 * Release channel badge configuration.
 *
 * Change `RELEASE_CHANNEL` to control the badge shown in the app window.
 * Set to null to hide the badge entirely (e.g., for stable releases).
 */

export interface ReleaseChannelConfig {
  label: string
  backgroundColor: string
  textColor: string
}

const CHANNELS: Record<string, ReleaseChannelConfig> = {
  ALPHA: { label: 'ALPHA', backgroundColor: '#dc2626', textColor: '#fff' },
  BETA:  { label: 'BETA',  backgroundColor: '#f59e0b', textColor: '#000' },
  DEV:   { label: 'DEV',   backgroundColor: '#8b5cf6', textColor: '#fff' },
}

// ── Change this to switch the badge ──────────────────────────────
// Set to 'ALPHA' | 'BETA' | 'DEV' | null
const RELEASE_CHANNEL: string | null = 'BETA'
// ─────────────────────────────────────────────────────────────────

export function getReleaseChannel(): ReleaseChannelConfig | null {
  if (!RELEASE_CHANNEL) return null
  return CHANNELS[RELEASE_CHANNEL] ?? null
}
