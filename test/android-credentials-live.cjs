/** 在项目测试模拟器中使用真实 APK、Keystore 和服务器验收凭据功能。 */
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const { execFile } = require("node:child_process")
const { promisify } = require("node:util")
const { _android } = require("playwright")
const { getProfile } = require("../src/profile.cjs")
const { version } = require("../package.json")
const { callCredentials, submitLogin, runSavedAccountsFlow, verifyLoginControls, verifyClearPasswords } = require("./saved-accounts-flow.cjs")
const executeFile = promisify(execFile)

/** 安装开发 APK，检查真实密文、应用重启恢复与清理后的登录状态。 */
async function main() {
  const fixture = JSON.parse(await fs.readFile(process.env.MEMEMEOW_CREDENTIAL_FIXTURE, "utf8"))
  assert.ok(["http://127.0.0.1:28275", "https://mememeow-dev.stellarformation.cc"].includes(fixture.origin))
  const devices = await _android.devices({ omitDriverInstall: true })
  const device = devices.find((candidate) => candidate.serial() === "emulator-5554")
  assert.ok(device, "credentials_android_device_missing: 请启动项目 MemeMeowTest 模拟器")
  assert.equal((await device.shell("getprop ro.boot.qemu.avd_name")).toString().trim(), "MemeMeowTest",
    "credentials_android_device_untrusted: 验收只允许项目 MemeMeowTest 模拟器")
  const project = path.resolve(__dirname, "..")
  const profile = getProfile("dev")
  const component = `${profile.androidAppId}/cc.stellarformation.mememeow.android.MainActivity`
  const preference = `shared_prefs/mememeow_credentials_v1.xml`
  try {
    const build = await executeFile(process.execPath, [path.join(project, "scripts/build.cjs"), "dev", "android"], {
      cwd: project, env: { ...process.env, MEMEMEOW_ANDROID_URL: fixture.origin }, maxBuffer: 4 * 1024 * 1024,
    })
    await fs.writeFile(path.join(project, ".local", "credentials-android-build.log"), build.stdout + build.stderr)
    await device.installApk(path.join(project, "dist/android/dev", `MemeMeow-Dev-${version}-android.apk`))
    await device.shell(`am force-stop ${profile.androidAppId}`)
    await device.shell(`am start -n ${component}`)
    let view = await device.webView({ pkg: profile.androidAppId }, { timeout: 60000 })
    let page = await view.page()
    await runSavedAccountsFlow(page, fixture)
    const contents = await device.shell(`run-as ${profile.androidAppId} cat ${preference}`)
    for (const account of fixture.accounts) assert.ok(!contents.includes(Buffer.from(account.password)), "Android 文件不得包含明文密码")
    await callCredentials(page, "record", { email: fixture.accounts[1].email })
    await device.shell(`am force-stop ${profile.androidAppId}`)
    await device.shell(`am start -n ${component}`)
    view = await device.webView({ pkg: profile.androidAppId }, { timeout: 60000 })
    page = await view.page()
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("邮箱", { exact: true }).waitFor()
    assert.ok((await callCredentials(page, "read", { email: fixture.accounts[1].email })).password === fixture.accounts[1].password)
    await page.waitForFunction((password) => document.querySelector("input[type=password]")?.value === password, fixture.accounts[1].password)
    assert.equal(await page.getByLabel("邮箱", { exact: true }).inputValue(), fixture.accounts[1].email)
    await verifyLoginControls(page)
    await page.getByLabel("邮箱", { exact: true }).fill(fixture.accounts[0].email)
    await page.getByLabel("密码", { exact: true }).fill(fixture.accounts[0].password)
    await page.getByLabel("记住密码", { exact: true }).uncheck()
    assert.equal((await submitLogin(page)).status(), 200)
    await page.waitForURL(`${fixture.origin}/search`)
    await verifyClearPasswords(page, fixture)
    const logs = (await device.shell(`logcat -d -s MemeMeowCredentials Capacitor/Plugin Capacitor/Console`)).toString()
    for (const account of fixture.accounts) assert.ok(!logs.includes(account.password), "Android 日志不得包含测试密码")
    console.log("Android 真实验收通过：登录页面控件、登录失败不保存、最近账号自动填写、Keystore 密文、应用重启恢复、取消记住密码与账户中心清理保留会话。")
  } finally {
    await device.close()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
