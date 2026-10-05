const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const { execFile } = require("node:child_process")
const { promisify } = require("node:util")
const { createRequire } = require("node:module")
const { _electron: electron } = require("playwright")
const { expect } = require("playwright/test")
const { GifReader } = require("omggif")
const sharp = require("sharp")
const { createAnimatedGif } = require("./gif-fixture.cjs")

const project = path.resolve(__dirname, "..")
const frontend = path.resolve(process.env.MEMEMEOW_FRONTEND_ROOT || path.join(project, "..", "MemeMeowServer", "frontend"))
const frontendRequire = createRequire(path.join(frontend, "package.json"))
const { build } = frontendRequire("esbuild")

async function readGif(application) {
  return application.evaluate(async ({ clipboard }) => {
    const format = process.platform === "darwin" ? "com.compuserve.gif" : "image/gif"
    const type = `electron application/osclipboard;format="${format}"`
    const items = await clipboard.read()
    const item = items.find((item) => item.types.includes(type))
    if (!item) throw new Error(`gif_clipboard_format_missing: ${JSON.stringify(items.map((item) => item.types))}`)
    return Array.from(new Uint8Array(await (await item.getType(type)).arrayBuffer()))
  })
}

async function main() {
  const serverUrl = process.env.MEMEMEOW_DESKTOP_URL
  assert.ok(serverUrl, "验收需要设置 MEMEMEOW_DESKTOP_URL 为本机开发网站地址")
  const origin = new URL(serverUrl)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname), "验收只允许本机开发服务")
  const local = path.join(project, ".local", "gif-copy")
  await fs.mkdir(local, { recursive: true })
  const directory = await fs.mkdtemp(path.join(local, "live-"))
  const bundle = path.join(directory, "clipboard-entry.js")
  await build({
    entryPoints: [path.join(__dirname, "gif-browser-entry.mjs")],
    outfile: bundle, bundle: true, format: "iife", platform: "browser",
    alias: {
      vue: frontendRequire.resolve("vue/dist/vue.runtime.esm-bundler.js"),
      "mememeow-image-clipboard": path.join(frontend, "src/composables/useImageClipboard.ts"),
    },
    define: { "process.env.NODE_ENV": '"production"', __VUE_OPTIONS_API__: "true", __VUE_PROD_DEVTOOLS__: "false", __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false" },
  })
  const application = await electron.launch({
    args: [project], chromiumSandbox: true,
    env: { ...process.env, MEMEMEOW_DESKTOP_USER_DATA: path.join(directory, "application") }, timeout: 30000,
  })
  try {
    const page = await application.firstWindow()
    await page.waitForLoadState("domcontentloaded")
    assert.equal(new URL(page.url()).origin, origin.origin)
    await page.addScriptTag({ path: bundle })
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.show()
      window.focus()
      window.webContents.focus()
    })
    await page.waitForFunction(() => document.hasFocus())
    assert.equal(await page.evaluate(() => window.mememeowClipboard.version), 1)

    const original = createAnimatedGif()
    const gifUrl = await page.evaluate((bytes) => URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/gif" })), Array.from(original))
    await application.evaluate(async ({ clipboard }) => clipboard.writeText("gif_frontend_pending"))
    await page.evaluate((url) => window.desktopImageCopy(url), gifUrl)
    assert.deepEqual(Buffer.from(await readGif(application)), original)
    const copied = new GifReader(Buffer.from(await readGif(application)))
    assert.equal(copied.numFrames(), 2)
    assert.deepEqual([copied.frameInfo(0).delay, copied.frameInfo(1).delay], [7, 13])
    assert.equal(copied.loopCount(), 0)
    assert.equal(copied.frameInfo(0).transparent_index, 2)

    await assert.rejects(page.evaluate(() => window.mememeowClipboard.copyGif(new ArrayBuffer(0))), /image_gif_data_invalid/)
    assert.deepEqual(Buffer.from(await readGif(application)), original)
    await assert.rejects(page.evaluate(() => window.mememeowClipboard.copyGif(new ArrayBuffer(64 * 1024 * 1024 + 1))), /image_gif_too_large/)
    assert.deepEqual(Buffer.from(await readGif(application)), original)

    const secondaryWindowEvent = application.waitForEvent("window")
    const secondaryWindowId = await application.evaluate(async ({ BrowserWindow, app }) => {
      const window = new BrowserWindow({
        show: false,
        webPreferences: { preload: app.getAppPath() + "/src/credentials-preload.cjs", sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      await window.loadURL("about:blank")
      return window.id
    })
    const secondaryPage = await secondaryWindowEvent
    await assert.rejects(secondaryPage.evaluate((bytes) => window.mememeowClipboard.copyGif(new Uint8Array(bytes).buffer), Array.from(original)), /image_clipboard_origin_invalid/)
    assert.deepEqual(Buffer.from(await readGif(application)), original)
    await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).destroy(), secondaryWindowId)

    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
    await assert.rejects(page.evaluate((bytes) => window.mememeowClipboard.copyGif(new Uint8Array(bytes).buffer), Array.from(original)), /image_clipboard_permission_denied/)
    assert.deepEqual(Buffer.from(await readGif(application)), original)
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.show()
      window.focus()
      window.webContents.focus()
    })
    await page.waitForFunction(() => document.hasFocus())

    await application.evaluate(async ({ BrowserWindow }, url) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      const requireProject = process.getBuiltinModule("module").createRequire(process.cwd() + "/package.json")
      const { copyImageFromUrl } = requireProject("./src/gif-clipboard.cjs")
      await copyImageFromUrl(contents, new URL(contents.getURL()), url, { x: 0, y: 0 })
    }, gifUrl)
    assert.deepEqual(Buffer.from(await readGif(application)), original)
    if (process.platform === "linux") {
      await page.evaluate(async (url) => {
        const image = document.createElement("img")
        image.id = "desktop-gif-clipboard-image"
        image.src = url
        image.style.cssText = "position:fixed;top:20px;left:20px;width:160px;height:120px;z-index:99999"
        document.body.append(image)
        await image.decode()
      }, gifUrl)
      await application.evaluate(async ({ clipboard }) => clipboard.writeText("gif_context_menu_pending"))
      await page.locator("#desktop-gif-clipboard-image").click({ button: "right" })
      await promisify(execFile)("xdotool", ["key", "--clearmodifiers", "Down", "Return"])
      await expect.poll(() => application.evaluate(async ({ clipboard }) => clipboard.has('electron application/osclipboard;format="image/gif"')), { timeout: 5000 }).toBe(true)
      assert.deepEqual(Buffer.from(await readGif(application)), original)
      await page.locator("#desktop-gif-clipboard-image").evaluate((image) => image.remove())
    }

    for (const format of ["png", "jpeg"]) {
      const image = await sharp({ create: { width: 4, height: 3, channels: 3, background: "red" } }).toFormat(format).toBuffer()
      const url = await page.evaluate(({ bytes, format }) => URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: `image/${format}` })), { bytes: Array.from(image), format })
      await application.evaluate(async ({ clipboard }) => clipboard.writeText("static_frontend_pending"))
      await page.evaluate((url) => window.desktopImageCopy(url), url)
      const png = await application.evaluate(async ({ clipboard }) => {
        const items = await clipboard.read()
        const item = items.find((item) => item.types.includes("image/png"))
        if (!item) throw new Error("static_image_clipboard_missing")
        return Array.from(new Uint8Array(await (await item.getType("image/png")).arrayBuffer()))
      })
      const metadata = await sharp(Buffer.from(png)).metadata()
      assert.equal(metadata.width, 4)
      assert.equal(metadata.height, 3)
      assert.equal(metadata.format, "png")
      await page.evaluate((url) => URL.revokeObjectURL(url), url)
    }
    await page.evaluate((url) => URL.revokeObjectURL(url), gifUrl)
    console.log("真实 Electron GIF 字节、动画信息、网页复制入口、右键复制处理、权限拒绝和 PNG/JPEG 复制检查通过")
  } finally {
    await application.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
