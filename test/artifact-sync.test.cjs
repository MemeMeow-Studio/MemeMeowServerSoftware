const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const AdmZip = require('adm-zip')
const {
  installers, fileDigest, verifyDigest, extractArchive, identifyInstallers,
  readToken, renderIndex,
} = require('../scripts/artifact-sync.cjs')

async function testDirectory(context) {
  const parent = path.resolve(__dirname, '../.local')
  await fs.mkdir(parent, { recursive: true })
  const directory = await fs.mkdtemp(path.join(parent, 'artifact-sync-test-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  return directory
}

test('真实项目文件经过 ZIP 压缩、解压和 SHA-256 校验后内容一致', async context => {
  const directory = await testDirectory(context)
  const original = path.resolve(__dirname, '../assets/icon.png')
  const archive = new AdmZip()
  archive.addLocalFile(original)
  const zipPath = path.join(directory, 'icon.zip')
  archive.writeZip(zipPath)
  const output = path.join(directory, 'output')
  await fs.mkdir(output)
  assert.deepEqual(await extractArchive(zipPath, output), ['icon.png'])
  assert.deepEqual(await fs.readFile(path.join(output, 'icon.png')), await fs.readFile(original))
  const digest = await fileDigest(original)
  await verifyDigest(path.join(output, 'icon.png'), `sha256:${digest}`)
  await assert.rejects(verifyDigest(zipPath, `sha256:${digest}`), /SHA-256 校验失败/)
  await assert.rejects(verifyDigest(zipPath, 'invalid'), /SHA-256 格式无效/)
})

test('压缩文件中的目录与文件名冲突在写入之前产生错误', async context => {
  const directory = await testDirectory(context)
  const original = path.resolve(__dirname, '../assets/icon.png')
  const archive = new AdmZip()
  archive.addLocalFile(original, 'nested')
  const zipPath = path.join(directory, 'nested.zip')
  archive.writeZip(zipPath)
  await assert.rejects(extractArchive(zipPath, directory), /无效文件名/)
  assert.equal((await fs.readdir(directory)).includes('nested'), false)
  const flat = new AdmZip()
  flat.addLocalFile(original)
  const flatPath = path.join(directory, 'flat.zip')
  flat.writeZip(flatPath)
  await fs.copyFile(original, path.join(directory, 'icon.png'))
  await assert.rejects(extractArchive(flatPath, directory), /文件名重复/)
})

test('安装包文件名需要包含同一版本及对应系统和架构', () => {
  const desktop = installers.filter(installer => ["windows", "macos"].includes(installer.job))
  const names = ['MemeMeow-0.1.0-win-x64.exe', 'MemeMeow-0.1.0-mac-x64.dmg', 'MemeMeow-0.1.0-mac-arm64.dmg']
  const identified = identifyInstallers(names, desktop)
  assert.equal(identified.version, '0.1.0')
  assert.deepEqual(identified.installers.map(installer => installer.alias), desktop.map(installer => installer.alias))
  assert.throws(() => identifyInstallers(names.slice(0, 2), desktop), /安装包数量无效/)
  assert.throws(() => identifyInstallers([...names, 'unknown.exe'], desktop), /未识别的文件/)
  assert.throws(() => identifyInstallers(names.map(name => name.replace('0.1.0-mac-arm64', '0.2.0-mac-arm64')), desktop), /版本不一致/)
  const android = installers.filter(installer => installer.job === 'android')
  assert.equal(identifyInstallers(['app-debug.apk'], android).installers[0].alias, 'MemeMeow-android.apk')
})

test('空白 Token、符号链接和允许其他用户读取的 Token 文件产生错误', async context => {
  const directory = await testDirectory(context)
  const filename = path.join(directory, 'github-token')
  await fs.writeFile(filename, '', { mode: 0o600 })
  assert.throws(() => readToken(filename), /有效的 GitHub Token/)
  if (process.platform !== 'win32') {
    const link = path.join(directory, 'token-link')
    await fs.symlink(filename, link)
    assert.throws(() => readToken(link), /普通文件/)
    await fs.chmod(filename, 0o644)
    assert.throws(() => readToken(filename), /0600/)
  }
})

test('下载页面使用根目录地址，允许从根目录和 latest 目录访问', () => {
  const html = renderIndex({ version: '0.1.0', run_number: 4, files: [] })
  assert.match(html, /href="\/latest\/manifest\.json"/)
  assert.match(html, /版本 0\.1\.0/)
  assert.doesNotMatch(html, /github-token/)
})
