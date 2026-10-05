/** 使用真实 Electron、系统密码服务与开发服务器验收账号凭据功能。 */
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const { spawn, execFile } = require("node:child_process")
const { promisify } = require("node:util")
const { randomBytes } = require("node:crypto")
const { chromium } = require("playwright")
const { callCredentials, submitLogin, runSavedAccountsFlow, verifyLoginControls, verifyClearPasswords, openAccountPage } = require("./saved-accounts-flow.cjs")
const executeFile = promisify(execFile)

/** 直接启动应用进程，使用 CDP 操作真实窗口和真实系统密码服务。 */
async function launchApplication(project, environment, options = {}) {
  const child = spawn(require("electron"), [project, "--remote-debugging-port=0",
    `--password-store=${options.passwordStore ?? "gnome-libsecret"}`], {
    env: { ...process.env, ...environment }, stdio: ["ignore", "pipe", "pipe"],
  })
  const exited = new Promise((resolve) => { child.once("exit", resolve); child.once("error", resolve) })
  let diagnostics = ""
  const endpoint = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`credentials_app_start_timeout: ${diagnostics}`)), 30000)
    child.once("error", (error) => { clearTimeout(timer); reject(error) })
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`credentials_app_start_exit: ${code}: ${diagnostics}`)) })
    child.stderr.on("data", (data) => {
      diagnostics += data.toString()
      const match = diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
    child.stdout.resume()
  })
  let connection
  try {
    connection = await chromium.connectOverCDP(await endpoint)
    const context = connection.contexts()[0]
    const page = context.pages()[0] ?? await context.waitForEvent("page")
    return {
      page,
      close: async () => {
        try { await connection.close() } finally {
          if (child.exitCode === null && child.signalCode === null) child.kill()
          await exited
        }
      },
    }
  } catch (error) {
    child.kill()
    await exited
    throw error
  }
}

