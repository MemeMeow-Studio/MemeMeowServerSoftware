# MemeMeow 客户端

Electron 窗口加载 `https://mememeow.cc`，使用网站的登录、检索和上传功能。网页更新后，桌面端重新加载页面即可使用。客户端需要网络连接。

## Android 客户端

Android 使用 Capacitor 8.5.2，支持 Android 7.0 及以上版本，加载 `https://mememeow.cc`。网站需部署包含 `nativeMedia.ts` 和 `useImageAction.ts` 的前端，才能提供下面的相册操作。

- 点击检索结果图片，将原图保存到名为 **MemeMeow** 的相册。PNG、JPEG 和 GIF 保留原始文件内容，包括 GIF 动画。保存期间显示进度提示，完成后清理下载缓存。
- 上传页面点击“选择相册图片”，打开系统照片选择器。支持多选，选择后加入待上传列表，再使用现有上传选项提交。关闭选择器可以取消本次选择。
- Android 11 及以上使用系统选择器和应用媒体目录，无须允许应用读取整个图库。Android 7–10 下载时会请求文件读写权限；拒绝权限时显示错误原因。

相册文件位于 `Android/media/cc.stellarformation.mememeow.android/MemeMeow`，由 Media 插件注册到系统图库。卸载应用可能清除这个应用目录，需要保留的图片应另外备份。

### 构建 Android APK

需要 Node.js 22.12 及以上、JDK 21、Android SDK Platform 36，并设置 `JAVA_HOME` 和 `ANDROID_HOME`：

```sh
npm ci
npm run android:build
```

APK 位于 `dist/android/prod/app-debug.apk`，使用调试签名，可以直接安装。正式发布需要配置长期保存的签名密钥，并更新 `android/app/build.gradle` 的 `versionCode` 和 `versionName`。同一应用的后续更新必须使用相同签名密钥。

`npm run android:open` 打开 Android Studio 工程。修改原生依赖或 `capacitor.config.ts` 后执行 `npm run android:sync`；修改应用图标后执行 `npm run android:icons`，并提交生成的 Android 资源。

在项目开发服务运行、设备已连接 ADB 时，可以测试本机网站：

```sh
adb reverse tcp:28275 tcp:28275
MEMEMEOW_ANDROID_URL=http://127.0.0.1:28275 npm run android:build
adb install -r dist/android/prod/app-debug.apk
```

`MEMEMEOW_ANDROID_URL` 在同步和构建时写入 APK，允许 HTTPS 或本机回环 HTTP 地址。默认地址用于线上网站；本机开发地址仅用于开发 APK。

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

## 本机账号与密码

成功登录的账号记录在应用中，登录页自动填写最近登录账号与其保存密码。使用其他账号时手动输入邮箱和密码；登录由用户提交。
勾选“记住密码”并成功登录后保存密码，取消勾选并成功登录后删除该账号保存密码。
账户中心的“清理已保存密码”清除本应用全部密码，保留账号记录和当前登录会话。

Electron 使用系统 `safeStorage`；Linux 需要可用的系统密码服务。Android 使用 Tink 和 Android Keystore，并要求 WebView 支持主页面来源验证。
密码以密文保存，凭据文件不参与 Android 备份或设备迁移。普通浏览器继续使用标准 `autocomplete`。
网站与客户端均需包含凭据接口支持；旧客户端显示升级提示。本机存储错误保留已经成功的登录会话，并显示具体操作原因。

真实凭据验收使用 `npm run test:credentials:live` 和 `npm run test:android:credentials:live`，通过 `MEMEMEOW_CREDENTIAL_FIXTURE` 指定开发服务器创建的测试账户文件。
桌面测试直接启动 Electron，使用独立 D-Bus、GNOME Keyring、控制目录和用户数据目录；Android 测试使用项目的 `MemeMeowTest` 模拟器及开发 APK。

## 开发服务器客户端

`desktop.config.json` 的 `channels.dev` 定义开发包：网站为 `https://mememeow-dev.stellarformation.cc`，加载 `/home/infstellar/vscode/MemeMeowServer` 部署的前端，API 使用网页同域名地址。客户端名称为 `MemeMeow Dev`，应用与托盘图标带有 `dev` 标记。网站页面随开发服务器部署更新。

