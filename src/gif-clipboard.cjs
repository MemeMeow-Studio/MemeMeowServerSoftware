const { app, clipboard, ClipboardItem } = require("electron")
const fs = require("node:fs/promises")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const { GifReader } = require("omggif")
const { isSiteUrl, allowsPermission } = require("./policy.cjs")

const maxGifBytes = 64 * 1024 * 1024

function gifClipboardFormat(platform = process.platform) {
  if (!["win32", "darwin", "linux"].includes(platform)) {
    throw new Error("image_clipboard_platform_unsupported: 当前系统不支持 GIF 复制")
  }
  const format = platform === "darwin" ? "com.compuserve.gif" : "image/gif"
  return `electron application/osclipboard;format="${format}"`
}

function validateGifData(data) {
  if (!(data instanceof ArrayBuffer) || data.byteLength === 0) {
    throw new Error("image_gif_data_invalid: GIF 数据必须是非空 ArrayBuffer")
  }
  if (data.byteLength > maxGifBytes) {
    throw new Error("image_gif_too_large: GIF 文件超过 64 MiB，无法复制")
  }
  const reader = new GifReader(new Uint8Array(data))
  if (!reader.width || !reader.height || reader.numFrames() === 0) {
    throw new Error("image_gif_data_invalid: GIF 没有有效图片帧")
  }
  return data
}

async function writeGif(data) {
  const payload = validateGifData(data)
  const formats = {
    [gifClipboardFormat()]: new Blob([payload], { type: "image/gif" }),
  }
  if (process.platform === "win32") {
    const directory = path.join(app.getPath("userData"), "gif-clipboard")
    await fs.mkdir(directory, { recursive: true })
    const copyDirectory = await fs.mkdtemp(path.join(directory, "gif-"))
    const filename = path.join(copyDirectory, "MemeMeow.gif")
    await fs.writeFile(filename, Buffer.from(payload), { flag: "wx" })
    formats["text/uri-list"] = new Blob([pathToFileURL(filename).href + "\r\n"], {
      type: "text/uri-list",
    })
  }
  await clipboard.write([new ClipboardItem(formats)])
}

function assertImageCopyAllowed(contents, serverUrl) {
  if (contents.isDestroyed() || !allowsPermission({
    permission: "clipboard-sanitized-write",
    requestingUrl: contents.mainFrame.url,
    currentUrl: contents.getURL(),
    isMainFrame: true,
    focused: contents.isFocused(),
  }, serverUrl)) {
    throw new Error("image_clipboard_permission_denied: 只允许当前网站的前台主页面复制图片")
  }
}

async function copyImageFromUrl(contents, serverUrl, imageUrl, coordinates) {
  assertImageCopyAllowed(contents, serverUrl)
  const source = URL.parse(imageUrl)
  const localBlob = source?.protocol === "blob:" && source.origin === serverUrl.origin
  const embeddedImage = source?.protocol === "data:" && imageUrl.startsWith("data:image/")
  if (!isSiteUrl(imageUrl, serverUrl) && !localBlob && !embeddedImage) {
    contents.copyImageAt(coordinates.x, coordinates.y)
    return
  }
  const result = await contents.executeJavaScript(`(async () => {
    const response = await fetch(${JSON.stringify(imageUrl)}, { credentials: "same-origin", redirect: "error" })
    if (!response.ok) throw new Error("image_fetch_http_error: 图片请求返回 HTTP " + response.status)
    const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()
    if (mime !== "image/gif") {
      await response.body?.cancel()
      return { mime }
    }
    const reader = response.body.getReader()
    const chunks = []
    let length = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > ${maxGifBytes}) throw new Error("image_gif_too_large: GIF 文件超过 64 MiB，无法复制")
        chunks.push(value)
      }
    } finally {
      await reader.cancel()
    }
    return { mime, data: await new Blob(chunks).arrayBuffer() }
  })()`)
  assertImageCopyAllowed(contents, serverUrl)
  if (result.mime === "image/gif") await writeGif(result.data)
  else contents.copyImageAt(coordinates.x, coordinates.y)
}

module.exports = { gifClipboardFormat, maxGifBytes, validateGifData, writeGif, assertImageCopyAllowed, copyImageFromUrl }
