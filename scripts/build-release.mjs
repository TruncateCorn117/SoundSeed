import { chmod, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = join(root, 'package.json')
const rootPackage = JSON.parse(await readFile(packagePath, 'utf8'))
const { version } = rootPackage
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
  throw new Error('Invalid package version for a release directory.')
const dist = join(root, 'dist')
const destination = join(root, 'release', `SoundSeed-v${version}`)
const staging = `${destination}.building`

async function requireFile(relative) {
  try {
    const info = await stat(join(dist, relative))
    if (!info.isFile() || !info.size) throw new Error('empty or not a file')
  } catch {
    throw new Error(
      `Missing release asset: dist/${relative}. Run pnpm setup:model, then pnpm build:release.`,
    )
  }
}

async function resolvePackage(name, fromPackage) {
  const require = createRequire(fromPackage)
  try {
    return require.resolve(`${name}/package.json`)
  } catch {
    // Packages can hide package.json behind exports; locate it from the entry.
    let directory = dirname(require.resolve(name))
    while (true) {
      const candidate = join(directory, 'package.json')
      try {
        if (JSON.parse(await readFile(candidate, 'utf8')).name === name) return candidate
      } catch {
        /* Continue through package subdirectories. */
      }
      const parent = dirname(directory)
      if (parent === directory)
        throw new Error(`Cannot locate the installed runtime package ${name}.`)
      directory = parent
    }
  }
}

async function copyRuntimeLicenses(target) {
  const seen = new Set()
  const manifest = []
  const queue = Object.keys(rootPackage.dependencies ?? {})
    .sort()
    .map((name) => ({ name, from: packagePath, optional: false }))
  while (queue.length) {
    const dependency = queue.shift()
    let installedPath
    try {
      installedPath = await resolvePackage(dependency.name, dependency.from)
    } catch (error) {
      if (dependency.optional) continue
      throw error
    }
    const installed = JSON.parse(await readFile(installedPath, 'utf8'))
    const key = `${installed.name}@${installed.version}`
    if (seen.has(key)) continue
    seen.add(key)
    const directory = dirname(installedPath)
    const safeName = key.replace(/[^a-zA-Z0-9._-]/g, '_')
    const notices = []
    async function findNotices(relative = '') {
      for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
        const path = join(relative, entry.name)
        if (
          /^(?:licen[cs]es?|copying|notices?)(?:$|[._-])/i.test(entry.name) &&
          (entry.isFile() || entry.isDirectory())
        )
          notices.push(path)
        else if (
          entry.isDirectory() &&
          entry.name !== 'node_modules' &&
          !entry.name.startsWith('.')
        )
          await findNotices(path)
      }
    }
    await findNotices()
    notices.sort()
    await mkdir(join(target, safeName), { recursive: true })
    for (const name of notices) {
      await mkdir(dirname(join(target, safeName, name)), { recursive: true })
      await cp(join(directory, name), join(target, safeName, name), { recursive: true })
    }
    const metadata = {
      name: installed.name,
      version: installed.version,
      license: installed.license ?? null,
      repository: installed.repository ?? null,
      noticeFiles: notices,
    }
    await writeFile(
      join(target, safeName, 'package-info.json'),
      JSON.stringify(metadata, null, 2) + '\n',
    )
    manifest.push({ ...metadata, directory: safeName })
    const children = { ...installed.dependencies, ...installed.optionalDependencies }
    for (const name of Object.keys(children).sort()) {
      queue.push({
        name,
        from: installedPath,
        optional: name in (installed.optionalDependencies ?? {}),
      })
    }
    // Installed peers are runtime requirements too; absent optional peers need no notice.
    for (const name of Object.keys(installed.peerDependencies ?? {}).sort()) {
      if (!(name in children)) queue.push({ name, from: installedPath, optional: true })
    }
  }
  manifest.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(
    join(target, 'README.txt'),
    'Third-party notices for installed runtime dependencies and their transitive dependencies.\nDevelopment-only dependencies are excluded. Each package@version appears once.\nOriginal available LICENSE, LICENCE, COPYING, and NOTICE files are preserved unchanged.\nSee manifest.json for package versions, declared licenses, and included notice files.\nNot every installed dependency is necessarily included in the browser bundle.\n',
  )
  return manifest.length
}

await requireFile('index.html')
await requireFile('models/yamnet/model.json')
const model = JSON.parse(await readFile(join(dist, 'models/yamnet/model.json'), 'utf8'))
if (model.format !== 'graph-model' || !model.weightsManifest?.length)
  throw new Error('The release requires a complete YAMNet graph model.')
