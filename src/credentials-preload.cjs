/** 业务网页的隔离接口：提供凭据管理和 GIF 复制能力。 */
const { contextBridge, ipcRenderer } = require("electron")

/** 接收主进程的明确结果，保留操作阶段和系统故障原因。 */
async function invoke(operation, options) {
  const result = await ipcRenderer.invoke("mememeow:credentials", operation, options)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld("mememeowClipboard", {
    version: 1,
    maxGifBytes: 64 * 1024 * 1024,
    copyGif: (data) => ipcRenderer.invoke("mememeow:copy-gif", data),
  })
  contextBridge.exposeInMainWorld("mememeowCredentials", {
    version: 1,
    list: () => invoke("list"),
    record: (options) => invoke("record", options),
    read: (options) => invoke("read", options),
    save: (options) => invoke("save", options),
    remove: (options) => invoke("remove", options),
    clear: () => invoke("clear"),
  })
}
