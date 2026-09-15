/**
 * Aura vNext — Electron main process entry.
 */

import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import * as path from 'path'
import { AuraBackend } from './ipc'

let mainWindow: BrowserWindow | null = null
let backend: AuraBackend | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 620,
    frame: false,
    backgroundColor: '#07070b',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    ...(process.platform === 'win32' ? { backgroundMaterial: 'mica' as const } : {}),
    ...(process.platform === 'darwin' ? { vibrancy: 'under-window' as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  })

  if (!app.isPackaged && process.env.AURA_LOAD_BUILT !== '1') {
    void mainWindow.loadURL('http://localhost:5174')
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  // External links open in the system browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    backend?.dispose()
    mainWindow = null
  })
}

app.whenReady().then(() => {
  backend = new AuraBackend(() => mainWindow)
  backend.register()
  createWindow()

  // Kick off model discovery in the background so the picker fills fast.
  void backend.refreshAll()

  nativeTheme.themeSource = 'dark'

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  backend?.dispose()
})

// ─── Window controls ──────────────────────────────────────────────────────────

ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.handle('window:close', () => mainWindow?.close())
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)
