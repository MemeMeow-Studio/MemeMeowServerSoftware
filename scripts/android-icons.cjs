// 使用已有应用图标生成 Android 启动图标和启动画面。
const path = require('node:path')
const fs = require('node:fs/promises')
const sharp = require('sharp')
const { getProfile } = require('../src/profile.cjs')

/** 按 Android 密度生成图标，启动画面保持工程已有的画布尺寸。 */
async function main() {
  const project = path.resolve(__dirname, '..')
  const profile = getProfile(process.argv[2] ?? 'prod')
  const source = path.join(project, profile.assets, 'icon.png')
  const resources = path.join(process.env.MEMEMEOW_ANDROID_PATH ?? path.join(project, 'android'), 'app/src/main/res')
  if (profile.channel === 'dev' && !process.env.MEMEMEOW_ANDROID_PATH) throw new Error('android_icon_directory_required: 开发图标需要独立 Android 目录')
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
  for (const [density, scale] of Object.entries(densities)) {
    const directory = path.join(resources, `mipmap-${density}`)
    const iconSize = Math.round(48 * scale)
    const foregroundSize = Math.round(108 * scale)
    const safeSize = Math.round(64 * scale)
    const padding = (foregroundSize - safeSize) / 2
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
      await sharp(source).resize(iconSize, iconSize).flatten({ background: '#ffffff' }).png().toFile(path.join(directory, name))
    }
    await sharp(source).resize(safeSize, safeSize).extend({
      top: padding, bottom: padding, left: padding, right: padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).png().toFile(path.join(directory, 'ic_launcher_foreground.png'))
  }
  for (const directory of await fs.readdir(resources)) {
    if (!directory.startsWith('drawable')) continue
    const splash = path.join(resources, directory, 'splash.png')
    const files = await fs.readdir(path.join(resources, directory))
    if (!files.includes('splash.png')) continue
    const { width, height } = await sharp(splash).metadata()
    const iconSize = Math.round(Math.min(width, height) * 0.22)
    const icon = await sharp(source).resize(iconSize, iconSize).png().toBuffer()
    await sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
      .composite([{ input: icon, gravity: 'centre' }]).png().toFile(splash)
  }
}

main().catch((reason) => { console.error(reason); process.exitCode = 1 })
