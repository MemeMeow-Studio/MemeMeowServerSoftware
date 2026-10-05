# 安装包自动下载

服务器每分钟查询 `MemeMeow-Studio/MemeMeowServerSoftware` 的 `build.yml`，下载最新成功运行的安装包。服务器主动连接 GitHub。

公开目录为 `/home/infstellar/vscode/MemeMeowServerSoftware/publishments`。下载、SHA-256 校验、ZIP 解压和安装包检查全部成功后，原子更新 `latest` 符号链接。安装包保存在 `builds/<run_id>-<run_attempt>/`，已有版本继续保留。

同一运行必须具备 Windows x64 和 macOS 安装包。如果工作流包含 Windows ARM64、Linux 或 Android 任务，也必须具备对应产物。Linux 任务需要同时提供 AppImage、DEB 和 RPM。新增任务出现之前的成功构建继续按其已有任务同步。下载文件来自同一次运行；各个桌面安装包的版本必须一致。压缩文件及解压后的文件总量分别限制为 2 GiB。

## 创建 GitHub Token

1. 登录有权访问该仓库的 GitHub 账号，打开个人头像 → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**。
2. **Token name** 填写 `MemeMeow artifact downloads`，**Expiration** 选择符合组织要求的有效期，并在到期前更新服务器上的 Token。
3. **Resource owner** 选择 `MemeMeow-Studio`。仓库当前属于这个组织。
4. **Repository access** 选择 **Only select repositories**，只选择 `MemeMeowServerSoftware`。
5. 在 **Repository permissions** 中添加 **Actions**，权限设置为 **Read-only**。保留 GitHub 自动要求的 Metadata 读取权限。
6. 点击 **Generate token**，复制生成的 Token。如果状态为 `pending`，需要组织管理员批准后才能下载。组织未提供在 Resource owner 中时，需要组织管理员允许使用 fine-grained Token。

GitHub 官方说明：https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens

## 保存 Token

Token 文件已经创建，位置是：

```text
/home/infstellar/.config/mememeow-artifact-sync/github-token
```

使用编辑器打开这个文件：

```sh
nano /home/infstellar/.config/mememeow-artifact-sync/github-token
```

文件只保存 Token 本身，允许末尾换行。不要填写变量名、引号或 `Bearer`。保存后定时任务会自动开始同步，无须重启服务。

Token 目录权限为 `0700`，文件权限为 `0600`。Token 位于仓库和公开下载目录之外。需要恢复权限时执行：

```sh
chmod 700 /home/infstellar/.config/mememeow-artifact-sync
chmod 600 /home/infstellar/.config/mememeow-artifact-sync/github-token
```

不要将 Token 提交到 GitHub、放入 Nginx 下载目录或发送到聊天中。

## 定时任务与检查

当前用户的 crontab 已配置每分钟检查，任务内容保存在 `deploy/artifact-sync.cron`。系统 `cron` 服务负责执行，用户退出登录后继续运行。Token 文件为空时不执行下载。

手动同步一次：

```sh
cd /home/infstellar/vscode/MemeMeowServerSoftware
npm run artifacts:sync
```

多个同步进程通过 `flock` 互斥。HTTP 请求、权限、文件内容和安装包检查出现错误时，本次任务以非零状态终止；下一次计划执行会重新检查。已公开的目录只在完整检查成功后更新。

查看定时任务与日志：

```sh
crontab -l
journalctl -t mememeow-artifact-sync --since today
```

中间文件位于项目的 `.local/artifact-sync/`。`.local/` 和 `publishments/` 已加入 `.gitignore`。

## Nginx 下载目录

由用户将 `download.mememeow.cc` 的网站根目录指向：

```text
/home/infstellar/vscode/MemeMeowServerSoftware/publishments
```

Nginx 需要能够读取该目录及上级目录，并允许访问符号链接。首页为 `index.html`，安装包链接为：

- `https://download.mememeow.cc/latest/MemeMeow-win-x64.exe`
- `https://download.mememeow.cc/latest/MemeMeow-win-arm64.exe`
- `https://download.mememeow.cc/latest/MemeMeow-mac-x64.dmg`
- `https://download.mememeow.cc/latest/MemeMeow-mac-arm64.dmg`
- `https://download.mememeow.cc/latest/MemeMeow-linux-x64.AppImage`
- `https://download.mememeow.cc/latest/MemeMeow-linux-x64.deb`
- `https://download.mememeow.cc/latest/MemeMeow-linux-x64.rpm`
- `https://download.mememeow.cc/latest/MemeMeow-android.apk`

Windows ARM64、Linux 和 Android 链接在包含对应任务的成功构建同步完成后提供。`latest/manifest.json` 记录来源仓库、构建编号、commit SHA、安装包大小和 SHA-256。原始安装包文件名可以通过 `builds/<run_id>-<run_attempt>/` 下载。

首页、`latest/` 下的文件和符号链接使用禁止缓存或要求重新校验的响应头。版本目录可以长期缓存。APK 下载使用 `application/vnd.android.package-archive`，安装包可设置 `Content-Disposition: attachment`。

## 验证

```sh
npm test
npm run test:artifacts:live
```

常规测试使用真实项目文件检查 ZIP 解压、SHA-256 校验、文件名、安装包版本，以及 Linux 和 macOS 的 Token 文件权限。集成检查访问真实 GitHub API，并使用已有 `android/app/build/outputs/apk/debug/app-debug.apk` 验证解压、本机 HTTP 下载和公开目录切换，需要预先构建 Android APK。

完整的 GitHub 压缩文件下载需要在服务器保存有权限的 Token，然后运行 `npm run artifacts:sync`。