正式包与开发包使用独立应用 ID。桌面用户数据分别保存在 `MemeMeow` 和 `MemeMeow Dev` 目录，登录会话、设置和单实例分别管理。开发包默认快捷键为 Windows/Linux 的 `Ctrl+Alt+Shift+M`、macOS 的 `Command+Option+Shift+M`。Android 开发包的 ID 为 `cc.stellarformation.mememeow.android.dev`，可以和正式包同时安装。

```sh
npm run start:dev
npm run pack:dev
npm run dist:win:dev
npm run dist:win:arm64:dev
npm run dist:win:zip:dev
npm run dist:mac:dev
npm run dist:linux:dev
npm run android:build:dev
```

桌面开发产物位于 `dist/dev/`，文件名为 `MemeMeow-Dev-{version}-{os}-{arch}.{ext}`。Android 开发产物位于 `dist/android/dev/MemeMeow-Dev-{version}-android.apk`。正式包继续使用原有桌面文件名和应用 ID。

桌面构建把目标写入安装包的 `package.json`，启动时自动选择对应配置。Android 每次构建在 `.local/build/` 内创建独立工程，分别生成 Capacitor 配置、图标和原生依赖产物；正式包与开发包可以并行构建。`MEMEMEOW_ANDROID_URL` 仍支持构建时指定本机开发地址。

GitHub Actions 在独立任务中同时构建两组客户端。开发下载项为 `windows-dev-x64`、`windows-dev-arm64`、`macos-dev-x64-arm64`、`linux-dev-x64`、`android-dev-apk`。GitHub Release 和服务器安装包同步只使用正式产物。Linux 和 Windows ARM64 任务只打包，不执行对应验收测试。

修改图标后执行 `npm run icons`，生成两个版本的图标；开发 SVG 位于 `assets/dev/`。真实桌面双版本验证使用 `npm run test:profiles:live`，需要图形会话和已完成的两个 Linux 应用目录构建。

`npm run test:packages` 检查两个版本的 Linux 应用目录、Windows ZIP 和 APK，需设置 `ANDROID_HOME` 并准备 Android Build Tools 36.0.0。`npm run test:android:profiles:live` 在 `emulator-5554` 安装并启动两个 APK，核验网站和 API 地址；可通过 `MEMEMEOW_ANDROID_SERIAL` 指定测试设备。

## 桌面设置

Windows、Linux 从“设置 → 桌面设置…”进入，macOS 从“MemeMeow → 桌面设置…”进入，也可以使用托盘或菜单栏图标打开。

- **登录系统后自动启动**：默认关闭。启用后，在用户登录系统时启动。打包后的桌面客户端提供此选项。Linux 使用 `$XDG_CONFIG_HOME/autostart/`，未设置该变量时使用 `~/.config/autostart/`；AppImage 使用原始文件路径，需要保留该文件。macOS 如果要求批准，设置页面会提示前往系统设置的“通用 → 登录项”。有可用恢复入口时后台启动，否则显示窗口。
- **显示／隐藏窗口快捷键**：Windows、Linux 默认为 `Ctrl+Alt+M`，macOS 默认为 `Command+Option+M`。窗口显示时按快捷键隐藏到托盘，隐藏或最小化时按快捷键恢复并聚焦窗口。点击输入框并按下组合键，保存后生效；支持停用和恢复默认。注册失败时显示错误，原快捷键继续有效。快捷键在客户端运行期间有效。
- **关闭窗口后继续在后台运行**：默认开启。关闭窗口会隐藏到托盘，快捷键或“显示窗口”会恢复窗口并保留页面。关闭此选项后，关闭主窗口会退出程序。

Windows、Linux 托盘和 macOS 菜单栏提供“显示窗口”“桌面设置…”和“退出 MemeMeow”。选择“退出”会结束程序并释放快捷键。重复启动客户端会显示已有窗口。

Linux 使用独立的 `.desktop` 身份关联应用窗口与 Wayland 快捷键授权。后台运行需要确认恢复入口：X11 已注册快捷键、Wayland 已实际触发的快捷键，或者存在宿主且已登记本进程图标的 StatusNotifier 托盘。缺少这些入口时关闭窗口会退出应用，后台启动会显示窗口。GNOME 托盘入口通常需要 AppIndicator 扩展。Linux 密码保存需要 GNOME Keyring 或 KDE KWallet 等系统密码服务。

