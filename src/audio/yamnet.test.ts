import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as tf from '@tensorflow/tfjs'
import { setThreadsCount, setWasmPaths } from '@tensorflow/tfjs-backend-wasm'
import { embedBatch } from './yamnet'

const modelDirectory = resolve('public/models/yamnet')

describe('official YAMNet integration (run pnpm setup:model to enable)', () => {
  it.skipIf(!existsSync(resolve(modelDirectory, 'model.json')))(
    'runs real WASM inference, trims padding, and releases intermediate tensors',
    async () => {
      setWasmPaths(resolve('public/models/tfjs-wasm') + '/')
      setThreadsCount(1)
      await tf.setBackend('wasm')
      await tf.ready()
      const definition = JSON.parse(readFileSync(resolve(modelDirectory, 'model.json'), 'utf8'))
      const buffer = Buffer.concat(
        definition.weightsManifest.flatMap((group: { paths: string[] }) =>
          group.paths.map((path) => readFileSync(resolve(modelDirectory, path))),
        ),
      )
      const model = await tf.loadGraphModel(
        tf.io.fromMemory({
          modelTopology: definition.modelTopology,
          weightSpecs: definition.weightsManifest.flatMap(
            (group: { weights: tf.io.WeightsManifestEntry[] }) => group.weights,
          ),
          weightData: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          userDefinedMetadata: definition.userDefinedMetadata,
        }),
      )
      const baseline = tf.memory().numTensors
      try {
        const tone = Float32Array.from(
          { length: 15600 + 23 * 7680 },
          (_, i) => 0.2 * Math.sin((i * 2 * Math.PI * 784) / 16000),
        )
        const vectors = await embedBatch(model, tone, 24)
        const silence = (await embedBatch(model, new Float32Array(15600), 1))[0]
        expect(vectors).toHaveLength(24)
        expect(vectors[0]).toHaveLength(1024)
        expect(vectors.every((vector) => vector.every(Number.isFinite))).toBe(true)
        expect(vectors[0].reduce((sum, value) => sum + value * value, 0)).toBeCloseTo(1, 5)
        const similarity = vectors[0].reduce((sum, value, i) => sum + value * silence[i], 0)
        expect(similarity).toBeLessThan(0.9)
        expect(tf.memory().numTensors).toBe(baseline)
      } finally {
        model.dispose()
      }
      expect(tf.memory().numTensors).toBe(0)
    },
  )
})
