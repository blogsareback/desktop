import { app, BrowserWindow, screen } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

interface WindowState {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

const stateFile = path.join(app.getPath('userData'), 'window-state.json')

function readState(): WindowState | undefined {
  try {
    const raw = fs.readFileSync(stateFile, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function writeState(state: WindowState): void {
  try {
    fs.writeFileSync(stateFile, JSON.stringify(state), 'utf-8')
  } catch {
    // Ignore write errors (e.g. read-only filesystem)
  }
}

/**
 * Returns saved window bounds if they fit within a currently connected display.
 */
export function loadWindowState(): Partial<WindowState> | undefined {
  const state = readState()
  if (!state) return undefined

  // Validate the saved position is within a visible display
  const bounds = { x: state.x, y: state.y, width: state.width, height: state.height }
  const display = screen.getDisplayMatching(bounds)
  const { workArea } = display

  // Check if the window would be at least partially visible
  const visible =
    bounds.x + bounds.width > workArea.x &&
    bounds.x < workArea.x + workArea.width &&
    bounds.y + bounds.height > workArea.y &&
    bounds.y < workArea.y + workArea.height

  if (!visible) return undefined

  return state
}

/**
 * Attaches a listener to save window bounds on close.
 */
export function trackWindowState(win: BrowserWindow): void {
  win.on('close', () => {
    const isMaximized = win.isMaximized()
    const bounds = win.getNormalBounds()

    writeState({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized,
    })
  })
}
