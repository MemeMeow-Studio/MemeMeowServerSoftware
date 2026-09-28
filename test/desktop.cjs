/** 在真实开发网站中验证 Electron 图片剪贴板、原生粘贴与窗口隔离。 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { _electron: electron } = require('playwright')

/** 使用真实 Electron 与 PNG 数据完成双向剪贴板检查，不修改服务器业务数据。 */
async function main() {
  const serverUrl = process.env.MEMEMEOW_DESKTOP_URL
  assert.ok(serverUrl, '验收需要显式设置 MEMEMEOW_DESKTOP_URL 为开发网站地址。')
  const url = new URL(serverUrl)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), '验收只允许本机开发服务。')
  const project = path.resolve(__dirname, '..')
  await fs.mkdir(path.join(project, '.local'), { recursive: true })
  const userData = await fs.mkdtemp(path.join(project, '.local', 'e2e-'))
  const application = await electron.launch({
    args: [project],
    chromiumSandbox: true,
    env: { ...process.env, MEMEMEOW_DESKTOP_USER_DATA: userData },
    timeout: 30_000,
  })
  try {
    const page = await application.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.locator('#app h1').waitFor()
    assert.equal(new URL(page.url()).origin, url.origin)
    assert.equal(await page.title(), 'MemeMeow')
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
    const preferences = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.focus()
      window.webContents.focus()
      const preferences = window.webContents.getLastWebPreferences()
      return { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration }
    })
    assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false })

    // 浏览器生成 PNG 后写入系统剪贴板，主进程检查真实图片数据。
    const expected = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 16
      canvas.height = 12
      const context = canvas.getContext('2d')
      context.fillStyle = '#e45a87'
      context.fillRect(0, 0, 16, 12)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    })
    const native = await application.evaluate(async ({ clipboard, nativeImage }) => {
      const items = await clipboard.read()
      const item = items.find((item) => item.types.includes('image/png'))
      if (!item) throw new Error('clipboard_png_missing')
      const buffer = Buffer.from(await (await item.getType('image/png')).arrayBuffer())
      return { size: nativeImage.createFromBuffer(buffer).getSize(), png: Array.from(buffer) }
    })
    assert.deepEqual(native.size, { width: 16, height: 12 })
    assert.ok(native.png.length > 0)

    // 主进程写入后，通过网页 Clipboard API 和原生 paste 命令分别读取。
    await application.evaluate(async ({ clipboard, ClipboardItem }, png) => {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
    }, expected)
    const image = await page.evaluate(async () => {
      const items = await navigator.clipboard.read()
      const item = items.find((item) => item.types.includes('image/png'))
      const blob = await item.getType('image/png')
      const bitmap = await createImageBitmap(blob)
      const dimensions = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return dimensions
    })
    assert.deepEqual(image, { width: 16, height: 12 })
    await page.evaluate(() => {
      window.desktopPasteResult = null
      window.addEventListener('paste', (event) => {
        const file = Array.from(event.clipboardData.files).find((file) => file.type === 'image/png')
        window.desktopPasteResult = file ? { type: file.type, size: file.size, trusted: event.isTrusted } : null
      }, { once: true })
      document.activeElement?.blur()
    })
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste())
    await page.waitForFunction(() => window.desktopPasteResult !== null)
    const pasted = await page.evaluate(() => window.desktopPasteResult)
    assert.equal(pasted.type, 'image/png')
    assert.equal(pasted.trusted, true)
    assert.ok(pasted.size > 0)
    console.log('真实网站加载、窗口隔离、网页复制图片、系统剪贴板读取、网页读取图片和原生图片粘贴检查通过。')
  } finally {
    await application.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
