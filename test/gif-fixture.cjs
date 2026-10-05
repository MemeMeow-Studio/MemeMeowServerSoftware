const { GifWriter } = require("omggif")

function createAnimatedGif() {
  const buffer = Buffer.alloc(4096)
  const writer = new GifWriter(buffer, 4, 3, { palette: [0xff0000, 0x0000ff, 0x000000, 0xffffff], loop: 0 })
  writer.addFrame(0, 0, 4, 3, new Uint8Array([0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]), { delay: 7, disposal: 2, transparent: 2 })
  writer.addFrame(0, 0, 4, 3, new Uint8Array([1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1]), { delay: 13, disposal: 2, transparent: 2 })
  return buffer.subarray(0, writer.end())
}

module.exports = { createAnimatedGif }
