/** MemeMeow 桌面入口：加载网站、保留会话并管理原生菜单与剪贴板权限。 */
const { app, BrowserWindow, Menu, dialog, shell } = require('electron')
const path = require('node:path')
const log = require('electron-log/main')
const { getProfile } = require('./profile.cjs')
const metadata = require('../package.json')
const { parseServerUrl, isSiteUrl, isExternalUrl, allowsPermission } = require('./policy.cjs')
const { createDesktopControls } = require('./desktop.cjs')
const profile = getProfile(app.isPackaged ? metadata.mememeowChannel ?? 'prod' : process.env.MEMEMEOW_CHANNEL ?? 'prod')

let mainWindow
let serverUrl
let desktop
const { ipcMain } = require("electron")
const { createCredentialStore } = require("./credentials.cjs")
let quitting = false

// 测试和开发可以选择独立目录，避免改变日常登录状态。
app.setName(profile.productName)
app.setPath('userData', process.env.MEMEMEOW_DESKTOP_USER_DATA
  ? path.resolve(process.env.MEMEMEOW_DESKTOP_USER_DATA) : path.join(app.getPath('appData'), profile.productName))
app.setPath('sessionData', app.getPath('userData'))
log.transports.file.maxSize = 2 * 1024 * 1024

// 全局快捷键、托盘和系统登录启动共用一个进程。
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', () => { if (app.isReady()) showMainWindow() })

