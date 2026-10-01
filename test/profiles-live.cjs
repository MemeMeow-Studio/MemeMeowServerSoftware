const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { _electron: electron, expect } = require('playwright/test')
const { getProfile } = require('../src/profile.cjs')
const { defaultSettings } = require('../src/settings.cjs')

async function main() {
  assert.equal(process.platform, 'linux', '此检查使用 Linux 应用目录。')
  const project = path.resolve(__dirname, '..')
  const local = path.join(project, '.local')
  await fs.mkdir(local, { recursive: true })
  const directory = await fs.mkdtemp(path.join(local, 'profiles-live-'))
  const env = { ...process.env, XDG_CONFIG_HOME: directory, TMPDIR: directory, TMP: directory, TEMP: directory }
  delete env.MEMEMEOW_DESKTOP_URL
  delete env.MEMEMEOW_DESKTOP_USER_DATA
  const applications = []
  try {
    for (const channel of ['prod', 'dev']) {
      const profile = getProfile(channel)
      const executablePath = path.join(project, channel === 'prod' ? 'dist/linux-unpacked' : 'dist/dev/linux-unpacked', 'mememeow-desktop')
      const runtimeEnv = { ...env, MEMEMEOW_CHANNEL: channel === 'dev' ? 'prod' : 'dev' }
      const application = await electron.launch({ executablePath, chromiumSandbox: true, env: runtimeEnv, timeout: 60_000 })
      applications.push({ application, profile, executablePath, env: runtimeEnv })
      const page = await application.firstWindow()
      await page.waitForURL(`${profile.serverUrl}/**`, { timeout: 60_000 })
      await page.locator('#app').waitFor()
      const state = await application.evaluate(({ app, BrowserWindow, globalShortcut, session }, expected) => ({
        packaged: app.isPackaged, name: app.getName(), directory: app.getPath('userData'),
        title: BrowserWindow.getAllWindows()[0].getTitle(),
        partitionMatches: BrowserWindow.getAllWindows()[0].webContents.session === session.fromPartition(expected.partition),
        registered: globalShortcut.isRegistered(expected.shortcut),
      }), { partition: profile.partition, shortcut: defaultSettings(process.platform, channel).shortcut })
      assert.equal(state.packaged, true)
      assert.equal(state.name, profile.productName)
      if (channel === 'dev') assert.equal(state.title, profile.productName)
      assert.equal(state.directory, path.join(directory, profile.productName))
      assert.equal(state.partitionMatches, true)
      assert.equal(state.registered, true)
      const requested = page.waitForRequest((request) => new URL(request.url()).pathname === '/auth/session')
      await page.reload()
      const request = await requested
      assert.equal(new URL(request.url()).origin, profile.serverUrl)
      const response = await request.response()
      assert.ok([200, 401].includes(response.status()), `API 响应状态：${response.status()}`)
      await application.evaluate(async ({ BrowserWindow }, value) => {
        await BrowserWindow.getAllWindows()[0].webContents.session.cookies.set({
          url: 'https://mememeow.cc', name: 'mememeow-profile-check', value,
        })
      }, channel)
      const opened = application.waitForEvent('window')
      await application.evaluate(({ Menu }) => {
        Menu.getApplicationMenu().items.flatMap((item) => item.submenu?.items ?? [])
          .find((item) => item.label === '桌面设置…').click()
      })
      const settings = await opened
      await settings.locator('#controls:not([disabled])').waitFor()
      assert.equal(await settings.title(), `${profile.productName} · 桌面设置`)
      assert.ok((await settings.locator('header img').getAttribute('src')).includes(profile.assets))
      await settings.locator('#run-in-background').uncheck()
      await settings.locator('#save').click()
      await expect(settings.locator('#status')).toHaveText('设置已保存。')
      await settings.close()
      const saved = JSON.parse(await fs.readFile(path.join(state.directory, 'desktop-settings.json'), 'utf8'))
      assert.equal(saved.shortcut, defaultSettings(process.platform, channel).shortcut)
      assert.equal(saved.runInBackground, false)
      console.log(`${profile.productName}: ${page.url()}，API ${response.status()}，${state.directory}`)
    }
    for (const { application, profile, executablePath, env: runtimeEnv } of applications) {
      const cookies = await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.session.cookies.get({ name: 'mememeow-profile-check' }))
      assert.equal(cookies.length, 1)
      assert.equal(cookies[0].value, profile.channel)
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
      const child = spawn(executablePath, [], { env: runtimeEnv, stdio: 'ignore' })
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', resolve)
      })
      assert.equal(code, 0)
      await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
      assert.equal(application.windows().length, 1)
    }
    console.log('双版本真实检查通过：默认网站与 API、独立名称与数据目录、Cookie 隔离、不同默认快捷键、设置保存、各自单实例唤出。')
  } finally {
    for (const { application } of applications.reverse()) await application.close()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
