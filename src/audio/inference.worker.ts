/// <reference lib="webworker" />
import * as tf from '@tensorflow/tfjs'
import { setThreadsCount, setWasmPaths } from '@tensorflow/tfjs-backend-wasm'
import type { AnalysisProgress, AudioAnalysis, AudioFrame, WorkerResponse } from './types'
import { addWaveformPeaks, readMono16k, readWavInfo } from './wav'
import { embedBatch } from './yamnet'
import { fingerprintFile } from './fingerprint'

const scope = self as unknown as DedicatedWorkerGlobalScope
const RATE = 16000
const HOP = 7680
// The 0.96 s mel patch needs an extra 0.015 s to finish its last STFT window.
const WINDOW = 15600
const BATCH = 24
const CACHE_KEY = 'indexeddb://soundseed-yamnet-tfjs-v1'

function progress(phase: AnalysisProgress['phase'], amount: number, message: string) {
  scope.postMessage({
    type: 'progress',
    progress: { phase, progress: amount, message },
  } satisfies WorkerResponse)
}

async function loadModel(): Promise<tf.GraphModel> {
  progress('loading-model', 0, '正在准备本地声音模型…')
  setWasmPaths(`${import.meta.env.BASE_URL}models/tfjs-wasm/`)
  if (!scope.crossOriginIsolated) setThreadsCount(1)
  try {
    if (!(await tf.setBackend('wasm'))) throw new Error('WASM unavailable')
    await tf.ready()
  } catch {
    await tf.setBackend('cpu')
    await tf.ready()
  }
  try {
    const model = await tf.loadGraphModel(CACHE_KEY)
    progress('loading-model', 1, '已从浏览器缓存载入 YAMNet。')
    return model
  } catch {
    /* First use, cleared storage, or private browsing. */
  }
  let model: tf.GraphModel
  try {
    model = await tf.loadGraphModel(`${import.meta.env.BASE_URL}models/yamnet/model.json`, {
      onProgress: (amount) => progress('loading-model', amount, '正在载入本机的 YAMNet 模型…'),
    })
  } catch {
    throw new Error(
      'YAMNet 模型尚未安装或文件不完整。请在项目中运行 pnpm setup:model，重启后重试。录音始终保留在本机。',
    )
  }
  try {
    await model.save(CACHE_KEY)
  } catch {
    /* Inference works even if persistent storage is unavailable. */
  }
  return model
}

export async function analyze(file: File): Promise<AudioAnalysis> {
  progress('reading', 0, '正在读取 WAV 文件信息…')
  const info = await readWavInfo(file)
  if (info.duration < 0.1) throw new Error('请选择至少 0.1 秒长的 WAV 录音。')
  const sourceId = await fingerprintFile(file, (amount) =>
    progress('reading', amount, `正在确认录音身份 · ${Math.round(amount * 100)}%`),
  )
  progress(
    'reading',
    1,
    `已确认录音身份 · ${info.channels} 声道 · ${info.sampleRate.toLocaleString()} Hz`,
  )
  const model = await loadModel()
  const totalSamples = Math.ceil(info.duration * RATE)
  const frameCount = Math.max(1, Math.ceil(Math.max(0, totalSamples - WINDOW) / HOP) + 1)
  const peaks = new Float32Array(Math.min(16000, Math.max(256, Math.ceil(info.duration * 50))))
  const frames: AudioFrame[] = []
  try {
    for (let first = 0; first < frameCount; first += BATCH) {
      const count = Math.min(BATCH, frameCount - first)
      const start = first * HOP
      const sampleLength = WINDOW + (count - 1) * HOP
      const samples = await readMono16k(file, info, start, sampleLength)
      addWaveformPeaks(peaks, samples, start, totalSamples)
      const vectors = await embedBatch(model, samples, count)
      for (let row = 0; row < count; row++) {
        const index = first + row
        frames.push({
          index,
          start: index * 0.48,
          end: Math.min(info.duration, index * 0.48 + 0.96),
          embedding: vectors[row],
        })
      }
      progress(
        'analyzing',
        (first + count) / frameCount,
        `正在本机聆听 · ${Math.min(info.duration, (first + count) * 0.48).toFixed(0)} / ${info.duration.toFixed(0)} 秒`,
      )
    }
    return {
      fileName: file.name,
      sourceId,
      duration: info.duration,
      sampleRate: RATE,
      sourceSampleRate: info.sampleRate,
      sourceChannels: info.channels,
      frames,
      peaks,
      model: 'yamnet',
      backend: tf.getBackend(),
    }
  } finally {
    model.dispose()
  }
}

scope.onmessage = async ({ data }: MessageEvent<{ file: File }>) => {
  try {
    const analysis = await analyze(data.file)
    scope.postMessage({ type: 'result', analysis } satisfies WorkerResponse, [
      analysis.peaks.buffer,
      ...analysis.frames.map((frame) => frame.embedding.buffer),
    ])
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '声音分析失败，请重试。',
    } satisfies WorkerResponse)
  }
}
