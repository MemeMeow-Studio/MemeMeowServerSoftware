/** 桌面权限边界测试：验证外部地址、嵌入页面和后台页面不能获得剪贴板权限。 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseServerUrl, isSiteUrl, isExternalUrl, allowsPermission } = require('../src/policy.cjs')

const site = parseServerUrl('https://mememeow.example')

test('允许 HTTPS 与本机开发地址，拒绝远程 HTTP 和带凭据的地址', () => {
  for (const url of ['https://mememeow.example', 'http://127.0.0.1:28275', 'http://localhost:28275', 'http://[::1]:28275']) {
    assert.ok(parseServerUrl(url))
  }
  for (const url of ['', null, 'http://mememeow.example', 'file:///etc/passwd', 'https://user:password@mememeow.example']) {
    assert.throws(() => parseServerUrl(url), /desktop_/)
  }
})

test('站内导航按完整 origin 判断，外部打开只允许 HTTP 和 HTTPS', () => {
  assert.equal(isSiteUrl('https://mememeow.example/upload', site), true)
  for (const url of ['https://mememeow.example.attacker.example', 'https://mememeow.example:444', 'http://mememeow.example', 'javascript:alert(1)', 'blob:https://mememeow.example/id']) {
    assert.equal(isSiteUrl(url, site), false)
  }
  assert.equal(isExternalUrl('https://example.org/help'), true)
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'custom:run', 'https://user:password@example.org']) {
    assert.equal(isExternalUrl(url), false)
  }
})

test('只有网站的前台主页面可以读写剪贴板', () => {
  const request = {
    permission: 'clipboard-read', requestingUrl: site.href,
    currentUrl: `${site.href}upload`, isMainFrame: true, focused: true,
  }
  assert.equal(allowsPermission(request, site), true)
  assert.equal(allowsPermission({ ...request, permission: 'clipboard-sanitized-write' }, site), true)
  for (const change of [
    { permission: 'media' }, { permission: 'geolocation' }, { permission: 'unknown' },
    { isMainFrame: false }, { focused: false }, { requestingUrl: 'https://example.org' },
    { currentUrl: 'https://example.org' },
  ]) assert.equal(allowsPermission({ ...request, ...change }, site), false)
})
