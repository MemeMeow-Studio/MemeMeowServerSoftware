const assert = require("node:assert/strict")
const { test } = require("node:test")
const { GifReader } = require("omggif")
const sharp = require("sharp")
const { gifClipboardFormat, maxGifBytes, validateGifData } = require("../src/gif-clipboard.cjs")
const { createAnimatedGif } = require("./gif-fixture.cjs")

test("GIF 使用平台原始剪贴板格式", () => {
  assert.equal(gifClipboardFormat("win32"), 'electron application/osclipboard;format="image/gif"')
  assert.equal(gifClipboardFormat("darwin"), 'electron application/osclipboard;format="com.compuserve.gif"')
  assert.equal(gifClipboardFormat("linux"), 'electron application/osclipboard;format="image/gif"')
  assert.throws(() => gifClipboardFormat("unknown"), /image_clipboard_platform_unsupported/)
})

test("GIF 校验保留完整字节、帧数、时长、透明度与循环设置", async () => {
  const original = createAnimatedGif()
  const data = Uint8Array.from(original).buffer
  assert.equal(validateGifData(data), data)
  assert.deepEqual(Buffer.from(data), original)
  const reader = new GifReader(new Uint8Array(data))
  assert.equal(reader.numFrames(), 2)
  assert.equal(reader.loopCount(), 0)
  assert.deepEqual([reader.frameInfo(0).delay, reader.frameInfo(1).delay], [7, 13])
  assert.equal(reader.frameInfo(0).transparent_index, 2)
  const decoded = await sharp(Buffer.from(data), { animated: true }).raw().toBuffer({ resolveWithObject: true })
  assert.equal(decoded.info.height, 6)
  assert.equal(decoded.info.channels, 4)
  assert.deepEqual(Array.from(decoded.data.subarray(0, 4)), [255, 0, 0, 255])
  assert.deepEqual(Array.from(decoded.data.subarray(48, 52)), [0, 0, 255, 255])
})

test("GIF 接口拒绝空数据、错误类型、超限文件与损坏图片", async () => {
  assert.throws(() => validateGifData(new ArrayBuffer(0)), /image_gif_data_invalid/)
  assert.throws(() => validateGifData("GIF"), /image_gif_data_invalid/)
  assert.throws(() => validateGifData(new ArrayBuffer(maxGifBytes + 1)), /image_gif_too_large/)
  assert.throws(() => validateGifData(Uint8Array.from(createAnimatedGif().subarray(0, 20)).buffer))
  const png = await sharp({ create: { width: 4, height: 3, channels: 4, background: "red" } }).png().toBuffer()
  assert.throws(() => validateGifData(Uint8Array.from(png).buffer), /Invalid GIF/)
})
