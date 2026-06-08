const { app, BrowserWindow, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const net = require('net')

// Single instance
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit(); process.exit(0) }

const APP_NAME = 'AudioSFX'

// Data directory: %APPDATA%/AudioSFX/data (writable; install dir is read-only).
const DATA_DIR = path.join(app.getPath('userData'), 'data')

// ffmpeg / ffprobe binaries. Packaged builds copy them to resources/ via
// extraResources; dev uses the static npm packages. The backend runs in THIS
// process (require below), so these env vars are visible to it — server/index.ts
// calls fluent-ffmpeg setFfmpegPath/setFfprobePath from them.
const exe = (n) => (process.platform === 'win32' ? `${n}.exe` : n)
process.env.FFMPEG_PATH = app.isPackaged
  ? path.join(process.resourcesPath, exe('ffmpeg'))
  : require('ffmpeg-static')
process.env.FFPROBE_PATH = app.isPackaged
  ? path.join(process.resourcesPath, exe('ffprobe'))
  : require('ffprobe-static').path

// Bundled CC0 SFX library (Kenney.nl). Packaged → resources/sfx-library (copied
// via extraResources); dev → server/core/sfxLibrary.ts falls back to the repo's
// assets/sfx-library. server/core/sfxLibrary.getLibraryDir() reads this env.
process.env.SFX_LIBRARY_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'sfx-library')
  : path.join(__dirname, '..', 'assets', 'sfx-library')

// getDataDir() picks this up after the explicit VIDEO_ENGINE_DATA_DIR override
// (priority 1), so tests/CI can still inject their own dir.
process.env.ELECTRON_USER_DATA_DIR = DATA_DIR
process.env.NODE_ENV = 'production'

let PORT = null
let mainWindow = null
let backendReady = false

// Pick a free loopback port. AudioSFX never hardcodes 6300–6303 in the packaged
// app: Windows' WinNAT can reserve those ranges at boot (→ EACCES). Letting the
// OS assign port 0 sidesteps that entirely.
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function createWindow() {
  const iconPath = [
    path.join(__dirname, '..', 'icon', 'icon.ico'),
    path.join(__dirname, '..', 'icon', 'icon.png'),
  ].find(p => fs.existsSync(p))

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    icon: iconPath,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.loadURL(`http://localhost:${PORT}`)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (!app.isPackaged) mainWindow.webContents.openDevTools()
  })

  // External links open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

function startBackend() {
  // Backend is esbuild-bundled to dist/server/index.js; run it in-process.
  const serverEntry = path.join(__dirname, '..', 'dist', 'server', 'index.js')

  return new Promise((resolve, reject) => {
    try {
      fs.mkdirSync(path.join(DATA_DIR, 'projects'), { recursive: true })
      require(serverEntry)

      const http = require('http')
      let attempts = 0
      const check = () => {
        attempts++
        http.get(`http://localhost:${PORT}/api/health`, (res) => {
          if (res.statusCode === 200) { backendReady = true; resolve() }
          else if (attempts < 40) setTimeout(check, 200)
          else reject(new Error('Backend health check failed'))
        }).on('error', () => {
          if (attempts < 40) setTimeout(check, 200)
          else reject(new Error('Backend failed to start'))
        })
      }
      setTimeout(check, 400)
    } catch (err) {
      reject(err)
    }
  })
}

app.on('ready', async () => {
  try {
    PORT = await getFreePort()
    process.env.PORT = String(PORT)
    await startBackend()
    createWindow()
  } catch (err) {
    dialog.showErrorBox('啟動失敗', `${APP_NAME} 後端無法啟動：\n${err.message}`)
    app.quit()
  }
})

app.on('window-all-closed', () => { app.quit() })

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('activate', () => {
  if (mainWindow === null && backendReady) createWindow()
})
