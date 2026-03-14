import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import * as path from 'path'
import { getDesktopSettings, setDesktopSettings } from './desktop-settings'

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null

const isMac = process.platform === 'darwin'
const assetsDir = path.join(__dirname, '..', '..', 'assets', 'tray')

function getTrayIcon(monochrome: boolean): Electron.NativeImage {
  if (isMac) {
    const name = monochrome ? 'iconTemplate' : 'iconColor'
    const icon = nativeImage.createFromPath(path.join(assetsDir, `${name}.png`))
    if (monochrome) {
      icon.setTemplateImage(true)
    }
    return icon
  }
  return nativeImage.createFromPath(path.join(assetsDir, 'icon.png'))
}

function buildContextMenu(): Electron.Menu {
  const settings = getDesktopSettings()

  return Menu.buildFromTemplate([
    {
      label: 'Show / Hide',
      click: () => {
        if (mainWindow?.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow?.show()
          mainWindow?.focus()
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Refresh Feeds',
      click: () => {
        mainWindow?.webContents.send('menu-action', 'refresh-feeds')
        if (!mainWindow?.isVisible()) {
          mainWindow?.show()
          mainWindow?.focus()
        }
      },
    },
    { type: 'separator' },
    ...(isMac
      ? [
          {
            label: 'Monochrome Icon',
            type: 'checkbox' as const,
            checked: settings.monochromeMenuBarIcon,
            click: (menuItem: Electron.MenuItem) => {
              const monochrome = menuItem.checked
              setDesktopSettings({ monochromeMenuBarIcon: monochrome })
              if (tray && !tray.isDestroyed()) {
                tray.setImage(getTrayIcon(monochrome))
              }
            },
          },
          { type: 'separator' as const },
        ]
      : []),
    {
      label: 'Quit',
      click: () => {
        app.quit()
      },
    },
  ])
}

export function createTray(window: BrowserWindow): Tray {
  mainWindow = window
  const settings = getDesktopSettings()
  const icon = getTrayIcon(settings.monochromeMenuBarIcon)

  tray = new Tray(icon)
  tray.setToolTip('Blogs Are Back')
  tray.setContextMenu(buildContextMenu())

  if (!isMac) {
    tray.on('click', () => {
      if (mainWindow?.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow?.show()
        mainWindow?.focus()
      }
    })
  }

  return tray
}

export function updateTrayTooltip(text: string): void {
  if (tray && !tray.isDestroyed()) {
    tray.setToolTip(text)
  }
}