快捷键和后台运行设置保存在用户数据目录的 `desktop-settings.json`；登录启动状态直接读取系统。桌面设置使用独立本地窗口，远程网站无法调用设置接口。

## 应用图标

应用、安装包、桌面快捷方式和任务栏使用倾斜的 M 图标。原始矢量文件位于 `assets/icon.svg`；macOS 菜单栏使用 `assets/trayTemplate.svg` 的单色图标，让系统适配明暗主题。

修改 SVG 后执行 `npm run icons`，生成 PNG、Windows ICO 和 macOS ICNS，并提交生成的资源。转换使用 sharp 和 electron-builder 的图标工具，首次执行可能需要下载该工具。GitHub Actions 打包时直接使用这些资源。

## 图片剪贴板

- 检索结果的“复制图片”按钮将静态图片作为 PNG 写入系统剪贴板；GIF 通过桌面接口复制完整原始内容，保留动画帧、显示时间、循环设置和透明背景。
- 图片右键菜单提供“复制图片”，复制所点击图片的实际内容。
- 在上传页面按 `Ctrl+V`，macOS 按 `Cmd+V`，将剪贴板图片加入待上传列表。也可以使用“编辑 → 粘贴（含图片）”或右键粘贴菜单。
- 网页可以通过标准 Clipboard API 读取图片；客户端只允许当前网站的前台主页面获得剪贴板读写权限。

Windows 使用系统 `image/gif` 格式，macOS 使用 `com.compuserve.gif` 格式。GIF 复制需要网站包含 `nativeClipboard.ts` 和更新后的 `useImageClipboard.ts`，并使用包含 GIF 复制接口的桌面客户端。文件大小上限为 64 MiB；数据无效或写入失败时显示具体原因。接收应用需支持对应 GIF 格式。

## 安装包

| 系统 | 架构 | 安装包 |
| --- | --- | --- |
| Windows 10、Windows 11 | x64 | `.exe`，可选择安装目录 |
| Windows on ARM | arm64 | `.exe`，可选择安装目录 |
| macOS 13 及以上 | Intel x64 | `.dmg` |
| macOS 13 及以上 | Apple Silicon arm64 | `.dmg` |
| Linux | x64 | `.AppImage`、`.deb`、`.rpm` |
| Android 7.0 及以上 | 通用 | `.apk` |

在 Windows 构建 Windows 安装包：

```sh
npm ci
npm run dist:win
```

Windows ARM64 安装包使用 `npm run dist:win:arm64` 构建。Windows ARM64 和 Linux 的最低系统要求采用当前 Electron 与 electron-builder 的默认要求。

需要解压运行的 Windows x64 发行文件时，执行 `npm run dist:win:zip`，解压整个 ZIP 后运行其中的 `MemeMeow.exe`。Linux 交叉构建 NSIS 安装程序需要可用的 Wine；ZIP 构建不需要执行 Windows 程序。

在 macOS 构建两种架构的安装包：

```sh
npm ci
npm run dist:mac
```

在 Linux 构建三种格式的安装包：

```sh
npm ci
npm run dist:linux
```

RPM 构建需要系统提供 `rpmbuild`；GitHub Actions 自动安装 RPM 构建工具。DEB 用于 Ubuntu、Debian、Linux Mint，RPM 用于 Fedora 等发行版，AppImage 用于便携运行，下载后需要为文件添加执行权限。桌面集成面向 GNOME、KDE Plasma、Xfce 和 Cinnamon。正式版与开发版使用独立的包名称、可执行文件和 `.desktop` 文件，可同时安装。

产物位于 `dist/`，文件名包含版本、系统和架构。`npm run pack` 生成当前系统的应用目录，可用于本机检查。依赖及运行时版本由 `package-lock.json` 固定。

GitHub Actions 支持手动运行 `Build client installers` 工作流，完成后从该次运行的 Artifacts 下载桌面安装包和 Android APK。发布版本时，先把 `package.json` 中的版本更新为目标版本并提交，再推送同名标签，例如版本 `0.1.0` 对应 `v0.1.0`。标签构建成功后，工作流创建包含安装包的 GitHub Release 草稿，检查安装包后可手动发布。标签版本与 `package.json` 不一致时，构建会停止。

