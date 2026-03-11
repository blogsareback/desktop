import { app, BrowserWindow, Menu, MenuItemConstructorOptions, shell } from 'electron'

const isMac = process.platform === 'darwin'

export function setupMenu(mainWindow: BrowserWindow): void {
  const template: MenuItemConstructorOptions[] = [
    // macOS app menu
    ...(isMac
      ? [
        {
          label: 'Blogs Are Back',
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            {
              label: 'Preferences…',
              accelerator: 'Cmd+,',
              click: () => mainWindow.webContents.send('menu-action', 'open-settings'),
            },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        } satisfies MenuItemConstructorOptions,
      ]
      : []),

    // File
    {
      label: 'File',
      submenu: [
        {
          label: 'Refresh All Feeds',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => mainWindow.webContents.send('menu-action', 'refresh-feeds'),
        },
        { type: 'separator' },
        {
          label: 'Save Article by URL…',
          accelerator: 'CmdOrCtrl+D',
          click: () => mainWindow.webContents.send('menu-action', 'save-article'),
        },
        { type: 'separator' },
        {
          label: 'Import OPML…',
          click: () => mainWindow.webContents.send('menu-action', 'import-opml'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },

    // Edit
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },

    // View
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Window
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
            { type: 'separator' as const },
            { role: 'front' as const },
          ]
          : [{ role: 'close' as const }]),
      ],
    },

    // Help
    {
      label: 'Help',
      submenu: [
        {
          label: 'Blogs Are Back Website',
          click: () => shell.openExternal('https://www.blogsareback.com'),
        },
        {
          label: 'Report an Issue',
          click: () => shell.openExternal('https://github.com/blogsareback/desktop/issues'),
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
