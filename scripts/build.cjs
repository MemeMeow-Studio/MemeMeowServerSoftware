const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { getProfile } = require('../src/profile.cjs')

const project = path.resolve(__dirname, '..')

function run(executable, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code !== 0) reject(new Error(`client_command_failed: ${executable} (${signal ?? code})`))
      else resolve()
    })
  })
}

async function main() {
  const [channel, target, ...args] = process.argv.slice(2)
  const profile = getProfile(channel)
  if (!['desktop', 'android', 'start'].includes(target)) throw new Error(`client_target_invalid: ${target}`)
  if (target !== 'desktop' && args.length) throw new Error('client_arguments_invalid: 此目标不接收额外参数')
  const temporary = path.join(project, '.local', 'temp', channel)
  await fs.mkdir(temporary, { recursive: true })
  const env = { ...process.env, MEMEMEOW_CHANNEL: profile.channel, TMPDIR: temporary, TMP: temporary, TEMP: temporary }
  if (target === 'start') {
    await run(require('electron'), [project], project, env)
    return
  }
  if (target === 'desktop') {
    if (process.platform === "linux") Object.assign(env, { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", LC_CTYPE: "C.UTF-8" })
    await run(process.execPath, [require.resolve('electron-builder/cli.js'), '--config', 'electron-builder.config.cjs', ...args], project, env)
    return
  }
  const builds = path.join(project, '.local', 'build')
  await fs.mkdir(builds, { recursive: true })
  const android = await fs.mkdtemp(path.join(builds, `android-${channel}-`))
  await fs.cp(path.join(project, 'android'), android, {
    recursive: true,
    filter: (source) => !['build', '.gradle', 'local.properties'].includes(path.basename(source)),
  })
  env.MEMEMEOW_ANDROID_PATH = android
  env.MEMEMEOW_PROJECT_ROOT = project
  env.JAVA_TOOL_OPTIONS = `${process.env.JAVA_TOOL_OPTIONS ?? ''} -Djava.io.tmpdir=${temporary}`.trim()
  await run(process.execPath, [require.resolve('@capacitor/cli/bin/capacitor'), 'sync', 'android'], project, env)
  await run(process.execPath, [path.join(project, 'scripts/android-icons.cjs'), channel], project, env)
  const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
  await run(gradle, ['assembleDebug', `-Djava.io.tmpdir=${temporary}`], android, env)
  const output = path.join(project, 'dist', 'android', channel)
  await fs.mkdir(output, { recursive: true })
  const name = channel === 'prod' ? 'app-debug.apk' : `MemeMeow-Dev-${require('../package.json').version}-android.apk`
  await fs.copyFile(path.join(android, 'app/build/outputs/apk/debug/app-debug.apk'), path.join(output, name))
  console.log(`Android ${profile.productName}: ${path.join(output, name)}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
