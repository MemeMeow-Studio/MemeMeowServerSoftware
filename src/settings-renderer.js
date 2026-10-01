/** 本地设置表单：录入组合键并通过专用桥接接口保存本机偏好。 */
const form = document.querySelector('#settings-form')
const controls = document.querySelector('#controls')
const login = document.querySelector('#open-at-login')
const background = document.querySelector('#run-in-background')
const enabled = document.querySelector('#shortcut-enabled')
const shortcut = document.querySelector('#shortcut')
const restore = document.querySelector('#restore-shortcut')
const status = document.querySelector('#status')
let state
let accelerator

/** 将状态写入可访问的文本区域，不把错误内容作为 HTML。 */
function message(text, error = false) {
  status.textContent = text
  status.className = error ? 'error' : ''
}

/** 显示适合当前系统的按键名称；保存值始终使用 Electron 的名称。 */
function displayShortcut() {
  shortcut.value = accelerator.replace('Control', 'Ctrl').replace('Command', '⌘ Command').replace('Super', 'Windows')
  if (state.platform === 'darwin') shortcut.value = shortcut.value.replace('Alt', 'Option')
  shortcut.disabled = !enabled.checked
  restore.disabled = !enabled.checked
}

/** 从实际状态初始化表单，系统不支持的登录启动选项保持禁用。 */
function populate(value) {
  state = value
  document.title = `${state.productName} · 桌面设置`
  document.querySelector('header img').src = state.icon
  accelerator = state.shortcut
  login.checked = state.login.enabled
  login.disabled = !state.login.supported
  background.checked = state.runInBackground
  enabled.checked = state.shortcutEnabled
  document.querySelector('#login-hint').textContent = state.login.message || '启动后在后台运行，可从托盘或菜单栏显示窗口。'
  displayShortcut()
}

/** 录入期间暂时暂停本应用全局快捷键，允许用户重新输入当前组合键。 */
async function recording(value) {
  try { await window.desktopSettings.record(value) } catch (error) { message(error.message, true) }
}

shortcut.addEventListener('focus', () => { void recording(true) })
shortcut.addEventListener('blur', () => { void recording(false) })
window.addEventListener('blur', () => { void recording(false) })
window.addEventListener('focus', () => { if (document.activeElement === shortcut && !shortcut.disabled) void recording(true) })
shortcut.addEventListener('keydown', (event) => {
  if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) return
  event.preventDefault()
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
  if (!event.ctrlKey && !event.altKey && !event.metaKey) {
    message('请同时按住 Ctrl、Alt、Command 或 Windows 键。', true)
    return
  }
  const named = {
    Space: 'Space', Tab: 'Tab', Enter: 'Enter', Escape: 'Escape', Backspace: 'Backspace',
    Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Equal: 'Plus', Minus: 'Minus', Comma: ',', Period: '.', Slash: '/', Semicolon: ';',
    Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`',
  }
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5)
      : /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code) ? event.code : named[event.code]
  if (!key) { message('暂不支持这个按键，请选择字母、数字、方向键或功能键。', true); return }
  accelerator = [event.ctrlKey && 'Control', event.metaKey && state.platform === 'darwin' && 'Command',
    event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && state.platform !== 'darwin' && 'Super', key].filter(Boolean).join('+')
  displayShortcut()
  message('组合键已录入，保存后生效。')
})
enabled.addEventListener('change', displayShortcut)
restore.addEventListener('click', () => { accelerator = state.defaultShortcut; displayShortcut(); message('已选择默认快捷键，保存后生效。') })
form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const input = { shortcut: accelerator, shortcutEnabled: enabled.checked, runInBackground: background.checked, openAtLogin: login.checked }
  controls.disabled = true
  try {
    await window.desktopSettings.record(false)
    const result = await window.desktopSettings.save(input)
    if (!result.ok) { message(result.error, true); return }
    populate(result.state)
    message(result.state.login.status === 'requires-approval' ? `设置已保存。${result.state.login.message}` : '设置已保存。')
  } catch (error) { message(error.message, true) } finally { controls.disabled = false }
})
window.desktopSettings.read().then((value) => {
  populate(value)
  controls.disabled = false
  if (value.shortcutError) message(value.shortcutError, true)
}).catch((error) => message(error.message, true))
