const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

// Ensure single instance
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit(); process.exit(0) }

// Data directory: %APPDATA%/13SoulMU  (portable: use app dir)
const DATA_DIR = path.join(app.getPath('userData'), 'data')

// Resolve ffmpeg binary: packaged app copies ffmpeg.exe to resources/ via extraResources
const ffmpegPath = app.isPackaged
  ? path.join(process.resourcesPath, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  : require('ffmpeg-static')
process.env.FFMPEG_PATH = ffmpegPath

// Backend config
const PORT = 6201
process.env.PORT = String(PORT)
// Use ELECTRON_USER_DATA_DIR so getDataDir() picks it up *after* the explicit
// VIDEO_ENGINE_DATA_DIR override (priority 1). Tests / CI can still inject
// their own data dir without colliding with packaged builds.
process.env.ELECTRON_USER_DATA_DIR = DATA_DIR
process.env.NODE_ENV = 'production'
process.env.AI_PROVIDER = 'api'

// One-time migration warning: packaged Electron used to read data/ from
// process.cwd() (= install dir). Anyone who upgrades after this change will
// suddenly see an "empty" app because data/ moved to userData/. Surface a
// dialog so they know where their old projects are and can move them.
if (app.isPackaged) {
  try {
    const legacyDir = path.join(process.cwd(), 'data', 'projects')
    const newDir = path.join(DATA_DIR, 'projects')
    if (fs.existsSync(legacyDir) && !fs.existsSync(newDir)) {
      const { dialog } = require('electron')
      dialog.showMessageBoxSync({
        type: 'info',
        buttons: ['OK'],
        title: '專案資料位置已變更',
        message: '13SoulMU 改用系統標準位置存放專案資料',
        detail: `舊位置：${legacyDir}\n新位置：${newDir}\n\n你的舊專案還在原處，沒有被刪除。要繼續使用請手動把整個 projects/ 資料夾複製到新位置。`,
      })
    }
  } catch { /* legacy probe is best-effort, never block startup */ }
}

// Templates: packaged mode seeds from bundled resources → writable userData
if (app.isPackaged) {
  const templatesDir = path.join(DATA_DIR, 'templates')
  process.env.VIDEO_ENGINE_TEMPLATES_DIR = templatesDir
  const bundled = path.join(process.resourcesPath, 'templates')
  if (fs.existsSync(bundled) && !fs.existsSync(templatesDir)) {
    fs.mkdirSync(templatesDir, { recursive: true })
    for (const f of fs.readdirSync(bundled)) {
      fs.copyFileSync(path.join(bundled, f), path.join(templatesDir, f))
    }
  }
}

let mainWindow = null
let backendReady = false

function createWindow() {
  // Icon path: works in both dev (repo root) and packaged (inside app.asar)
  const iconCandidates = [
    path.join(__dirname, '..', 'icon', 'icon.ico'),
    path.join(__dirname, '..', 'icon', 'icon.png'),
  ]
  const iconPath = iconCandidates.find(p => fs.existsSync(p))

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: '13SoulMU',
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

  // Load frontend from Express server (which serves dist/)
  mainWindow.loadURL(`http://localhost:${PORT}`)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (!app.isPackaged) mainWindow.webContents.openDevTools()
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

function startBackend() {
  // In packaged app, backend is compiled to dist/server/
  const serverEntry = path.join(__dirname, '..', 'dist', 'server', 'index.js')

  return new Promise((resolve, reject) => {
    // Set up the backend by requiring it directly (same process)
    try {
      // Ensure data directory exists
      fs.mkdirSync(DATA_DIR, { recursive: true })
      fs.mkdirSync(path.join(DATA_DIR, 'projects'), { recursive: true })

      require(serverEntry)

      // Wait for server to be ready
      const http = require('http')
      let attempts = 0
      const check = () => {
        attempts++
        http.get(`http://localhost:${PORT}/api/health`, (res) => {
          if (res.statusCode === 200) {
            backendReady = true
            resolve()
          } else if (attempts < 30) {
            setTimeout(check, 200)
          } else {
            reject(new Error('Backend health check failed'))
          }
        }).on('error', () => {
          if (attempts < 30) setTimeout(check, 200)
          else reject(new Error('Backend failed to start'))
        })
      }
      setTimeout(check, 500)
    } catch (err) {
      reject(err)
    }
  })
}

app.on('ready', async () => {
  try {
    await startBackend()
    createWindow()
  } catch (err) {
    const { dialog } = require('electron')
    dialog.showErrorBox('啟動失敗', `Backend 無法啟動:\n${err.message}`)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('activate', () => {
  if (mainWindow === null && backendReady) createWindow()
})
