/** MemeMeow 桌面入口：加载网站、保留会话并管理原生菜单与剪贴板权限。 */
const { app, BrowserWindow, Menu, dialog, shell } = require('electron')
const path = require('node:path')
const log = require('electron-log/main')
const config = require('../desktop.config.json')
const { parseServerUrl, isSiteUrl, isExternalUrl, allowsPermission } = require('./policy.cjs')

let mainWindow
let serverUrl

// 测试和开发可以选择独立目录，避免改变日常登录状态。
if (process.env.MEMEMEOW_DESKTOP_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.MEMEMEOW_DESKTOP_USER_DATA))
}
app.setName('MemeMeow')
log.transports.file.maxSize = 2 * 1024 * 1024

/** 展示并记录明确的故障原因；调用者只传入不含凭据的错误信息。 */
function reportError(code, detail) {
  log.error(code, detail)
  dialog.showErrorBox('MemeMeow', `${code}\n${detail}`)
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
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: '文件', submenu: [
        { label: '返回首页', click: () => loadSite(serverUrl.href) },
        { label: '在浏览器中打开', click: () => openExternal(mainWindow?.webContents.getURL() || serverUrl.href) },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit', label: '关闭' },
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
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** 创建隔离的浏览器窗口，只向当前网站的主页面提供剪贴板权限。 */
async function createWindow(url = serverUrl.href) {
  mainWindow = new BrowserWindow({
    title: 'MemeMeow', width: 1200, height: 820, minWidth: 760, minHeight: 560,
    backgroundColor: '#ffffff',
    webPreferences: {
      partition: 'persist:mememeow',
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
    },
  })
  const contents = mainWindow.webContents
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
  mainWindow.on('closed', () => { mainWindow = null })
  installMenu()
  await loadSite(url)
}

app.whenReady().then(async () => {
  serverUrl = parseServerUrl(process.env.MEMEMEOW_DESKTOP_URL ?? config.serverUrl)
  log.info('desktop_start', { version: app.getVersion(), origin: serverUrl.origin })
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
}).catch((error) => {
  reportError('desktop_start_failed', error.message)
  app.exit(1)
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
