# 桌面 GIF 剪贴板验证

验证日期：2026-10-05。运行环境：Linux x64、Electron 44.4.5、独立 X11 会话。

## 功能

- 检索结果点击复制使用桌面 GIF 接口，保留图片完整字节；原图和固定尺寸沿用网站的图片导出地址。
- 右键菜单复制当前图片地址对应的 GIF 内容。静态图片沿用原生图片复制；网页 PNG/JPEG 复制保持 PNG 输出。
- Windows 同时提供 `image/gif` 原始系统格式和 GIF 文件引用；Electron 将 `text/uri-list` 写入系统文件剪贴板格式 `CF_HDROP`。macOS 使用 `com.compuserve.gif` 原始系统格式。
- Windows GIF 文件保存在用户数据目录的 `gif-clipboard/gif-*/MemeMeow.gif`，内容保持原始字节。每次复制使用独立文件，文件在应用退出后保留，供目标程序读取和重复粘贴。
- GIF 接口只接受当前网站的前台主窗口；限制文件大小为 64 MiB，并使用 omggif 检查 GIF 结构与图片帧。

## 检查结果（2026-10-05）

- `npm test`：18 项通过。
- 开源前端与 Server 前端的 `typecheck`、构建及图片尺寸和 HTTP 错误测试均通过；每套相关测试为 11 项。
- `npm run test:gif:live`：通过实际前端图片复制模块与系统剪贴板，验证 GIF 字节一致、两帧图像、帧时长、透明背景和循环设置。
- 真实右键菜单输入、PNG/JPEG 复制、空数据与超限数据拒绝、其他窗口拒绝、后台窗口拒绝均通过。
- `npm run test:e2e`：PNG 剪贴板双向传递、原生粘贴、窗口隔离及桌面设置回归检查通过。
- Windows x64 ZIP 构建通过；包内 GIF 模块、主进程、preload、omggif 依赖和 ZIP 内的 app.asar 已核验。

Windows 与 macOS 的原生运行尚未验证。

Windows GIF 文件剪贴板路径尚未运行验证。

## 前端同步

- 开源 commit：`970f6b99ffe1b2109068cb4f6ef133ec8e1d9814`。
- Server 合并 commit：`f874347b63c0b6ae4df75549cb1648ea9bf42051`。
- `git merge-base --is-ancestor` 验证通过：开源 commit 是 Server HEAD 的祖先。
- 同步范围：`useImageClipboard.ts`、`nativeClipboard.ts`、`docs/search-image-export.md`。
- Server 开发服务已通过该工作区的 `./start.sh start` 更新，项目身份为 `mememeow-server`，健康检查通过。
