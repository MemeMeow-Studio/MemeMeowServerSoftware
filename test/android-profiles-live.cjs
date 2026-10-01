const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { _android } = require('playwright')
const AdmZip = require('adm-zip')
const { getProfile } = require('../src/profile.cjs')
const { version } = require('../package.json')

async function main() {
  const devices = await _android.devices({ omitDriverInstall: true })
  const serial = process.env.MEMEMEOW_ANDROID_SERIAL ?? 'emulator-5554'
  const device = devices.find((candidate) => candidate.serial() === serial)
  assert.ok(device, `android_device_missing: ${serial}`)
  const project = path.resolve(__dirname, '..')
  try {
    for (const channel of ['prod', 'dev']) {
      const profile = getProfile(channel)
      const filename = channel === 'prod' ? 'app-debug.apk' : `MemeMeow-Dev-${version}-android.apk`
      const apkPath = path.join(project, 'dist/android', channel, filename)
      const config = JSON.parse(new AdmZip(apkPath).readAsText('assets/capacitor.config.json'))
      assert.equal(config.appId, profile.androidAppId)
      assert.equal(config.appName, profile.productName)
      assert.equal(new URL(config.server.url).origin, profile.serverUrl)
      execFileSync('adb', ['-s', serial, 'install', '-r', apkPath], { stdio: 'inherit' })
    }
    const packages = (await device.shell('pm list packages cc.stellarformation.mememeow.android')).toString()
    for (const channel of ['prod', 'dev']) {
      const profile = getProfile(channel)
      assert.ok(packages.split(/\r?\n/).includes(`package:${profile.androidAppId}`))
      await device.shell(`am force-stop ${profile.androidAppId}`)
      await device.shell(`am start -n ${profile.androidAppId}/cc.stellarformation.mememeow.android.MainActivity`)
      const view = await device.webView({ pkg: profile.androidAppId }, { timeout: 60_000 })
      const page = await view.page()
      await page.waitForURL(`${profile.serverUrl}/**`, { timeout: 60_000 })
      await page.locator('#app').waitFor({ timeout: 60_000 })
      const requested = page.waitForRequest((request) => new URL(request.url()).pathname === '/auth/session')
      await page.reload()
      const request = await requested
      assert.equal(new URL(request.url()).origin, profile.serverUrl)
      const response = await request.response()
      assert.ok([200, 401].includes(response.status()), `API 响应状态：${response.status()}`)
      console.log(`${profile.productName}: ${profile.androidAppId}，${page.url()}，API ${response.status()}`)
    }
    console.log('Android 双版本检查通过：同时安装、各自启动、默认网站与 API 地址。')
  } finally {
    await device.close()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
