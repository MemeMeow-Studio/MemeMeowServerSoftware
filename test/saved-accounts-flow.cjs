/** 在真实网页和宿主接口中检查登录、自动填写、密码保存与账户中心清理。 */
const assert = require("node:assert/strict")

/** 调用当前应用真实提供的凭据接口，保持 Android 与桌面测试行为一致。 */
async function callCredentials(page, operation, options) {
  return page.evaluate(({ operation, options }) => {
    if (window.mememeowCredentials) return window.mememeowCredentials[operation](options)
    return window.Capacitor.nativePromise("MemeMeowCredentials", operation, options ?? {})
  }, { operation, options })
}

/** 等待一次真实登录响应；遇到服务端限流时遵守其 Retry-After。 */
async function submitLogin(page, beforeResponse) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const responsePromise = page.waitForResponse((response) => response.url().endsWith("/auth/sessions")
      && response.request().method() === "POST")
    await page.getByRole("button", { name: "登录", exact: true }).click()
    if (beforeResponse) await beforeResponse()
    const response = await responsePromise
    if (response.status() !== 429) {
      if (!response.ok() && response.status() !== 401) {
        const body = await response.json()
        throw new Error(`credentials_e2e_login_failed: ${response.status()}: ${body.detail?.error ?? body.error}`)
      }
      return response
    }
    const retryAfter = Number(response.headers()["retry-after"])
    assert.ok(Number.isFinite(retryAfter) && retryAfter > 0, "服务端限流需要返回明确等待时间")
    await page.waitForTimeout(retryAfter * 1000 + 100)
  }
  throw new Error("credentials_e2e_rate_limit: 等待后仍无法提交登录")
}

/** 使用服务端真实创建的账户检查成功与失败登录对本机记录的影响。 */
async function runSavedAccountsFlow(page, fixture) {
  const [first, second] = fixture.accounts
  await page.goto(`${fixture.origin}/login`)
  await page.getByLabel("记住密码", { exact: true }).waitFor()
  await verifyLoginControls(page)
  const initialAccounts = (await callCredentials(page, "list")).accounts
  assert.ok(initialAccounts.every((email) => fixture.accounts.some((account) => account.email === email)), "验收目录只能包含本次测试账号")
  const initialPassword = (await callCredentials(page, "read", { email: first.email })).password

  await page.getByLabel("邮箱", { exact: true }).fill(first.email)
  await page.getByLabel("密码", { exact: true }).fill("deliberately-wrong-e2e-password")
  await page.getByLabel("记住密码", { exact: true }).check()
  assert.equal((await submitLogin(page)).status(), 401)
  assert.deepEqual((await callCredentials(page, "list")).accounts, initialAccounts)
  assert.ok((await callCredentials(page, "read", { email: first.email })).password === initialPassword)

  await page.getByLabel("密码", { exact: true }).fill(first.password)
  assert.ok(await page.getByLabel("密码", { exact: true }).inputValue() === first.password, "提交前密码需要保持当前账号的输入")
  const firstLogin = await submitLogin(page)
  const firstLoginDetail = firstLogin.ok() ? "" : JSON.stringify(await firstLogin.json())
  assert.equal(firstLogin.status(), 200, firstLoginDetail)
  try {
    await page.waitForURL(`${fixture.origin}/search`)
  } catch (error) {
    const state = await page.evaluate(() => ({ url: location.href, text: document.body.innerText }))
    throw new Error(`${error.message}; page=${JSON.stringify(state)}`)
  }
  assert.ok((await callCredentials(page, "read", { email: first.email })).password === first.password)

  await openAccountPage(page, fixture)
  await page.getByRole("button", { name: "注销", exact: true }).click()
  await page.waitForURL(`${fixture.origin}/login`)
  await page.waitForFunction(() => document.querySelector("input[type=password]")?.value.length > 0)
  assert.equal(await page.getByLabel("邮箱", { exact: true }).inputValue(), first.email)
  assert.ok(await page.getByLabel("密码", { exact: true }).inputValue() === first.password)
  await verifyLoginControls(page)
  for (const [link, path] of [["创建账户", "/register"], ["忘记密码", "/forgot-password"]]) {
    await page.getByRole("link", { name: link, exact: true }).click()
    await page.waitForURL(`${fixture.origin}${path}`)
    await page.getByRole("link", { name: "返回登录", exact: true }).click()
    await page.waitForURL(`${fixture.origin}/login`)
    await page.waitForFunction((password) => document.querySelector("input[type=password]")?.value === password, first.password)
    assert.equal(await page.getByLabel("邮箱", { exact: true }).inputValue(), first.email)
    assert.ok(await page.getByLabel("记住密码", { exact: true }).isChecked())
    await verifyLoginControls(page)
  }

  await page.getByLabel("邮箱", { exact: true }).fill(second.email)
  assert.equal(await page.getByLabel("密码", { exact: true }).inputValue(), "")
  await page.getByLabel("密码", { exact: true }).fill(second.password)
  await page.getByLabel("记住密码", { exact: true }).check()
  assert.equal(await page.getByLabel("邮箱", { exact: true }).inputValue(), second.email)
  assert.ok(await page.getByLabel("密码", { exact: true }).inputValue() === second.password, "提交前密码需要保持当前账号的输入")
  const secondLogin = await submitLogin(page)
  const secondLoginDetail = secondLogin.ok() ? "" : JSON.stringify(await secondLogin.json())
  assert.equal(secondLogin.status(), 200, secondLoginDetail)
  await page.waitForURL(`${fixture.origin}/search`)
  assert.deepEqual((await callCredentials(page, "list")).accounts, [second.email, first.email])

  await page.goto(`${fixture.origin}/login`)
  await page.waitForFunction((password) => document.querySelector("input[type=password]")?.value === password, second.password)
  assert.equal(await page.getByLabel("邮箱", { exact: true }).inputValue(), second.email)
  await verifyLoginControls(page)
  await page.getByLabel("邮箱", { exact: true }).fill(first.email)
  assert.equal(await page.getByLabel("密码", { exact: true }).inputValue(), "")
  await page.getByLabel("密码", { exact: true }).fill(first.password)
  await page.getByLabel("记住密码", { exact: true }).uncheck()
  assert.equal((await submitLogin(page)).status(), 200)
  await page.waitForURL(`${fixture.origin}/search`)
  assert.ok((await callCredentials(page, "read", { email: first.email })).password === null)
  assert.ok((await callCredentials(page, "read", { email: second.email })).password === second.password)
}

