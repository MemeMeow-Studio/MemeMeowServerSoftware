/** 验证桌面偏好设置的磁盘持久化和不受信任输入的边界。 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { defaultSettings, validateSettings, readSettings, writeSettings } = require('../src/settings.cjs')

test('用户自定义快捷键和后台运行设置在重新读取后保持一致', () => {
  const local = path.resolve(__dirname, '../.local')
  fs.mkdirSync(local, { recursive: true })
  const directory = fs.mkdtempSync(path.join(local, 'settings-'))
  assert.deepEqual(readSettings(directory), defaultSettings())
  const value = { shortcut: 'Control+Shift+F9', shortcutEnabled: false, runInBackground: false }
  writeSettings(directory, value)
  assert.deepEqual(readSettings(directory), value)
  fs.writeFileSync(path.join(directory, 'desktop-settings.json'), '{invalid')
  assert.throws(() => readSettings(directory), SyntaxError)
})

test('拒绝无修饰键、重复修饰键、无效按键和错误字段类型', () => {
  for (const shortcut of ['M', 'Shift+M', 'Control+Control+M', 'Alt+Unknown', 'Control+']) {
    assert.throws(() => validateSettings({ ...defaultSettings(), shortcut }), /desktop_shortcut_invalid/)
  }
  assert.throws(() => validateSettings({ ...defaultSettings(), runInBackground: 'false' }), /desktop_settings_invalid/)
  assert.equal(validateSettings({ ...defaultSettings('darwin'), shortcut: 'Command+Alt+K' }, 'darwin').shortcut, 'Command+Alt+K')
  assert.equal(validateSettings({ ...defaultSettings('darwin'), shortcut: 'Alt+Command+M' }, 'darwin').shortcut, defaultSettings('darwin').shortcut)
})
