/** 使用真实 Electron 验证设置表单、快捷键注册、后台运行和重启持久化。 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { _electron: electron, expect } = require('playwright/test')

/** 通过应用菜单打开真实本地设置窗口。 */
async function openSettings(application) {
  const opened = application.waitForEvent('window')
  await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().items.flatMap((menu) => menu.submenu?.items || [])
      .find((item) => item.label === '桌面设置…')
    item.click()
  })
  const page = await opened
  await page.locator('#controls:not([disabled])').waitFor()
  return page
}

/** 保存表单后确认主进程已完成系统注册和磁盘写入。 */
async function save(page) {
  await page.locator('#save').click()
  await expect(page.locator('#status')).toHaveText('设置已保存。')
}

/** 在独立用户目录运行，所有状态来自真实窗口、系统注册与磁盘文件。 */
async function main() {
  const project = path.resolve(__dirname, '..')
  const site = new URL(process.env.MEMEMEOW_DESKTOP_URL)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(site.hostname), '验收只允许本机开发服务。')
  await fs.mkdir(path.join(project, '.local'), { recursive: true })
  const directory = await fs.mkdtemp(path.join(project, '.local', 'controls-'))
  const env = { ...process.env, MEMEMEOW_DESKTOP_USER_DATA: directory }
  const launch = () => electron.launch({ args: [project], chromiumSandbox: true, env })
  let application = await launch()
  try {
    const mainPage = await application.firstWindow()
    await mainPage.waitForLoadState('domcontentloaded')
    assert.equal(await mainPage.evaluate(() => typeof window.desktopSettings), 'undefined')
    const page = await openSettings(application)
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
    assert.equal(await page.locator('#open-at-login').isDisabled(), true)
    await page.locator('#shortcut').click()
    await page.keyboard.press('Control+Shift+K')
    await expect(page.locator('#shortcut')).toHaveValue('Ctrl+Shift+K')
    await save(page)
    assert.equal(await application.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Shift+K')), true)

    // 使用真实系统注册制造竞争，验证保存失败不会注销用户正在使用的组合键。
    assert.equal(await application.evaluate(({ globalShortcut }) => globalShortcut.register('Control+Alt+Y', () => {})), true)
    await page.locator('#shortcut').click()
    await page.keyboard.press('Control+Alt+Y')
    await page.locator('#save').click()
    await expect(page.locator('#status')).toContainText('desktop_shortcut_registration_failed')
    assert.equal(await application.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Shift+K')), true)
    await application.evaluate(({ globalShortcut }) => globalShortcut.unregister('Control+Alt+Y'))
    await page.locator('#shortcut').click()
    await page.keyboard.press('Control+Shift+K')
    await save(page)
    await page.locator('#shortcut-enabled').uncheck()
    await save(page)
    assert.equal(await application.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Shift+K')), false)
    await page.locator('#shortcut-enabled').check()
    await page.locator('#restore-shortcut').click()
    await save(page)
    const defaults = process.platform === 'darwin' ? 'Command+Alt+M' : 'Control+Alt+M'
    assert.equal(await application.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), defaults), true)
    await page.locator('#shortcut').click()
    await page.keyboard.press('Control+Shift+K')
    await save(page)
    await page.close()

    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false)
    const child = spawn(require('electron'), [project], { env, stdio: 'ignore' })
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
    assert.equal(code, 0)
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
    assert.equal(application.windows().length, 1)
    await application.close()

    application = await launch()
    await application.firstWindow()
    const reopened = await openSettings(application)
    await expect(reopened.locator('#shortcut')).toHaveValue('Ctrl+Shift+K')
    assert.equal(await application.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Shift+K')), true)
    await reopened.locator('#run-in-background').uncheck()
    await save(reopened)
    await reopened.close()
    const closed = application.waitForEvent('close')
    await application.firstWindow().then((page) => page.close())
    await closed
    application = null
    const saved = JSON.parse(await fs.readFile(path.join(directory, 'desktop-settings.json'), 'utf8'))
    assert.equal(saved.runInBackground, false)
    console.log('真实桌面检查通过：录入、冲突提示、停用、恢复默认、设置持久化、关闭后隐藏、单实例唤出和完整退出。')
  } finally {
    if (application) await application.close()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
