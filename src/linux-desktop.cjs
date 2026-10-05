const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { randomUUID } = require("node:crypto")
const ini = require("ini")
const dbus = require("dbus-native")

function createLinuxLogin(profile) {
  const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  assert(path.isAbsolute(config), "desktop_autostart_config_invalid: XDG_CONFIG_HOME 需要绝对路径")
  const directory = path.join(config, "autostart")
  const filename = path.join(directory, `${profile.desktopAppId}.desktop`)
  const executable = process.env.APPIMAGE || process.execPath
  assert(path.isAbsolute(executable) && !/[\u0000\r\n\t]/.test(executable), "desktop_autostart_path_invalid: 应用路径无效")

  function read() {
    if (!fs.existsSync(filename)) return { supported: true, enabled: false, message: "" }
    const entry = ini.parse(fs.readFileSync(filename, "utf8"))["Desktop Entry"]
    assert(entry?.Type === "Application" && typeof entry.Exec === "string", "desktop_autostart_entry_invalid: 登录启动文件无效")
    const enabled = entry.Hidden !== true && entry.Hidden !== "true"
      && entry["X-GNOME-Autostart-enabled"] !== false && entry["X-GNOME-Autostart-enabled"] !== "false"
    return { supported: true, enabled, message: "" }
  }

  function write(enabled) {
    if (!enabled) {
      fs.rmSync(filename, { force: true })
      return
    }
    fs.accessSync(executable, fs.constants.X_OK)
    const escaped = executable.replaceAll("\\", "\\\\\\\\").replaceAll("\"", "\\\\\"")
      .replaceAll("`", "\\\\`").replaceAll("$", "\\\\$").replaceAll("%", "%%")
    const contents = [
      "[Desktop Entry]", "Type=Application", `Name=${profile.productName}`,
      `Exec="${escaped}" --background`, "Terminal=false", "Hidden=false",
      `Icon=${profile.channel === "dev" ? "mememeow-dev" : "mememeow"}`,
      "X-GNOME-Autostart-enabled=true", "",
    ].join("\n")
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const temporary = path.join(directory, `.${profile.desktopAppId}-${randomUUID()}`)
    fs.writeFileSync(temporary, contents, { flag: "wx", mode: 0o600 })
    fs.renameSync(temporary, filename)
  }

  return { read, write }
}

async function hasLinuxTrayHost() {
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) return false
  const bus = dbus.sessionBus({ timeout: 5000 })
  try {
    const names = await bus.listNames()
    for (const watcher of ["org.kde.StatusNotifierWatcher", "org.freedesktop.StatusNotifierWatcher"]) {
      if (!names.includes(watcher)) continue
      const properties = (property) => bus.invoke({
        destination: watcher, path: "/StatusNotifierWatcher", interface: "org.freedesktop.DBus.Properties",
        member: "Get", signature: "ss", body: [watcher, property],
      }).then(dbus.variantValue)
      const host = await properties("IsStatusNotifierHostRegistered")
      assert.equal(typeof host, "boolean", "desktop_tray_host_invalid: 托盘宿主状态无效")
      if (!host) continue
      const items = await properties("RegisteredStatusNotifierItems")
      assert(Array.isArray(items), "desktop_tray_items_invalid: 托盘注册列表无效")
      for (const item of items) {
        assert.equal(typeof item, "string", "desktop_tray_item_invalid: 托盘注册项无效")
        const service = item.split("/")[0]
        assert(dbus.isValidBusName(service), "desktop_tray_service_invalid: 托盘服务名称无效")
        if (await bus.getConnectionUnixProcessId(service) === process.pid) return true
      }
    }
    return false
  } finally {
    bus.connection.end()
  }
}

module.exports = { createLinuxLogin, hasLinuxTrayHost }