for (const group of model.weightsManifest) {
  for (const name of group.paths) {
    if (!/^group\d+-shard\d+of\d+\.bin$/.test(name))
      throw new Error(`Unexpected model weight path: ${name}`)
    await requireFile(`models/yamnet/${name}`)
  }
}
for (const name of [
  'models/yamnet/LICENSE',
  'models/yamnet/NOTICE',
  'models/yamnet/provenance.json',
  'models/tfjs-wasm/LICENSE',
  'models/tfjs-wasm/tfjs-backend-wasm.wasm',
  'models/tfjs-wasm/tfjs-backend-wasm-simd.wasm',
  'models/tfjs-wasm/tfjs-backend-wasm-threaded-simd.wasm',
])
  await requireFile(name)

await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })
try {
  await cp(dist, join(staging, 'app'), { recursive: true })
  for (const name of ['start.py', 'Start-SoundSeed.command', 'Start-SoundSeed.bat']) {
    await cp(join(root, 'scripts', name), join(staging, name))
  }
  await chmod(join(staging, 'Start-SoundSeed.command'), 0o755)
  await chmod(join(staging, 'start.py'), 0o755)
  await cp(join(root, 'LICENSE'), join(staging, 'LICENSE'))
  await cp(join(root, 'docs'), join(staging, 'docs'), { recursive: true })
  const licenseCount = await copyRuntimeLicenses(join(staging, 'third-party-licenses'))
  await writeFile(
    join(staging, 'README.txt'),
    `SoundSeed v${version} — 圈出几段声音，搜索整条录音

这个文件夹已经包含应用、YAMNet 模型及 WASM 文件。使用时不需要 Node.js、
pnpm 或联网下载模型；需要提前安装 Python 3.8 或更新版本，以及现代桌面浏览器。
Python 只提供本机静态文件服务；音频特征提取和学习都在浏览器中完成。

开始使用
1. 解压整个压缩包，保留 app 文件夹及其内容。
2. macOS：双击 Start-SoundSeed.command。
   Windows：双击 Start-SoundSeed.bat。
   Linux / 其他方式：在此文件夹运行 python3 start.py。
3. 浏览器会自动打开。若未自动打开，复制终端显示的 http://127.0.0.1 地址。
4. 选择本地 WAV，或点击“体验门铃演示”。圈选一个完整声音，点击“设为正例”，
   再试听候选并纠正误报。结果可以导出为 CSV / JSON，声音种子可保存后复用。
5. 使用期间保持终端窗口打开；按 Ctrl+C 结束本地服务。

如果系统阻止直接双击脚本，也可在终端中运行 python3 start.py（Windows 为
py -3 start.py）。请使用正常的系统信任确认流程，不需要关闭系统安全功能。
缺少 Python 时请从 https://www.python.org/downloads/ 安装，再重新打开启动器。
请勿直接双击 app/index.html；浏览器需要通过本地 HTTP 地址加载模型与 Worker。

离线和隐私
准备好 Python 和浏览器后，可断开外网使用。本地地址只绑定 127.0.0.1，不对
局域网提供服务；服务器只能读取 app/ 内的静态文件，不接受上传。你的录音由
浏览器直接读取，不会通过这个文件服务发送。模型可能缓存于浏览器站点数据中。
刷新页面不会恢复当前标注；需要保留的声音种子和结果请先导出。

版本边界
每次搜索一个声音目标，支持 PCM / 浮点 WAV。分析速度取决于设备。候选分数
不是正确概率；合成演示不代表真实录音识别率。请用不同日期录音验证实际效果。
评估规则与标注格式见 docs/evaluation.md，首版范围见 docs/release-notes.md。

许可
应用代码采用 MIT，见 LICENSE。YAMNet 和 WASM 运行时的许可保留在
app/models/yamnet/ 与 app/models/tfjs-wasm/ 中。React、ReactDOM、Lucide、
TensorFlow.js 及其已安装运行时依赖的许可和声明保留在 third-party-licenses/，
其中 manifest.json 列出包名、版本、声明许可及保留的文件。
`,
    'utf8',
  )
  await rm(destination, { recursive: true, force: true })
  await rename(staging, destination)
  console.log(`Portable SoundSeed bundle ready: ${destination}`)
  console.log(
    `Preserved third-party notices for ${licenseCount} installed runtime package versions.`,
  )
  console.log(
    'The bundle includes local model files. Users need Python 3.8+ and a desktop browser.',
  )
} catch (error) {
  await rm(staging, { recursive: true, force: true })
  throw error
}
