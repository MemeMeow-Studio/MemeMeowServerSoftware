# MemeMeow 桌面客户端

Electron 窗口加载 `https://mememeow.cc`，使用网站的登录、检索和上传功能。网页更新后，桌面端重新加载页面即可使用。客户端需要网络连接。

## 开发运行

需要 Node.js 22.12 及以上版本。进入本目录执行：

```sh
npm ci
npm start
```

`desktop.config.json` 的 `serverUrl` 是打包后的默认网站地址。开发时可以通过 `MEMEMEOW_DESKTOP_URL` 指定网站；地址必须使用 HTTPS，本机回环地址允许 HTTP。例如，在项目已有开发服务运行时：

```sh
MEMEMEOW_DESKTOP_URL=http://127.0.0.1:28275 npm start
```

Windows PowerShell：

```powershell
$env:MEMEMEOW_DESKTOP_URL = "http://127.0.0.1:28275"
npm start
```

登录会话保存在 Electron 的用户数据目录，关闭窗口后仍然保留。需要独立的开发数据目录时，设置 `MEMEMEOW_DESKTOP_USER_DATA`。

## 图片剪贴板

- 检索结果的“复制图片”按钮使用网页现有功能，将图片内容作为 PNG 写入系统剪贴板。
- 图片右键菜单提供“复制图片”，复制所点击图片的实际内容。
- 在上传页面按 `Ctrl+V`，macOS 按 `Cmd+V`，将剪贴板图片加入待上传列表。也可以使用“编辑 → 粘贴（含图片）”或右键粘贴菜单。
- 网页可以通过标准 Clipboard API 读取图片；客户端只允许当前网站的前台主页面获得剪贴板读写权限。

图片复制输出为静态图片，GIF 动画通过这条路径复制后不会保留动画。

## 安装包

| 系统 | 架构 | 安装包 |
| --- | --- | --- |
| Windows 10、Windows 11 | x64 | `.exe`，可选择安装目录 |
| macOS 13 及以上 | Intel x64 | `.dmg` |
| macOS 13 及以上 | Apple Silicon arm64 | `.dmg` |

在 Windows 构建 Windows 安装包：

```sh
npm ci
npm run dist:win
```

需要解压运行的 Windows 发行文件时，执行 `npm run dist:win:zip`，解压整个 ZIP 后运行其中的 `MemeMeow.exe`。在 Linux 交叉构建时，NSIS 安装程序还需要 Wine；ZIP 构建不需要执行 Windows 程序。

在 macOS 构建两种架构的安装包：

```sh
npm ci
npm run dist:mac
```

产物位于 `dist/`，文件名包含版本、系统和架构。`npm run pack` 生成当前系统的应用目录，可用于本机检查。依赖及运行时版本由 `package-lock.json` 固定。

GitHub Actions 支持手动运行 `Build desktop installers` 工作流，完成后从该次运行的 Artifacts 下载三个安装包。发布版本时，先把 `package.json` 中的版本更新为目标版本并提交，再推送同名标签，例如版本 `0.1.0` 对应 `v0.1.0`。标签构建成功后，工作流创建包含安装包的 GitHub Release 草稿，检查安装包后可手动发布。标签版本与 `package.json` 不一致时，构建会停止。

工作流在 Windows 构建 x64 `.exe`，在 macOS 构建 x64 和 arm64 `.dmg`。安装包均未签名。Windows 可能显示 SmartScreen 提示；macOS Gatekeeper 通常会阻止直接打开未签名应用。正常面向 macOS 用户发行需要 Developer ID 签名及 Apple 公证。macOS 的 DMG 构建需要 macOS 环境。

## 验证

```sh
npm test
```

该命令检查地址与权限规则。真实桌面检查需要图形会话，以及通过项目 `start.sh` 管理的本机开发服务：

```sh
MEMEMEOW_DESKTOP_URL=http://127.0.0.1:28275 npm run test:e2e
```

真实检查加载网站，并验证 PNG 在网页与 Electron 系统剪贴板之间的双向传递，以及原生粘贴产生的图片文件。测试使用独立用户数据目录，不登录账户、不提交业务数据。运行前请保存当前剪贴板中需要保留的内容。

## 窗口与故障处理

站内链接在应用中打开，普通外部网页链接交给系统浏览器。窗口启用沙盒、页面隔离和浏览器安全检查，网页不能访问 Node.js。非剪贴板权限默认拒绝。

页面加载失败会显示 Chromium 错误码；可以通过“文件 → 返回首页”重新加载。主进程使用 electron-log，单个日志达到 2 MiB 后轮转。默认日志位置：

- Windows：`%APPDATA%/MemeMeow/logs/main.log`
- macOS：`~/Library/Logs/MemeMeow/main.log`

指定独立用户数据目录时，日志位置按 electron-log 的当前平台规则确定。

## 本次验证记录

- Linux 图形会话中的真实 Electron 检查通过：开发网站加载、窗口隔离、PNG 剪贴板双向传递、原生图片粘贴。
- 地址与权限测试共 3 项，通过。
- Windows x64 ZIP 已构建，包内主进程、权限规则和网站配置已核验。
- Windows 与 macOS 的原生运行情况尚未验证；macOS DMG 尚未构建。
