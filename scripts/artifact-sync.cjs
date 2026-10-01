const assert = require('node:assert/strict')
const fs = require('node:fs')
const { promises: files } = fs
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const AdmZip = require('adm-zip')

const projectDirectory = path.resolve(__dirname, '..')
const repository = 'MemeMeow-Studio/MemeMeowServerSoftware'
const tokenPath = path.join(os.homedir(), '.config/mememeow-artifact-sync/github-token')
const maxFileSize = 2 * 1024 * 1024 * 1024
const installers = [
  { artifact: 'windows-x64', job: 'windows', pattern: /^MemeMeow-([0-9][A-Za-z0-9.+-]*)-win-x64\.exe$/, alias: 'MemeMeow-win-x64.exe', label: 'Windows x64' },
  { artifact: 'macos-x64-arm64', job: 'macos', pattern: /^MemeMeow-([0-9][A-Za-z0-9.+-]*)-mac-x64\.dmg$/, alias: 'MemeMeow-mac-x64.dmg', label: 'macOS Intel x64' },
  { artifact: 'macos-x64-arm64', job: 'macos', pattern: /^MemeMeow-([0-9][A-Za-z0-9.+-]*)-mac-arm64\.dmg$/, alias: 'MemeMeow-mac-arm64.dmg', label: 'macOS Apple Silicon arm64' },
  { artifact: 'android-apk', job: 'android', pattern: /^app-debug\.apk$/, alias: 'MemeMeow-android.apk', label: 'Android' },
]

function readToken(filename = tokenPath) {
  const metadata = fs.lstatSync(filename)
  assert(metadata.isFile(), 'Token 必须保存为普通文件')
  if (process.platform !== 'win32') {
    assert.equal(metadata.mode & 0o777, 0o600, 'Token 文件权限必须为 0600')
    assert.equal(metadata.uid, process.getuid(), 'Token 文件必须属于当前用户')
  }
  const token = fs.readFileSync(filename, 'utf8').trim()
  assert(token.length > 0 && !/\s/.test(token), '请在 Token 文件中保存一个有效的 GitHub Token')
  return token
}

function apiHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    'User-Agent': 'MemeMeow-artifact-sync',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function requestJson(endpoint, token) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${endpoint}`, {
    headers: apiHeaders(token), signal: AbortSignal.timeout(60000),
  })
  assert(response.ok, `GitHub API 请求失败：HTTP ${response.status}，接口 ${endpoint}`)
  return response.json()
}

async function listItems(endpoint, key, token, parameters = '') {
  const items = []
  for (let page = 1; ; page += 1) {
    const result = await requestJson(`${endpoint}?per_page=100&page=${page}${parameters}`, token)
    assert(Array.isArray(result[key]), `GitHub API 缺少 ${key}`)
    items.push(...result[key])
    if (result[key].length < 100) return items
  }
}

async function getLatestSuccessfulRun(token) {
  const result = await requestJson('actions/workflows/build.yml/runs?status=success&per_page=1&exclude_pull_requests=true', token)
  assert(Array.isArray(result.workflow_runs), 'GitHub API 缺少 workflow_runs')
  if (result.workflow_runs.length === 0) return null
  const run = result.workflow_runs[0]
  assert.equal(run.status, 'completed', '构建尚未完成')
  assert.equal(run.conclusion, 'success', '构建未成功')
  assert(Number.isSafeInteger(run.id) && run.id > 0, '构建 run_id 无效')
  assert(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, '构建 run_attempt 无效')
  assert(/^[a-f0-9]{40}$/.test(run.head_sha), '构建 commit SHA 无效')
  return run
}

async function getRunArtifacts(run, token) {
  const jobs = await listItems(`actions/runs/${run.id}/jobs`, 'jobs', token, '&filter=latest')
  const artifacts = await listItems(`actions/runs/${run.id}/artifacts`, 'artifacts', token)
  const jobNames = new Set(jobs.map(job => job.name))
  for (const jobName of ['windows', 'macos']) assert(jobNames.has(jobName), `构建缺少 ${jobName} 任务`)
  const specifications = installers.filter(installer => jobNames.has(installer.job))
  const selected = []
  for (const jobName of new Set(specifications.map(installer => installer.job))) {
    const job = jobs.find(candidate => candidate.name === jobName)
    assert.equal(job.conclusion, 'success', `${jobName} 构建未成功`)
  }
  for (const artifactName of new Set(specifications.map(installer => installer.artifact))) {
    const matches = artifacts.filter(artifact => artifact.name === artifactName)
    assert.equal(matches.length, 1, `${artifactName} 产物数量无效`)
    const artifact = matches[0]
    assert.equal(artifact.expired, false, `${artifactName} 已经过期`)
    assert.equal(artifact.workflow_run.id, run.id, `${artifactName} 来自其他构建`)
    assert(Number.isSafeInteger(artifact.id) && artifact.id > 0, 'artifact_id 无效')
    assert(artifact.size_in_bytes > 0 && artifact.size_in_bytes <= maxFileSize, `${artifactName} 文件大小无效`)
    assert(/^sha256:[a-f0-9]{64}$/.test(artifact.digest), `${artifactName} 缺少有效的 SHA-256`)
    selected.push(artifact)
  }
  return { artifacts: selected, specifications }
}

async function fileDigest(filename) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}

async function verifyDigest(filename, expected) {
  assert(/^sha256:[a-f0-9]{64}$/.test(expected), 'SHA-256 格式无效')
  assert.equal(await fileDigest(filename), expected.slice(7), '文件 SHA-256 校验失败')
}

async function downloadArtifact(artifact, filename, token) {
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`, {
    headers: apiHeaders(token), redirect: 'manual', signal: AbortSignal.timeout(60000),
  })
  assert.equal(response.status, 302, `下载 ${artifact.name} 失败：HTTP ${response.status}`)
  assert(response.headers.has('location'), '下载接口缺少重定向地址')
  const location = new URL(response.headers.get('location'))
  assert.equal(location.protocol, 'https:', '产物下载地址必须使用 HTTPS')
  assert.equal(location.username + location.password, '', '产物下载地址不能包含登录凭据')
  const archive = await fetch(location, { redirect: 'error', signal: AbortSignal.timeout(900000) })
  assert(archive.ok, `下载 ${artifact.name} 压缩文件失败：HTTP ${archive.status}`)
  assert(archive.body, '压缩文件内容为空')
  async function* limitDownload() {
    let downloadedBytes = 0
    for await (const chunk of Readable.fromWeb(archive.body)) {
      downloadedBytes += chunk.length
      assert(downloadedBytes <= maxFileSize, '压缩文件超过 2 GiB')
      yield chunk
    }
  }
  await pipeline(limitDownload(), fs.createWriteStream(filename, { flags: 'wx', mode: 0o600 }))
  await verifyDigest(filename, artifact.digest)
}

