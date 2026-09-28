/** 桌面偏好设置的校验和文件保存；登录启动状态直接由系统管理。 */
const fs = require('node:fs')
const path = require('node:path')

/** 根据系统提供默认快捷键；返回可保存的本机偏好设置。 */
function defaultSettings(platform = process.platform) {
  return {
    shortcut: platform === 'darwin' ? 'Command+Alt+M' : 'Control+Alt+M',
    shortcutEnabled: true,
    runInBackground: true,
  }
}

/** 限制输入为普通组合键，避免将无修饰的文字输入注册成全局快捷键。 */
function validateSettings(value, platform = process.platform) {
  if (!value || typeof value !== 'object'
    || typeof value.shortcutEnabled !== 'boolean' || typeof value.runInBackground !== 'boolean'
    || typeof value.shortcut !== 'string') {
    throw new Error('desktop_settings_invalid: 桌面设置字段类型不正确。')
  }
  const parts = value.shortcut.split('+')
  const key = parts.pop()
  const allowedModifiers = platform === 'darwin' ? ['Control', 'Command', 'Alt', 'Shift'] : ['Control', 'Alt', 'Shift', 'Super']
  const validKey = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Enter|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|Minus|,|\.|\/|;|'|\[|\]|\\|`)$/.test(key)
  if (!validKey || !parts.length || !parts.every((part) => allowedModifiers.includes(part))
    || new Set(parts).size !== parts.length || !parts.some((part) => part !== 'Shift')) {
    throw new Error('desktop_shortcut_invalid: 请选择包含 Ctrl、Alt、Command 或 Windows 键的组合键。')
  }
  const shortcut = [...allowedModifiers.filter((part) => parts.includes(part)), key].join('+')
  return { shortcut, shortcutEnabled: value.shortcutEnabled, runInBackground: value.runInBackground }
}

/** 首次启动使用默认设置；已有文件损坏时保留文件并报告具体错误。 */
function readSettings(directory) {
  const file = path.join(directory, 'desktop-settings.json')
  if (!fs.existsSync(file)) return defaultSettings()
  return validateSettings(JSON.parse(fs.readFileSync(file, 'utf8')))
}

/** 用同目录文件替换完整设置，防止中断写入留下不完整的 JSON。 */
function writeSettings(directory, value) {
  const settings = validateSettings(value)
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, 'desktop-settings.json')
  fs.writeFileSync(`${file}.next`, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(`${file}.next`, file)
}

module.exports = { defaultSettings, validateSettings, readSettings, writeSettings }
