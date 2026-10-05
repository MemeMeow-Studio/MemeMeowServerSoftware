const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const sharp = require('sharp')
const yaml = require('js-yaml')
const { getProfile } = require('../src/profile.cjs')
const { defaultSettings, readSettings } = require('../src/settings.cjs')

test('两个构建目标使用独立身份、地址、图标和快捷键', () => {
  const prod = getProfile('prod')
  const dev = getProfile('dev')
  assert.equal(prod.serverUrl, 'https://mememeow.cc')
  assert.equal(dev.serverUrl, 'https://mememeow-dev.stellarformation.cc')
  assert.equal(dev.productName, 'MemeMeow Dev')
  for (const key of ['productName', 'desktopAppId', 'androidAppId', 'assets', 'partition']) assert.notEqual(prod[key], dev[key])
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.notEqual(defaultSettings(platform, 'prod').shortcut, defaultSettings(platform, 'dev').shortcut)
  }
  assert.throws(() => getProfile('unknown'), /client_channel_invalid/)
  const local = path.resolve(__dirname, '../.local')
  fs.mkdirSync(local, { recursive: true })
  const directory = fs.mkdtempSync(path.join(local, 'profile-settings-'))
  assert.deepEqual(readSettings(directory, 'dev'), defaultSettings(process.platform, 'dev'))
})

test('Electron 构建配置写入身份并分别选择资源和输出目录', () => {
  for (const channel of ['prod', 'dev']) {
    const profile = getProfile(channel)
    const result = execFileSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./electron-builder.config.cjs')))"], {
      cwd: path.resolve(__dirname, '..'), env: { ...process.env, MEMEMEOW_CHANNEL: channel }, encoding: 'utf8',
    })
    const config = JSON.parse(result)
    assert.equal(config.extraMetadata.mememeowChannel, channel)
    assert.equal(config.appId, profile.desktopAppId)
    assert.equal(config.productName, profile.productName)
    assert.equal(config.icon, path.join(profile.assets, 'icon.png'))
    assert.equal(config.directories.output, channel === 'dev' ? 'dist/dev' : 'dist')
    assert.equal(config.artifactName, channel === 'dev' ? 'MemeMeow-Dev-${version}-${os}-${arch}.${ext}' : '${productName}-${version}-${os}-${arch}.${ext}')
  }
})

test('Capacitor 实际加载配置时写入各自网站、应用 ID 和工程目录', () => {
  for (const channel of ['prod', 'dev']) {
    const profile = getProfile(channel)
    const android = path.resolve(__dirname, `../.local/android-config-${channel}`)
    const env = { ...process.env, MEMEMEOW_CHANNEL: channel, MEMEMEOW_ANDROID_PATH: android }
    delete env.MEMEMEOW_ANDROID_URL
    const result = execFileSync(process.execPath, ['-e', "require('@capacitor/cli/dist/config').loadConfig().then(config => console.log(JSON.stringify(config.app.extConfig)))"], {
      cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8',
    })
    const config = JSON.parse(result)
    assert.equal(config.appId, profile.androidAppId)
    assert.equal(config.appName, profile.productName)
    assert.equal(new URL(config.server.url).origin, profile.serverUrl)
    assert.equal(config.android.path, android)
  }
})

test('开发图标包含 dev 标记且各平台图标已生成', async () => {
  assert.match(fs.readFileSync(path.resolve(__dirname, '../assets/dev/icon.svg'), 'utf8'), />dev</)
  for (const name of ['icon.png', 'icon.ico', 'icon.icns', 'tray.png', 'trayTemplate.png', 'trayTemplate@2x.png']) {
    assert.ok(fs.statSync(path.resolve(__dirname, '../assets/dev', name)).size > 0)
  }
  assert.equal((await sharp(path.resolve(__dirname, '../assets/dev/icon.png')).metadata()).width, 1024)
})

test('CI 分别构建两组产物，正式 Release 只下载正式包', () => {
  const workflow = yaml.load(fs.readFileSync(path.resolve(__dirname, '../.github/workflows/build.yml'), 'utf8'))
  for (const [job, artifact] of [['windows', 'windows-x64'], ['macos', 'macos-x64-arm64'], ['android', 'android-apk']]) {
    const upload = workflow.jobs[job].steps.find((step) => step.uses === 'actions/upload-artifact@v4')
    assert.equal(upload.with.name, artifact)
  }
  const development = workflow.jobs.development.strategy.matrix.include
  assert.deepEqual(development.map((item) => item.artifact), ["windows-dev-x64", "macos-dev-x64-arm64", "windows-dev-arm64", "linux-dev-x64", "android-dev-apk"])
  assert.deepEqual(workflow.jobs.release.needs, ["windows", "windows-arm64", "macos", "linux", "android"])
  const downloads = workflow.jobs.release.steps.filter((step) => step.uses === 'actions/download-artifact@v4')
  assert.deepEqual(downloads.map((step) => step.with.name), ["windows-x64", "windows-arm64", "macos-x64-arm64", "linux-x64", "android-apk"])
  assert.ok(downloads.every((step) => !step.with.pattern))
})