async function extractArchive(filename, directory) {
  const archive = new AdmZip(filename)
  const entries = archive.getEntries()
  assert(entries.length > 0 && entries.length <= 10, '压缩文件中的文件数量无效')
  const names = new Set()
  let extractedBytes = 0
  for (const entry of entries) {
    assert(!entry.isDirectory, '产物必须只包含安装包文件')
    assert(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(entry.entryName), '压缩文件包含无效文件名')
    const fileType = (entry.header.attr >>> 16) & 0o170000
    assert(fileType === 0 || fileType === 0o100000, '压缩文件必须只包含普通文件')
    assert(!names.has(entry.entryName), '压缩文件包含重复文件名')
    assert(!fs.existsSync(path.join(directory, entry.entryName)), '安装包文件名重复')
    names.add(entry.entryName)
    extractedBytes += entry.header.size
    assert(entry.header.size > 0 && extractedBytes <= maxFileSize, '解压文件大小无效')
    await files.writeFile(path.join(directory, entry.entryName), entry.getData(), { flag: 'wx', mode: 0o644 })
  }
  return [...names]
}

function identifyInstallers(names, specifications) {
  const identified = specifications.map(specification => {
    const matches = names.filter(name => specification.pattern.test(name))
    assert.equal(matches.length, 1, `${specification.label} 安装包数量无效`)
    const filename = matches[0]
    return { ...specification, filename, version: filename.match(specification.pattern)[1] }
  })
  assert.equal(names.length, identified.length, '产物包含未识别的文件')
  const versions = new Set(identified.filter(installer => installer.job !== 'android').map(installer => installer.version))
  if (identified.some(installer => installer.job !== 'android')) {
    assert.equal(versions.size, 1, '同一构建的安装包版本不一致')
  }
  return { installers: identified, version: [...versions][0] }
}

