/** 原生桌面功能：设置窗口、全局快捷键、登录启动和托盘入口。 */
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, globalShortcut, dialog } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const log = require('electron-log/main')
const { defaultSettings, validateSettings, readSettings, writeSettings } = require('./settings.cjs')

/** 在 app ready 后安装本机功能；两个回调分别负责显示窗口和切换窗口显示状态。 */
function createDesktopControls(showMainWindow, toggleMainWindow) {
  const directory = app.getPath('userData')
  const settingsUrl = pathToFileURL(path.join(__dirname, 'settings.html')).href
  const loginSupported = app.isPackaged && ['win32', 'darwin'].includes(process.platform)
  const loginOptions = process.platform === 'win32'
    ? { path: process.execPath, args: ['--background'] }
    : { type: 'mainAppService' }
  let settings = readSettings(directory)
  let settingsWindow = null
  let registeredShortcut = null
  let shortcutError = ''

  /** 查询真实登录项状态，让系统设置中的外部变更能够显示在客户端中。 */
  function loginState() {
    if (!loginSupported) return { supported: false, enabled: false, message: '开机自启仅在安装后的 Windows、macOS 客户端中提供。' }
    const current = app.getLoginItemSettings(loginOptions)
    const enabled = process.platform === 'win32'
      ? current.openAtLogin && current.executableWillLaunchAtLogin
      : current.openAtLogin || current.status === 'requires-approval'
    return {
      supported: true, enabled,
      message: current.status === 'requires-approval' ? '请在 macOS 系统设置 → 通用 → 登录项中允许 MemeMeow。' : '',
      status: current.status,
    }
  }

  /** 注册失败时给出可采取行动的信息；系统不会提供具体占用程序的名称。 */
  function registerShortcut(shortcut) {
    if (!globalShortcut.register(shortcut, toggleMainWindow)) {
      throw new Error(`desktop_shortcut_registration_failed: ${shortcut} 注册失败，可能被其他程序占用或受到系统限制。请修改组合键。`)
    }
  }

  /** 设置页面只接收可显示的状态与默认值，不获得通用系统调用能力。 */
  function snapshot() {
    return { ...settings, defaultShortcut: defaultSettings().shortcut, platform: process.platform, login: loginState(), shortcutError }
  }

  /** 创建独立的本地设置页面，只允许该页面访问专用 IPC。 */
  function openSettings() {
    if (settingsWindow) {
      if (settingsWindow.isMinimized()) settingsWindow.restore()
      settingsWindow.show()
      settingsWindow.focus()
      return
    }
    settingsWindow = new BrowserWindow({
      title: 'MemeMeow · 桌面设置', width: 560, height: 610, minWidth: 500, minHeight: 560,
      show: false, autoHideMenuBar: true, backgroundColor: '#f8f7fb',
      icon: path.join(__dirname, '../assets/icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'settings-preload.cjs'),
        partition: 'desktop-settings',
        nodeIntegration: false, contextIsolation: true, sandbox: true,
        webSecurity: true, webviewTag: false,
      },
    })
    settingsWindow.setMenu(null)
    settingsWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    settingsWindow.webContents.session.setPermissionCheckHandler(() => false)
    settingsWindow.webContents.on('will-navigate', (event) => event.preventDefault())
    settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    settingsWindow.on('blur', () => globalShortcut.setSuspended(false))
    settingsWindow.on('closed', () => {
      globalShortcut.setSuspended(false)
      settingsWindow = null
    })
    settingsWindow.once('ready-to-show', () => {
      settingsWindow.show()
      settingsWindow.focus()
    })
    settingsWindow.loadURL(settingsUrl).catch((error) => {
      log.error('desktop_settings_load_failed', error)
      dialog.showErrorBox('桌面设置加载失败', error.message)
    })
  }

  /** 只有本地设置窗口的主页面可以读取或更改本机设置。 */
  function verifySender(event) {
    if (!settingsWindow || event.sender !== settingsWindow.webContents
      || event.senderFrame !== settingsWindow.webContents.mainFrame || event.senderFrame.url !== settingsUrl) {
      throw new Error('desktop_settings_access_denied: 请求来源无权访问桌面设置。')
    }
  }

  /** 修改系统登录项后立即读取结果，保留系统拒绝或等待批准的具体状态。 */
  function setLogin(enabled) {
    app.setLoginItemSettings({ ...loginOptions, openAtLogin: enabled, ...(process.platform === 'win32' ? { enabled } : {}) })
    const current = loginState()
    if (current.enabled !== enabled) {
      throw new Error(`desktop_login_update_failed: ${current.message || `系统未接受登录启动设置（${current.status || 'Windows 登录项状态未更新'}）。`}`)
    }
  }

  /** 保存前注册新的组合键；任何失败都保留原设置并明确报告恢复失败的原因。 */
  function saveSettings(input) {
    const next = validateSettings(input)
    if (typeof input.openAtLogin !== 'boolean') throw new Error('desktop_settings_invalid: 登录启动设置需要布尔值。')
    const previousLogin = loginState()
    if (!previousLogin.supported && input.openAtLogin) throw new Error(previousLogin.message)
    const nextShortcut = next.shortcutEnabled ? next.shortcut : null
    const shortcutChanged = nextShortcut !== registeredShortcut
    const loginChanged = previousLogin.supported && input.openAtLogin !== previousLogin.enabled
    let newShortcutRegistered = false
    let loginAttempted = false
    try {
      if (shortcutChanged && nextShortcut) {
        registerShortcut(nextShortcut)
        newShortcutRegistered = true
      }
      if (loginChanged) {
        loginAttempted = true
        setLogin(input.openAtLogin)
      }
      writeSettings(directory, next)
    } catch (error) {
      if (newShortcutRegistered) globalShortcut.unregister(nextShortcut)
      if (loginAttempted) {
        try { setLogin(previousLogin.enabled) } catch (restoreError) {
          throw new Error(`${error.message}\n恢复登录启动设置失败：${restoreError.message}`)
        }
      }
      throw error
    }
    if (shortcutChanged && registeredShortcut) globalShortcut.unregister(registeredShortcut)
    registeredShortcut = nextShortcut
    settings = next
    shortcutError = ''
    globalShortcut.setSuspended(false)
    log.info('desktop_settings_saved', { shortcutEnabled: settings.shortcutEnabled, runInBackground: settings.runInBackground, openAtLogin: input.openAtLogin })
    return snapshot()
  }

  ipcMain.handle('desktop-settings:read', (event) => { verifySender(event); return snapshot() })
  ipcMain.handle('desktop-settings:record', (event, recording) => {
    verifySender(event)
    if (typeof recording !== 'boolean') throw new Error('desktop_settings_invalid: 快捷键录入状态需要布尔值。')
    globalShortcut.setSuspended(recording && settingsWindow.isFocused())
  })
  ipcMain.handle('desktop-settings:save', (event, input) => {
    verifySender(event)
    try { return { ok: true, state: saveSettings(input) } } catch (error) {
      log.error('desktop_settings_save_failed', error.message)
      return { ok: false, error: error.message }
    }
  })

  if (settings.shortcutEnabled) {
    try {
      registerShortcut(settings.shortcut)
      registeredShortcut = settings.shortcut
    } catch (error) {
      shortcutError = error.message
      log.error('desktop_shortcut_start_failed', error.message)
    }
  }

  const trayImage = nativeImage.createFromPath(path.join(__dirname, '../assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'))
  if (trayImage.isEmpty()) throw new Error('desktop_tray_icon_missing: 托盘图标无法读取。')
  if (process.platform === 'darwin') trayImage.setTemplateImage(true)
  const tray = new Tray(trayImage)
  tray.setToolTip('MemeMeow')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示窗口', click: showMainWindow },
    { label: '桌面设置…', click: openSettings },
    { type: 'separator' },
    { label: '退出 MemeMeow', click: () => app.quit() },
  ]))
  if (process.platform !== 'darwin') tray.on('click', showMainWindow)

  return {
    get runInBackground() { return settings.runInBackground },
    get startHidden() {
      return process.argv.includes('--background')
        || (process.platform === 'darwin' && app.getLoginItemSettings(loginOptions).wasOpenedAtLogin)
    },
    openSettings,
    showStartupIssue() { if (shortcutError) openSettings() },
    dispose() {
      globalShortcut.unregisterAll()
      tray.destroy()
    },
  }
}

module.exports = { createDesktopControls }
