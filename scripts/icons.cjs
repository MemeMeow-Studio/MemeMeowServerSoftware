/** 从项目 SVG 生成应用和托盘图标，复用 electron-builder 的安装包图标转换工具。 */
const path = require('node:path')
const sharp = require('sharp')
const { runIconsTool } = require('app-builder-lib/out/toolsets/icons')
const { getProfile } = require('../src/profile.cjs')

/** 按系统需要生成尺寸固定的透明图标，输入和输出均位于 assets。 */
async function generate(channel) {
  const assets = path.resolve(__dirname, '..', getProfile(channel).assets)
  await sharp(path.join(assets, 'icon.svg')).png().toFile(path.join(assets, 'icon.png'))
  await sharp(path.join(assets, 'icon.svg')).resize(32, 32).png().toFile(path.join(assets, 'tray.png'))
  await sharp(path.join(assets, 'trayTemplate.svg')).png().toFile(path.join(assets, 'trayTemplate.png'))
  await sharp(path.join(assets, 'trayTemplate.svg')).resize(44, 44).png().toFile(path.join(assets, 'trayTemplate@2x.png'))
  for (const outputFormat of ['ico', 'icns']) {
    await runIconsTool({ inputFile: path.join(assets, 'icon.png'), outputFormat, outDir: assets })
  }
}

async function main() {
  const channels = process.argv[2] ? [process.argv[2]] : ['prod', 'dev']
  for (const channel of channels) await generate(channel)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
