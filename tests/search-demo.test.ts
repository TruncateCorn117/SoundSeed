import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import * as tf from '@tensorflow/tfjs'
import { setThreadsCount, setWasmPaths } from '@tensorflow/tfjs-backend-wasm'
import { createDoorbellDemo } from '../src/audio/demo'
import { readMono16k, readWavInfo } from '../src/audio/wav'
import { embedBatch } from '../src/audio/yamnet'
import { createExample, evaluateEvents, searchFrames } from '../src/search'
import type { Frame } from '../src/search'

const directory = resolve('public/models/yamnet')
it.skipIf(!existsSync(resolve(directory, 'model.json')))(
  'measures demo retrieval using real local YAMNet embeddings',
  async () => {
    setWasmPaths(resolve('public/models/tfjs-wasm') + '/')
    setThreadsCount(1)
    await tf.setBackend('wasm')
    await tf.ready()
    const definition = JSON.parse(readFileSync(resolve(directory, 'model.json'), 'utf8'))
    const buffer = Buffer.concat(
      definition.weightsManifest.flatMap((group: { paths: string[] }) =>
        group.paths.map((path) => readFileSync(resolve(directory, path))),
      ),
    )
    const model = await tf.loadGraphModel(
      tf.io.fromMemory({
        modelTopology: definition.modelTopology,
        weightSpecs: definition.weightsManifest.flatMap(
          (group: { weights: tf.io.WeightsManifestEntry[] }) => group.weights,
        ),
        weightData: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      }),
    )
    try {
      const demo = createDoorbellDemo()
      const info = await readWavInfo(demo.file)
      const frameCount = Math.max(
        1,
        Math.ceil(Math.max(0, Math.ceil(info.duration * 16000) - 15600) / 7680) + 1,
      )
      const frames: Frame[] = []
      for (let first = 0; first < frameCount; first += 24) {
        const count = Math.min(24, frameCount - first)
        const samples = await readMono16k(demo.file, info, first * 7680, 15600 + (count - 1) * 7680)
        const vectors = await embedBatch(model, samples, count)
        for (let row = 0; row < count; row++) {
          const index = first + row
          frames.push({
            start: index * 0.48,
            end: Math.min(info.duration, index * 0.48 + 0.96),
            embedding: vectors[row],
          })
        }
      }
      const positives = demo.suggestedExamples.map((range, i) =>
        createExample(frames, range, 'positive', `positive-${i}`, 'demo'),
      )
      const before = searchFrames(frames, positives, { sourceId: 'demo' })
      const distractor = [...before.candidates]
        .filter(
          (candidate) =>
            !demo.truth.some(
              (event) =>
                Math.min(candidate.end, event.end) > Math.max(candidate.start, event.start),
            ),
        )
        .sort((a, b) => b.score - a.score)[0]
      expect(distractor).toBeDefined()
      const negative = createExample(frames, distractor, 'negative', 'negative-0', 'demo')
      const after = searchFrames(frames, [...positives, negative], { sourceId: 'demo' })
      const options = { excludeRegions: [...positives, negative] }
      const beforeMetrics = evaluateEvents(before.candidates, demo.truth, info.duration, options)
      const afterMetrics = evaluateEvents(after.candidates, demo.truth, info.duration, options)
      // A deterministic synthetic regression, never a claim of real-world accuracy.
      // The rejected interval is removed from BOTH measurements: improvement must
      // come from other events rather than merely hiding the user's chosen example.
      expect(frames).toHaveLength(187)
      expect(before.candidates).toHaveLength(9)
      expect(after.candidates).toHaveLength(5)
      expect(beforeMetrics).toMatchObject({
        truePositives: 5,
        falsePositives: 3,
        falseNegatives: 0,
        recall: 1,
      })
      expect(afterMetrics).toMatchObject({
        truePositives: 5,
        falsePositives: 0,
        falseNegatives: 0,
        recall: 1,
      })
      expect(beforeMetrics.evaluatedHours * 3600).toBeCloseTo(85.94)
      expect(beforeMetrics.falsePositivesPerHour).toBeCloseTo(125.669)
      expect(afterMetrics.falsePositivesPerHour).toBe(0)
    } finally {
      model.dispose()
    }
  },
  120_000,
)
