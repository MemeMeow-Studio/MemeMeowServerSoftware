/** 桌面客户端的地址与权限规则，供主进程和测试共同使用。 */
const clipboardPermissions = new Set(['clipboard-read', 'clipboard-sanitized-write'])

/** 校验启动地址；允许 HTTPS，以及开发时的 HTTP 回环地址。 */
function parseServerUrl(value) {
  const url = typeof value === 'string' ? URL.parse(value) : null
  if (!url || url.username || url.password) {
    throw new Error('desktop_invalid_server_url：网站地址必须是完整 URL，且不能包含用户名或密码。')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('desktop_insecure_server_url：网站需要 HTTPS；本机开发允许 HTTP 回环地址。')
  }
  return url
}

/** 判断导航是否属于配置的网站，拒绝特殊协议和 URL 内的凭据。 */
function isSiteUrl(value, serverUrl) {
  const url = URL.parse(value)
  return Boolean(url && !url.username && !url.password
    && ['https:', 'http:'].includes(url.protocol) && url.origin === serverUrl.origin)
}

/** 只有普通网页链接能够交给系统浏览器，禁止启动任意协议程序。 */
function isExternalUrl(value) {
  const url = URL.parse(value)
  return Boolean(url && !url.username && !url.password && ['https:', 'http:'].includes(url.protocol))
}

/** 剪贴板权限只提供给当前网站中处于前台的主页面。 */
function allowsPermission({ permission, requestingUrl, isMainFrame, focused, currentUrl }, serverUrl) {
  return clipboardPermissions.has(permission) && isMainFrame === true && focused
    && isSiteUrl(requestingUrl, serverUrl) && isSiteUrl(currentUrl, serverUrl)
}

module.exports = { parseServerUrl, isSiteUrl, isExternalUrl, allowsPermission }