/** 检查真实登录页面的控件范围，同时保留应用的记住密码入口。 */
async function verifyLoginControls(page) {
  assert.equal(await page.getByLabel("已保存账号", { exact: true }).count(), 0)
  assert.equal(await page.getByRole("combobox").count(), 0)
  assert.equal(await page.getByRole("button", { name: "清理已保存密码", exact: true }).count(), 0)
  assert.equal(await page.getByLabel("记住密码", { exact: true }).count(), 1)
}

/** 账户中心清理后重新请求真实 session，检查账号记录和当前登录均保留。 */
async function verifyClearPasswords(page, fixture) {
  const before = (await callCredentials(page, "list")).accounts
  const sessionBefore = await page.evaluate(async () => {
    const response = await fetch("/auth/session")
    return { status: response.status, body: await response.json() }
  })
  assert.equal(sessionBefore.status, 200, "清理验收需要当前页面已经建立真实登录会话")
  assert.equal(sessionBefore.body.account.email, fixture.accounts[0].email)
  await openAccountPage(page, fixture)
  await page.waitForURL(`${fixture.origin}/account`)
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "清理已保存密码", exact: true }).click()
  await page.locator("[data-sonner-toast]").filter({ hasText: "已清除本应用全部保存密码" }).waitFor()
  assert.deepEqual((await callCredentials(page, "list")).accounts, before)
  for (const account of fixture.accounts) {
    assert.ok((await callCredentials(page, "read", { email: account.email })).password === null)
  }
  const session = await page.evaluate(async () => {
    const response = await fetch("/auth/session")
    return { status: response.status, body: await response.json() }
  })
  assert.equal(session.status, 200)
  assert.equal(session.body.account.email, fixture.accounts[0].email)
}

/** 进入真实账户中心，等待公告读取完成，并通过确认按钮关闭当前提醒。 */
async function openAccountPage(page, fixture) {
  const bulletinResponse = page.waitForResponse((response) => response.url().endsWith("/bulletins")
    && response.request().method() === "GET")
  await page.goto(`${fixture.origin}/account`)
  assert.equal((await bulletinResponse).status(), 200)
  await page.locator(".bulletin-trigger:not([disabled])").waitFor()
  const dialog = page.getByRole("dialog", { name: "系统公告", exact: true })
  if (await dialog.isVisible()) {
    await dialog.getByRole("button", { name: "确认", exact: true }).click()
    await dialog.waitFor({ state: "hidden" })
  }
}

module.exports = { callCredentials, submitLogin, runSavedAccountsFlow, verifyLoginControls, verifyClearPasswords, openAccountPage }