/** 在独立 D-Bus 会话中启用真实系统密码服务，不访问日常使用的密码集合。 */
async function startKeyring(directory) {
  const control = path.join(directory, "control")
  const runtime = path.join(directory, "runtime")
  await fs.mkdir(control, { mode: 0o700 })
  await fs.mkdir(runtime, { mode: 0o700 })
  const environment = { XDG_DATA_HOME: directory, XDG_RUNTIME_DIR: runtime, GNOME_KEYRING_CONTROL: control }
  const keyring = spawn("gnome-keyring-daemon", ["--control-directory", control, "--foreground", "--components=secrets", "--unlock"], {
    env: { ...process.env, ...environment }, stdio: ["pipe", "pipe", "pipe"],
  })
  const exited = new Promise((resolve) => { keyring.once("exit", resolve); keyring.once("error", resolve) })
  let diagnostics = ""
  let environmentOutput = ""
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("credentials_keyring_timeout")), 15000)
    keyring.once("error", reject)
    keyring.once("exit", (code) => reject(new Error(`credentials_keyring_exit: ${code}`)))
    keyring.stdout.on("data", (data) => {
      environmentOutput += data.toString()
      if (environmentOutput.includes("GNOME_KEYRING_CONTROL=")) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  keyring.stderr.on("data", (data) => { diagnostics += data.toString() })
  keyring.stdin.end(`${randomBytes(32).toString("hex")}\n`)
  try {
    await ready
    await executeFile("gdbus", ["wait", "--session", "--timeout=15", "org.freedesktop.secrets"])
    const service = await executeFile("gdbus", ["introspect", "--session", "--dest", "org.freedesktop.secrets", "--object-path", "/org/freedesktop/secrets"])
    await fs.writeFile(path.join(directory, "service-interface.txt"), service.stdout)
  } catch (error) {
    keyring.kill()
    await exited
    throw new Error(`credentials_keyring_start_failed: ${error.message}; ${diagnostics}`)
  }
  return { environment, close: async () => { keyring.kill(); await exited } }
}

/** 用真实 FIFO 暂停文件读取，恢复时提供同一份凭据数据；回调用于连续暂停读取。 */
async function blockCredentialRead(filename) {
  const contents = await fs.readFile(filename)
  const original = `${filename}.reading`
  await fs.rename(filename, original)
  await executeFile("mkfifo", ["-m", "600", filename])
  const opened = fs.open(filename, "w")
  let released = false
  return {
    opened,
    release: async (afterRestore) => {
      if (released) return
      released = true
      const keeper = await fs.open(filename, "r+")
      const writer = await opened
      await fs.rename(original, filename)
      if (afterRestore) await afterRestore()
      await writer.writeFile(contents)
      await writer.close()
      await keeper.close()
    },
  }
}

/** 通过真实 Router 导航检查登录请求和本机保存期间的页面保护。 */
async function verifyLoginNavigation(page, fixture, filename) {
  await page.goto(`${fixture.origin}/login`)
  await page.waitForFunction((email) => document.querySelector("input[type=email]")?.value === email, fixture.accounts[0].email)
  await page.getByLabel("密码", { exact: true }).fill(fixture.accounts[0].password)
  await page.getByLabel("记住密码", { exact: true }).check()
  const client = await page.context().newCDPSession(page)
  const blocked = await blockCredentialRead(filename)
  const checkNavigation = async () => {
    for (const target of ["/forgot-password", "/account"]) {
      await page.evaluate((target) => document.querySelector("#app").__vue_app__.config.globalProperties.$router.push(target), target)
      assert.equal(new URL(page.url()).pathname, "/login", "提交期间需要保留当前登录页面")
    }
  }
  try {
    await client.send("Network.emulateNetworkConditions", {
      offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1,
    })
    assert.equal((await submitLogin(page, async () => {
      await page.getByRole("button", { name: "提交中...", exact: true }).waitFor()
      await checkNavigation()
    })).status(), 200)
    await blocked.opened
    await page.getByRole("button", { name: "已登录", exact: true }).waitFor()
    assert.equal(await page.getByLabel("密码", { exact: true }).inputValue(), "")
    await checkNavigation()
    await blocked.release()
    await page.waitForURL(`${fixture.origin}/search`)
  } finally {
    await blocked.release()
    await client.send("Network.emulateNetworkConditions", {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    })
    await client.detach()
  }
}

/** 真实读取被延迟时更改邮箱，旧结果不能覆盖当前表单输入。 */
async function verifyReadCancellation(page, fixture, filename) {
  await callCredentials(page, "list")
  const blocked = await blockCredentialRead(filename)
  let passwordRead
  try {
    await page.goto(`${fixture.origin}/login`)
    await blocked.opened
    await blocked.release(async () => { passwordRead = await blockCredentialRead(filename) })
    await passwordRead.opened
    assert.ok(await page.getByLabel("密码", { exact: true }).isDisabled())
    await page.getByLabel("邮箱", { exact: true }).fill(fixture.accounts[1].email)
    await page.getByLabel("密码", { exact: true }).fill(fixture.accounts[1].password)
    await passwordRead.release()
    await callCredentials(page, "list")
    assert.equal(await page.getByLabel("邮箱", { exact: true }).inputValue(), fixture.accounts[1].email)
    assert.ok(await page.getByLabel("密码", { exact: true }).inputValue() === fixture.accounts[1].password)
    assert.ok(!await page.getByLabel("记住密码", { exact: true }).isChecked())
  } finally {
    await blocked.release()
    await passwordRead?.release()
  }
}

/** 账户中心清理等待真实读取完成时禁用清理按钮，完成后保留账号与会话。 */
async function verifyPendingClear(page, fixture, filename) {
  await openAccountPage(page, fixture)
  await page.getByRole("button", { name: "清理已保存密码", exact: true }).waitFor()
  const before = (await callCredentials(page, "list")).accounts
  const blocked = await blockCredentialRead(filename)
  const reading = callCredentials(page, "read", { email: fixture.accounts[1].email })
  try {
    await blocked.opened
    page.once("dialog", (dialog) => dialog.accept())
    await page.getByRole("button", { name: "清理已保存密码", exact: true }).click()
    await page.getByRole("button", { name: "正在清理...", exact: true }).waitFor()
    assert.ok(await page.getByRole("button", { name: "正在清理...", exact: true }).isDisabled())
    await blocked.release()
    await reading
    await page.locator("[data-sonner-toast]").filter({ hasText: "已清除本应用全部保存密码" }).waitFor()
    assert.deepEqual((await callCredentials(page, "list")).accounts, before)
    assert.ok((await callCredentials(page, "read", { email: fixture.accounts[1].email })).password === null)
    const session = await page.evaluate(async () => {
      const response = await fetch("/auth/session")
      return { status: response.status, body: await response.json() }
    })
    assert.equal(session.status, 200)
    assert.equal(session.body.account.email, fixture.accounts[0].email)
    await callCredentials(page, "save", fixture.accounts[0])
    await callCredentials(page, "save", fixture.accounts[1])
  } finally {
    await blocked.release()
    await reading
  }
}

/** 账号列表读取期间输入其他账号，读取完成后保留用户输入。 */
async function verifyInitializationInput(page, fixture, filename) {
  const before = (await callCredentials(page, "list")).accounts
  const blocked = await blockCredentialRead(filename)
  try {
    await page.goto(`${fixture.origin}/login`)
    await blocked.opened
    await verifyLoginControls(page)
    await page.getByLabel("邮箱", { exact: true }).fill(fixture.accounts[1].email)
    await page.getByLabel("密码", { exact: true }).fill(fixture.accounts[1].password)
    await blocked.release()
    assert.deepEqual((await callCredentials(page, "list")).accounts, before)
    assert.equal(await page.getByLabel("邮箱", { exact: true }).inputValue(), fixture.accounts[1].email)
    assert.ok(await page.getByLabel("密码", { exact: true }).inputValue() === fixture.accounts[1].password)
    assert.ok(!await page.getByLabel("记住密码", { exact: true }).isChecked())
  } finally {
    await blocked.release()
  }
}

/** 检查真实文件密文、重启恢复、源页面隔离以及磁盘故障后的登录结果。 */
async function main() {
  const fixture = JSON.parse(await fs.readFile(process.env.MEMEMEOW_CREDENTIAL_FIXTURE, "utf8"))
  assert.ok(["http://127.0.0.1:28275", "https://mememeow-dev.stellarformation.cc"].includes(fixture.origin))
  const project = path.resolve(__dirname, "..")
  const directory = await fs.mkdtemp(path.join(project, ".local", "credentials-live-"))
  const keyringDirectory = path.join(directory, "keyring")
  await fs.mkdir(keyringDirectory)
  const keyring = await startKeyring(keyringDirectory)
  const { environment } = keyring
  let application
  let browser
  const launch = () => launchApplication(project, {
    ...environment, MEMEMEOW_CHANNEL: "dev", MEMEMEOW_DESKTOP_URL: fixture.origin,
    MEMEMEOW_DESKTOP_USER_DATA: path.join(directory, "application"),
  })
  try {
    application = await launch()
    let page = application.page
    await runSavedAccountsFlow(page, fixture)
    const filename = path.join(directory, "application", "saved-accounts.json")
    const contents = await fs.readFile(filename, "utf8")
    for (const account of fixture.accounts) assert.ok(!contents.includes(account.password), "文件不得包含明文密码")
    assert.equal((await fs.stat(filename)).mode & 0o777, 0o600)
    await verifyLoginNavigation(page, fixture, filename)

    await page.evaluate(() => new Promise((resolve) => {
      const frame = document.createElement("iframe")
      frame.addEventListener("load", () => resolve(), { once: true })
      frame.srcdoc = "<p>凭据接口隔离检查</p>"
      document.body.append(frame)
    }))
    assert.ok(await page.evaluate(() => document.querySelector("iframe").contentWindow.mememeowCredentials === undefined))

    await application.close()
    application = await launch()
    page = application.page
    await page.goto(`${fixture.origin}/login`)
    await page.waitForFunction((password) => document.querySelector("input[type=password]")?.value === password, fixture.accounts[0].password)
    assert.equal(await page.getByLabel("邮箱", { exact: true }).inputValue(), fixture.accounts[0].email)
    assert.ok((await callCredentials(page, "read", { email: fixture.accounts[1].email })).password === fixture.accounts[1].password)
    await verifyLoginControls(page)
    await verifyReadCancellation(page, fixture, filename)
    await verifyPendingClear(page, fixture, filename)
    await verifyInitializationInput(page, fixture, filename)
    await verifyClearPasswords(page, fixture)

    await fs.mkdir(`${filename}.new`)
    await page.goto(`${fixture.origin}/login`)
    await page.waitForFunction((email) => document.querySelector("input[type=email]")?.value === email, fixture.accounts[0].email)
    await page.getByLabel("密码", { exact: true }).fill(fixture.accounts[0].password)
    await page.getByLabel("记住密码", { exact: true }).check()
    assert.equal((await submitLogin(page)).status(), 200)
    await page.locator("[data-sonner-toast]").filter({ hasText: "登录成功，账号记录保存失败" }).waitFor()
    const session = await page.evaluate(async () => {
      const response = await fetch("/auth/session")
      return { status: response.status, body: await response.json() }
    })
    assert.equal(session.status, 200)
    assert.equal(session.body.account.email, fixture.accounts[0].email)
    assert.ok(await page.getByRole("button", { name: "已登录", exact: true }).isDisabled())
    assert.ok((await callCredentials(page, "read", { email: fixture.accounts[0].email })).password === null)
    await fs.rmdir(`${filename}.new`)
    await page.getByRole("button", { name: "进入应用", exact: true }).click()
    await page.waitForURL(`${fixture.origin}/search`)
    await application.close()
    application = await launchApplication(project, {
      ...environment, MEMEMEOW_CHANNEL: "dev", MEMEMEOW_DESKTOP_URL: fixture.origin,
      MEMEMEOW_DESKTOP_USER_DATA: path.join(directory, "application-basic"),
    }, { passwordStore: "basic" })
    page = application.page
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("邮箱", { exact: true }).fill(fixture.accounts[0].email)
    await page.getByLabel("密码", { exact: true }).fill(fixture.accounts[0].password)
    await page.getByLabel("记住密码", { exact: true }).check()
    assert.equal((await submitLogin(page)).status(), 200)
    await page.locator("[data-sonner-toast]").filter({ hasText: "登录成功，密码保存失败" }).waitFor()
    assert.ok((await callCredentials(page, "read", { email: fixture.accounts[0].email })).password === null)
    assert.deepEqual((await callCredentials(page, "list")).accounts, [fixture.accounts[0].email])
    const unencryptedSession = await page.evaluate(async () => {
      const response = await fetch("/auth/session")
      return { status: response.status, body: await response.json() }
    })
    assert.equal(unencryptedSession.status, 200)
    assert.equal(unencryptedSession.body.account.email, fixture.accounts[0].email)
    await page.getByRole("button", { name: "进入应用", exact: true }).click()
    await page.waitForURL(`${fixture.origin}/search`)

    browser = await chromium.launch({ ignoreDefaultArgs: ["--password-store=basic", "--use-mock-keychain"] })
    const ordinaryPage = await browser.newPage()
    await ordinaryPage.goto(`${fixture.origin}/login`)
    await ordinaryPage.getByLabel("邮箱", { exact: true }).waitFor()
    assert.equal(await ordinaryPage.getByLabel("记住密码", { exact: true }).count(), 0)
    assert.ok(await ordinaryPage.evaluate(() => window.mememeowCredentials === undefined))
    console.log("Electron 真实验收通过：登录页面控件、登录失败不保存、最近账号自动填写、密文存储、重启恢复、取消记住密码、登录导航保护、读取取消、初始化输入保护、账户中心清理保留会话、页面隔离、磁盘故障、拒绝 basic_text 后端与普通浏览器行为。")
  } finally {
    await browser?.close()
    await application?.close()
    await keyring.close()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
