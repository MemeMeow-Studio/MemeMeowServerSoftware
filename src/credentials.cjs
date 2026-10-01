/** 桌面凭据存储：记录当前服务的账号，并使用系统密码服务保护已保存密码。 */
const fs = require("node:fs/promises")
const path = require("node:path")
const { safeStorage } = require("electron")

/** 校验网页传入的账号，不把输入内容写入错误消息。 */
function requireEmail(email) {
  if (typeof email !== "string" || !email.includes("@") || email.length > 320) {
    throw new Error("credentials_email_invalid: 账号格式无效")
  }
  return email
}

/** 检查账号文件中的映射字段，拒绝无法保存具名记录的数据形状。 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** 使用独立文件保存账号与密文；串行执行操作，保证同时请求不会覆盖彼此。 */
function createCredentialStore(directory, origin) {
  const filename = path.join(directory, "saved-accounts.json")
  let pending = Promise.resolve()

  /** 新安装没有记录时返回空集合；损坏、权限和读取错误均由调用者处理。 */
  async function readState() {
    let contents
    try { contents = await fs.readFile(filename, "utf8") } catch (error) {
      if (error.code === "ENOENT") return { version: 1, accounts: {}, passwords: {} }
      throw error
    }
    const state = JSON.parse(contents)
    if (!isRecord(state) || state.version !== 1 || !isRecord(state.accounts) || !isRecord(state.passwords)) {
      throw new Error("credentials_data_invalid: 已保存账号数据格式无效")
    }
    const accounts = state.accounts[origin]
    const passwords = state.passwords[origin]
    if ((accounts !== undefined && (!Array.isArray(accounts) || accounts.some((account) => typeof account !== "string")))
      || (passwords !== undefined && (!isRecord(passwords) || Object.values(passwords).some((password) => typeof password !== "string")))) {
      throw new Error("credentials_data_invalid: 已保存账号数据格式无效")
    }
    return state
  }

  /** 以仅当前用户可读的文件原子替换记录，写入完成后才报告成功。 */
  async function writeState(state) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    await fs.writeFile(`${filename}.new`, JSON.stringify(state), { mode: 0o600 })
    await fs.rename(`${filename}.new`, filename)
  }

  /** 保留每次请求的异常，同时释放操作顺序中的等待位置。 */
  function serialize(operation) {
    const result = pending.then(operation)
    pending = result.then(() => undefined, () => undefined)
    return result
  }

  /** 加密服务必须可用；Linux 仅接受系统密码服务提供的密钥。 */
  function requireEncryption() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("credentials_encryption_unavailable: 系统安全存储不可用，请检查系统密码服务")
    }
    if (process.platform === "linux" && ["basic_text", "unknown"].includes(safeStorage.getSelectedStorageBackend())) {
      throw new Error("credentials_password_service_missing: 请启用系统密码服务")
    }
  }

  return {
    /** 返回当前服务的账号列表，最近登录的账号位于首项。 */
    list: () => serialize(async () => ({ accounts: (await readState()).accounts[origin] ?? [] })),
    /** 登录成功后更新账号顺序，不修改其他服务的记录。 */
    record: ({ email }) => serialize(async () => {
      requireEmail(email)
      const state = await readState()
      const accounts = state.accounts[origin] ?? []
      state.accounts[origin] = [email, ...accounts.filter((account) => account !== email)]
      await writeState(state)
    }),
    /** 读取选定账号的密码；不存在已保存密码时返回 null。 */
    read: ({ email }) => serialize(async () => {
      requireEmail(email)
      const encrypted = (await readState()).passwords[origin]?.[email]
      if (encrypted === undefined) return { password: null }
      requireEncryption()
      return { password: safeStorage.decryptString(Buffer.from(encrypted, "base64")) }
    }),
    /** 将登录验证成功的密码加密保存到当前服务与账号下。 */
    save: ({ email, password }) => serialize(async () => {
      requireEmail(email)
      if (typeof password !== "string" || !password || password.length > 1024) {
        throw new Error("credentials_password_invalid: 密码格式无效")
      }
      requireEncryption()
      const encrypted = safeStorage.encryptString(password)
      const state = await readState()
      state.passwords[origin] ??= {}
      state.passwords[origin][email] = encrypted.toString("base64")
      await writeState(state)
    }),
    /** 删除当前账号的密文，同时保留账号记录。 */
    remove: ({ email }) => serialize(async () => {
      requireEmail(email)
      const state = await readState()
      if (state.passwords[origin]) delete state.passwords[origin][email]
      await writeState(state)
    }),
    /** 清除本应用所有服务的已保存密码，保留账号记录与 Cookie 会话。 */
    clear: () => serialize(async () => {
      const state = await readState()
      state.passwords = {}
      await writeState(state)
    }),
  }
}

module.exports = { createCredentialStore }