function renderIndex(manifest) {
  const links = manifest.files.map(file => `<li><a href="/latest/${file.alias}">${file.label}</a> <span>${(file.size / 1024 / 1024).toFixed(1)} MiB</span></li>`).join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MemeMeow 下载</title>
<style>body{font:18px system-ui,sans-serif;max-width:720px;margin:64px auto;padding:0 24px;color:#23323d;background:#f4f7fa}h1{font-size:36px}li{margin:20px 0}a{color:#1760a5}span,p{color:#52616e;font-size:15px}</style></head>
<body><h1>MemeMeow 下载</h1><p>版本 ${manifest.version} · 构建 #${manifest.run_number}</p><ul>${links}</ul>
<p>Windows 和 macOS 安装包未签名。Android APK 使用调试签名。</p>
<p><a href="/latest/manifest.json">构建信息与 SHA-256</a></p></body></html>\n`
}

async function createPublication(directory, run, artifacts, specifications, names) {
  const identified = identifyInstallers(names, specifications)
  const publishedFiles = []
  for (const installer of identified.installers) {
    const filename = path.join(directory, installer.filename)
    const metadata = await files.stat(filename)
    publishedFiles.push({ filename: installer.filename, alias: installer.alias, label: installer.label, size: metadata.size, sha256: await fileDigest(filename) })
    await files.symlink(installer.filename, path.join(directory, installer.alias))
  }
  const manifest = {
    repository, run_id: run.id, run_number: run.run_number, run_attempt: run.run_attempt,
    head_sha: run.head_sha, version: identified.version, published_at: new Date().toISOString(),
    artifacts: artifacts.map(artifact => ({ id: artifact.id, name: artifact.name, digest: artifact.digest })),
    files: publishedFiles,
  }
  await files.writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o644 })
  await files.writeFile(path.join(directory, 'index.html'), renderIndex(manifest), { flag: 'wx', mode: 0o644 })
  return manifest
}

async function activatePublication(publicDirectory, key) {
  const destination = path.join(publicDirectory, 'builds', key)
  const manifest = JSON.parse(await files.readFile(path.join(destination, 'manifest.json'), 'utf8'))
  for (const file of manifest.files) {
    await verifyDigest(path.join(destination, file.filename), `sha256:${file.sha256}`)
    assert.equal(await files.readlink(path.join(destination, file.alias)), file.filename, '安装包链接无效')
  }
  const index = path.join(publicDirectory, 'index.html')
  if (!fs.lstatSync(index, { throwIfNoEntry: false })) await files.symlink('latest/index.html', index)
  assert.equal(await files.readlink(index), 'latest/index.html', '下载首页链接无效')
  const nextLink = path.join(publicDirectory, '.latest-next')
  await files.rm(nextLink, { force: true })
  await files.symlink(`builds/${key}`, nextLink)
  await files.rename(nextLink, path.join(publicDirectory, 'latest'))
  return manifest
}

async function synchronize() {
  const token = readToken()
  const run = await getLatestSuccessfulRun(token)
  if (!run) return
  const key = `${run.id}-${run.run_attempt}`
  const publicDirectory = path.join(projectDirectory, 'publishments')
  const latest = path.join(publicDirectory, 'latest')
  if (fs.existsSync(latest) && await files.readlink(latest) === `builds/${key}`) {
    const manifest = JSON.parse(await files.readFile(path.join(latest, 'manifest.json'), 'utf8'))
    assert.equal(manifest.head_sha, run.head_sha, '已发布构建的 commit SHA 不一致')
    const index = path.join(publicDirectory, 'index.html')
    if (!fs.lstatSync(index, { throwIfNoEntry: false })) await files.symlink('latest/index.html', index)
    assert.equal(await files.readlink(index), 'latest/index.html', '下载首页链接无效')
    return
  }
  const { artifacts, specifications } = await getRunArtifacts(run, token)
  await files.mkdir(path.join(publicDirectory, 'builds'), { recursive: true, mode: 0o755 })
  const destination = path.join(publicDirectory, 'builds', key)
  if (!fs.existsSync(destination)) {
    const stateDirectory = path.join(projectDirectory, '.local/artifact-sync')
    const workDirectory = path.join(stateDirectory, key)
    await files.rm(workDirectory, { recursive: true, force: true })
    const staging = path.join(workDirectory, 'files')
    await files.mkdir(staging, { recursive: true, mode: 0o755 })
    const names = []
    for (const artifact of artifacts) {
      const archive = path.join(workDirectory, `${artifact.name}.zip`)
      await downloadArtifact(artifact, archive, token)
      const extracted = await extractArchive(archive, staging)
      identifyInstallers(extracted, specifications.filter(installer => installer.artifact === artifact.name))
      names.push(...extracted)
      await files.rm(archive)
    }
    await createPublication(staging, run, artifacts, specifications, names)
    await files.rename(staging, destination)
    await files.rm(workDirectory, { recursive: true })
  }
  const manifest = JSON.parse(await files.readFile(path.join(destination, 'manifest.json'), 'utf8'))
  assert.equal(manifest.run_id, run.id, '发布目录的 run_id 不一致')
  assert.equal(manifest.run_attempt, run.run_attempt, '发布目录的 run_attempt 不一致')
  assert.equal(manifest.head_sha, run.head_sha, '发布目录的 commit SHA 不一致')
  await activatePublication(publicDirectory, key)
  console.log(`MemeMeow ${manifest.version} 构建 #${run.run_number} 已发布，共 ${manifest.files.length} 个安装包`)
}

module.exports = {
  repository, tokenPath, installers, readToken, getLatestSuccessfulRun, getRunArtifacts,
  fileDigest, verifyDigest, extractArchive, identifyInstallers, renderIndex, activatePublication,
}

if (require.main === module) synchronize()
