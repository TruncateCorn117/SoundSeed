import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, copyFile, rename } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = join(root, 'public/models/yamnet')
const upstream = 'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1/'
const require = createRequire(import.meta.url)
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex')
// Pin the exact public Google v1 artifact, including every weight shard.
const expected = {
  'model.json': '552a4e59884a7fad25dbdbc1bbe75af2a416bca44de12523081d4b55606d59d3',
  'group1-shard1of4.bin': '2ba509dbfc875e0483e5e3f6935cd9be9f986dd1219796c649422fd337dde4ca',
  'group1-shard2of4.bin': 'b789c08119ef33a534475b964c25447586e18328039c06322d4b5337887d1fca',
  'group1-shard3of4.bin': '464a4a19cfb207c81bbd6ba079d2f36402902c07faa8b6d305f438dc0ab74212',
  'group1-shard4of4.bin': '311fcb65f9985e825a9f162b7ef82bdc81a745bff11f90bd7b1eaabbd1f55e6b',
}

function verify(name, bytes) {
  if (!expected[name] || digest(bytes) !== expected[name])
    throw new Error(
      `Checksum mismatch for ${name}. The model has not been installed; retry or check the upstream artifact.`,
    )
}

async function download(name) {
  const target = join(destination, name)
  const response = await fetch(`${upstream}${name}?tfjs-format=file`, {
    signal: AbortSignal.timeout(120000),
  })
  if (!response.ok) throw new Error(`Download of ${name} failed (${response.status}).`)
  const bytes = Buffer.from(await response.arrayBuffer())
  verify(name, bytes)
  await writeFile(`${target}.download`, bytes)
  await rename(`${target}.download`, target)
  return bytes
}

await mkdir(destination, { recursive: true })
let model
try {
  const bytes = await readFile(join(destination, 'model.json'))
  verify('model.json', bytes)
  model = JSON.parse(bytes.toString('utf8'))
  if (model.format !== 'graph-model' || !model.weightsManifest?.length)
    throw new Error('Invalid existing manifest')
  console.log('Using the installed YAMNet v1 manifest.')
} catch {
  console.log('Downloading the official Google YAMNet TFJS v1 model…')
  model = JSON.parse((await download('model.json')).toString('utf8'))
  if (model.format !== 'graph-model' || !model.weightsManifest?.length)
    throw new Error('The upstream URL did not return a TFJS graph model.')
}

const checksums = {}
for (const group of model.weightsManifest) {
  for (const name of group.paths) {
    if (!/^group\d+-shard\d+of\d+\.bin$/.test(name))
      throw new Error(`Unexpected model weight path: ${name}`)
    let bytes
    try {
      bytes = await readFile(join(destination, name))
      verify(name, bytes)
    } catch {
      console.log(`Downloading ${name}…`)
      bytes = await download(name)
    }
    checksums[name] = digest(bytes)
    console.log(`${name}: ${(bytes.length / 1048576).toFixed(2)} MiB`)
  }
}
checksums['model.json'] = digest(await readFile(join(destination, 'model.json')))
await writeFile(
  join(destination, 'provenance.json'),
  JSON.stringify(
    {
      model: 'Google YAMNet TFJS v1',
      source: `${upstream}model.json?tfjs-format=file`,
      license: 'Apache-2.0',
      sha256: checksums,
    },
    null,
    2,
  ) + '\n',
)
const licensePath = join(destination, 'LICENSE')
try {
  const license = await readFile(licensePath, 'utf8')
  if (!license.includes('Apache License') || !license.includes('Version 2.0'))
    throw new Error('Missing license')
} catch {
  const response = await fetch('https://www.apache.org/licenses/LICENSE-2.0.txt', {
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error('Could not download the Apache 2.0 license.')
  const license = await response.text()
  if (!license.includes('Apache License') || !license.includes('Version 2.0'))
    throw new Error('The license download was incomplete.')
  await writeFile(licensePath, license)
}
await writeFile(
  join(destination, 'NOTICE'),
  [
    'YAMNet pretrained model: Copyright The TensorFlow Authors / Google.',
    'Licensed under the Apache License, Version 2.0. See LICENSE.',
    `Original model: ${upstream}`,
    'Source: https://github.com/tensorflow/models/tree/master/research/audioset/yamnet',
    'The pretrained model and weight shards are redistributed unchanged.',
    '',
  ].join('\n'),
)

const wasmSource = dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json'))
const wasmDestination = join(root, 'public/models/tfjs-wasm')
await mkdir(wasmDestination, { recursive: true })
await copyFile(licensePath, join(wasmDestination, 'LICENSE'))
for (const name of [
  'tfjs-backend-wasm.wasm',
  'tfjs-backend-wasm-simd.wasm',
  'tfjs-backend-wasm-threaded-simd.wasm',
]) {
  await copyFile(join(wasmSource, 'dist', name), join(wasmDestination, name))
}
console.log('YAMNet and its WASM runtime are ready. Recordings are processed on this device.')