/** 恢复隐藏或最小化的业务窗口，保留当前网页和登录会话。 */
function showMainWindow() {
  if (process.platform === 'darwin') app.show()
  if (!mainWindow) {
    void createWindow().catch((error) => reportError('desktop_window_create_failed', error.message))
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** 全局快捷键切换业务窗口；隐藏或最小化时恢复，显示时隐藏到托盘。 */
function toggleMainWindow() {
  if (mainWindow?.isVisible() && !mainWindow.isMinimized()) mainWindow.hide()
  else showMainWindow()
}

/** 展示并记录明确的故障原因；调用者只传入不含凭据的错误信息。 */
function reportError(code, detail) {
  log.error(code, detail)
  dialog.showErrorBox(profile.productName, `${code}\n${detail}`)
}

/** 加载站内页面；加载失败保留 Chromium 错误码，供用户定位网络故障。 */
async function loadSite(url) {
  if (!mainWindow) {
    await createWindow(url)
    return
  }
  try {
    await mainWindow.loadURL(url)
  } catch (error) {
    // 用户切换页面时 Chromium 会取消前一次导航。
    if (error.code === 'ERR_ABORTED') return
    reportError('desktop_page_load_failed', `${error.code || error.name} (${error.errno ?? 'unknown'})`)
  }
}

/** 将已校验的网页链接交给系统浏览器，禁止其他协议调用本机程序。 */
async function openExternal(url) {
  if (!isExternalUrl(url)) {
    reportError('desktop_external_protocol_denied', '此链接使用了不支持的协议或包含凭据。')
    return
  }
  try {
    await shell.openExternal(url)
  } catch (error) {
    reportError('desktop_external_open_failed', error.code || error.name)
  }
}

/** 安装原生编辑菜单，让图片与文字都通过系统粘贴命令进入网页。 */
function installMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ label: profile.productName, submenu: [
      { role: 'about', label: `关于 ${profile.productName}` },
      { label: '桌面设置…', accelerator: 'Command+,', click: desktop.openSettings },
      { type: 'separator' },
      { role: 'services', label: '服务' },
      { type: 'separator' },
      { role: 'hide', label: `隐藏 ${profile.productName}` },
      { role: 'hideOthers', label: '隐藏其他应用' },
      { role: 'unhide', label: '显示全部' },
      { type: 'separator' },
      { role: 'quit', label: `退出 ${profile.productName}` },
    ] }] : []),
    {
      label: '文件', submenu: [
        { label: '返回首页', click: () => loadSite(serverUrl.href) },
        { label: '在浏览器中打开', click: () => openExternal(mainWindow?.webContents.getURL() || serverUrl.href) },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
        ...(process.platform !== 'darwin' ? [{ role: 'quit', label: `退出 ${profile.productName}` }] : []),
      ],
    },
    {
      label: '编辑', submenu: [
        { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
        { id: 'paste', role: 'paste', label: '粘贴（含图片）' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '查看', submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' },
        { role: 'togglefullscreen', label: '全屏' },
        ...(!app.isPackaged ? [{ role: 'toggleDevTools', label: '开发者工具' }] : []),
      ],
    },
    ...(process.platform !== 'darwin' ? [{ label: '设置', submenu: [
      { label: '桌面设置…', click: desktop.openSettings },
    ] }] : []),
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** 创建隔离的浏览器窗口，只向当前网站的主页面提供剪贴板权限。 */
async function createWindow(url = serverUrl.href, show = true) {
  mainWindow = new BrowserWindow({
    title: profile.productName, width: 1200, height: 820, minWidth: 760, minHeight: 560,
    show, icon: path.join(__dirname, '..', profile.assets, 'icon.png'),
    backgroundColor: '#ffffff',
    webPreferences: {
      partition: profile.partition,
      preload: path.join(__dirname, "credentials-preload.cjs"),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
    },
  })
  const contents = mainWindow.webContents
  if (profile.channel === 'dev') mainWindow.on('page-title-updated', (event) => event.preventDefault())
  const permissionAllowed = (sender, permission, details) => sender === contents
    && !contents.isDestroyed()
    && allowsPermission({
      permission, requestingUrl: details.requestingUrl,
      isMainFrame: details.isMainFrame, focused: contents.isFocused(), currentUrl: contents.getURL(),
    }, serverUrl)
  contents.session.setPermissionCheckHandler((sender, permission, requestingOrigin, details) => (
    permissionAllowed(sender, permission, { ...details, requestingUrl: requestingOrigin })
  ))
  contents.session.setPermissionRequestHandler((sender, permission, callback, details) => {
    callback(permissionAllowed(sender, permission, details))
  })
  contents.on('will-navigate', (event) => {
    if (isSiteUrl(event.url, serverUrl)) return
    event.preventDefault()
    void openExternal(event.url)
  })
  contents.on('will-redirect', (event) => {
    if (!event.isMainFrame || isSiteUrl(event.url, serverUrl)) return
    event.preventDefault()
    reportError('desktop_redirect_denied', '网站跳转到了配置地址以外的站点，请使用系统浏览器打开该链接。')
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (isSiteUrl(url, serverUrl)) void loadSite(url)
    else void openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.on('context-menu', (_event, params) => {
    const items = []
    if (params.mediaType === 'image' && params.hasImageContents) {
      items.push({ label: '复制图片', click: () => contents.copyImageAt(params.x, params.y) })
    }
    if (params.isEditable) items.push({ role: 'cut', label: '剪切' })
    if (params.selectionText || params.isEditable) items.push({ role: 'copy', label: '复制' })
    items.push({ role: 'paste', label: '粘贴（含图片）' })
    Menu.buildFromTemplate(items).popup({ window: mainWindow })
  })
  contents.on('render-process-gone', (_event, details) => {
    reportError('desktop_renderer_terminated', `${details.reason} (${details.exitCode})`)
  })
  mainWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    if (desktop.runInBackground) mainWindow.hide()
    else app.quit()
  })
  mainWindow.on('closed', () => { mainWindow = null })
  installMenu()
  await loadSite(url)
}

app.whenReady().then(async () => {
  serverUrl = parseServerUrl(process.env.MEMEMEOW_DESKTOP_URL ?? profile.serverUrl)
  if (process.platform === 'win32') app.setAppUserModelId(profile.desktopAppId)
  desktop = createDesktopControls(showMainWindow, toggleMainWindow, profile)
  log.info('desktop_start', { version: app.getVersion(), channel: profile.channel, origin: serverUrl.origin })
  app.on('activate', showMainWindow)
  const credentials = createCredentialStore(app.getPath("userData"), serverUrl.origin)
  ipcMain.handle("mememeow:credentials", async (event, operation, options) => {
    const contents = mainWindow?.webContents
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame
      || !isSiteUrl(event.senderFrame.url, serverUrl) || !isSiteUrl(contents.getURL(), serverUrl)) {
      return { ok: false, error: "credentials_origin_not_allowed: 当前页面无权访问已保存账号" }
    }
    if (!["list", "record", "read", "save", "remove", "clear"].includes(operation)) {
      return { ok: false, error: "credentials_operation_invalid: 不支持此凭据操作" }
    }
    try {
      return { ok: true, value: await credentials[operation](options) }
    } catch (error) {
      const detail = error instanceof SyntaxError
        ? "saved-accounts.json: JSON 数据格式无效"
        : error.path ? error.message.replaceAll(error.path, path.basename(error.path)) : error.message
      log.error(`credentials_${operation}_failed`, error.code || error.name, detail)
      return { ok: false, error: `credentials_${operation}_failed: ${error.code || error.name}: ${detail}` }
    }
  })
  await createWindow(serverUrl.href, !desktop.startHidden)
  desktop.showStartupIssue()
}).catch((error) => {
  reportError('desktop_start_failed', error.message)
  app.exit(1)
})
app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => { desktop?.dispose() })
