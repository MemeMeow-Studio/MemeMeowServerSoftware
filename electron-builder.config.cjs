const path = require('node:path')
const { getProfile } = require('./src/profile.cjs')
const { build } = require('./package.json')
const profile = getProfile(process.env.MEMEMEOW_CHANNEL ?? 'prod')

module.exports = {
  ...build,
  appId: profile.desktopAppId,
  productName: profile.productName,
  artifactName: profile.channel === 'dev' ? 'MemeMeow-Dev-${version}-${os}-${arch}.${ext}' : build.artifactName,
  directories: { ...build.directories, output: profile.channel === 'dev' ? 'dist/dev' : 'dist' },
  extraMetadata: { mememeowChannel: profile.channel },
  files: [...build.files, 'assets/dev/*.png'],
  icon: path.join(profile.assets, 'icon.png'),
  win: { ...build.win, icon: path.join(profile.assets, 'icon.ico') },
  mac: { ...build.mac, icon: path.join(profile.assets, 'icon.icns') },
}