工作流在 Windows 分别构建 x64 和 arm64 `.exe`，在 macOS 构建 x64 和 arm64 `.dmg`，在 Linux 构建 x64 AppImage、DEB 和 RPM。安装包均未签名。Windows 可能显示 SmartScreen 提示；macOS Gatekeeper 通常会阻止直接打开未签名应用。正常面向 macOS 用户发行需要 Developer ID 签名及 Apple 公证。macOS 的 DMG 构建需要 macOS 环境。

## 公网下载

服务器定时从 GitHub Actions 下载成功构建的安装包，保存到 `publishments/`，由 `download.mememeow.cc` 提供下载。Token 创建步骤、保存位置、任务检查和 Nginx 下载目录说明见 [安装包自动下载](docs/artifact-downloads.md)。手动同步使用 `npm run artifacts:sync`。

## 验证

Linux 和 Windows ARM64 本次仅执行正式版与开发版打包，不执行安装、运行和桌面集成验收。下面的已有测试命令保留，新增平台的 CI 任务不运行这些命令。

```sh
npm test
```

该命令检查地址与权限规则、设置校验和磁盘持久化。真实桌面检查需要图形会话，以及通过项目 `start.sh` 管理的本机开发服务：

```sh
MEMEMEOW_DESKTOP_URL=http://127.0.0.1:28275 npm run test:e2e
```

真实检查加载网站，验证 PNG 剪贴板双向传递和原生图片粘贴，并验证设置录入、快捷键冲突、停用、恢复默认、持久化、后台运行、单实例唤出和退出。测试使用独立用户数据目录，不登录账户、不提交业务数据。运行前请保存当前剪贴板中需要保留的内容。

GIF 检查使用 `MEMEMEOW_DESKTOP_URL=http://127.0.0.1:28275 npm run test:gif:live`。该测试读取相邻 `MemeMeowServer/frontend` 的实际图片复制模块，使用其已安装的 esbuild；可通过 `MEMEMEOW_FRONTEND_ROOT` 指定其他前端目录。测试检查 GIF 字节与动画信息、网页复制、右键处理、窗口权限，以及 PNG/JPEG 复制；Linux 原生右键菜单操作需要 `xdotool`。

## 窗口与故障处理

站内链接在应用中打开，普通外部网页链接交给系统浏览器。窗口启用沙盒、页面隔离和浏览器安全检查，网页不能访问 Node.js。非剪贴板权限默认拒绝。

页面加载失败会显示 Chromium 错误码；可以通过“文件 → 返回首页”重新加载。主进程使用 electron-log，单个日志达到 2 MiB 后轮转。默认日志位置：

- Windows：`%APPDATA%/MemeMeow/logs/main.log`
- macOS：`~/Library/Logs/MemeMeow/main.log`

指定独立用户数据目录时，日志位置按 electron-log 的当前平台规则确定。

## 本次验证记录

- Android 15 模拟器中的真实设备检查通过：网页登录、PNG／JPEG／GIF 原图保存、MemeMeow 相册在系统图库登记、下载缓存清理。
- 系统照片选择器打开、取消和三张图片多选通过；经过网页上传后，三个上传 Task 最终成功，服务端图片内容与原图一致。
- Android APK 构建成功，默认加载 `https://mememeow.cc`。设备验证使用项目已有开发服务，线上网站需要部署对应前端更新。
- 其他 Android 版本和实体手机尚未验证。
- Linux 图形会话中的真实 Electron 检查通过：开发网站加载、窗口隔离、PNG 剪贴板双向传递、原生图片粘贴。
- 地址、权限、设置、安装包同步、双版本配置和 CI 规则测试共 15 项，通过。
- 真实设置窗口检查通过：快捷键录入、冲突提示、停用、恢复默认、重启持久化、后台隐藏、单实例唤出和退出。
- X11 系统输入检查通过：后台启动与关闭窗口后保持隐藏，默认与自定义快捷键均可反复显示和隐藏窗口。
- Windows ICO、macOS ICNS 和托盘 PNG 已生成。
- 正式与开发 Linux 应用目录并行构建成功；两个真实客户端同时运行，默认网站与 API、独立名称与数据目录、Cookie 隔离、不同默认快捷键、设置保存和各自单实例唤出检查通过。
- 正式与开发 Windows ZIP、Android APK 并行构建成功，包内身份、地址和图标资源检查通过；两个 APK 的签名验证通过。
- Windows、macOS 的原生运行和登录启动尚未验证；GitHub Actions 尚未运行本次变更。
