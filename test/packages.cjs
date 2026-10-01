const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const asar = require('@electron/asar')
const AdmZip = require('adm-zip')
const { getProfile } = require('../src/profile.cjs')
const { version } = require('../package.json')

const project = path.resolve(__dirname, '..')
const sdk = process.env.ANDROID_HOME
assert.ok(sdk, 'APK 检查需要设置 ANDROID_HOME。')
const tools = path.join(sdk, 'build-tools/36.0.0')

for (const channel of ['prod', 'dev']) {
  const profile = getProfile(channel)
  const output = path.join(project, channel === 'prod' ? 'dist' : 'dist/dev')
  for (const platform of ['linux', 'win']) {
    const archive = path.join(output, `${platform}-unpacked/resources/app.asar`)
    const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString())
    assert.equal(metadata.mememeowChannel, channel)
    for (const source of ['src/main.cjs', 'src/profile.cjs', 'src/desktop.cjs', 'src/settings.cjs', 'src/settings-renderer.js']) {
      assert.deepEqual(asar.extractFile(archive, source), fs.readFileSync(path.join(project, source)))
    }
    assert.deepEqual(asar.extractFile(archive, `${profile.assets}/icon.png`), fs.readFileSync(path.join(project, profile.assets, 'icon.png')))
    const config = JSON.parse(asar.extractFile(archive, 'desktop.config.json').toString())
    assert.equal(channel === 'prod' ? config.serverUrl : config.channels.dev.serverUrl, profile.serverUrl)
  }
  const prefix = channel === 'prod' ? 'MemeMeow' : 'MemeMeow-Dev'
  const zip = new AdmZip(path.join(output, `${prefix}-${version}-win-x64.zip`))
  assert.ok(zip.getEntry(`${profile.productName}.exe`))
  assert.deepEqual(zip.getEntry('resources/app.asar').getData(), fs.readFileSync(path.join(output, 'win-unpacked/resources/app.asar')))
  const filename = channel === 'prod' ? 'app-debug.apk' : `MemeMeow-Dev-${version}-android.apk`
  const apkPath = path.join(project, 'dist/android', channel, filename)
  const apk = new AdmZip(apkPath)
  const capacitor = JSON.parse(apk.getEntry('assets/capacitor.config.json').getData().toString())
  assert.equal(capacitor.appId, profile.androidAppId)
  assert.equal(capacitor.appName, profile.productName)
  assert.equal(new URL(capacitor.server.url).origin, profile.serverUrl)
  assert.equal(capacitor.server.cleartext, false)
  const badging = execFileSync(path.join(tools, 'aapt'), ['dump', 'badging', apkPath], { encoding: 'utf8' })
  assert.ok(badging.includes(`name='${profile.androidAppId}'`))
  assert.ok(badging.includes(`application-label:'${profile.productName}'`))
  assert.ok(badging.includes(`versionName='${version}'`))
  execFileSync(path.join(tools, 'apksigner'), ['verify', apkPath], { stdio: 'inherit' })
  console.log(`${profile.productName}：Linux、Windows ZIP 和 APK 内容、身份、地址、图标与 APK 签名检查通过。`)
}
