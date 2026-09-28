/** 本地设置页面的最小桥接接口，不向远程网站提供任何系统能力。 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopSettings', {
  read: () => ipcRenderer.invoke('desktop-settings:read'),
  save: (settings) => ipcRenderer.invoke('desktop-settings:save', settings),
  record: (recording) => ipcRenderer.invoke('desktop-settings:record', recording),
})
