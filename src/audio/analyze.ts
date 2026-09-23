import type { AnalysisProgress, AudioAnalysis, WorkerResponse } from './types'

/** A dedicated worker owns decode + inference. Abort terminates it immediately. */
export function analyzeFile(
  file: File,
  onProgress?: (progress: AnalysisProgress) => void,
  signal?: AbortSignal,
): Promise<AudioAnalysis> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Analysis cancelled.', 'AbortError'))
      return
    }
    const worker = new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' })
    const cleanUp = () => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
    }
    const abort = () => {
      cleanUp()
      reject(new DOMException('Analysis cancelled.', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'progress') onProgress?.(data.progress)
      else if (data.type === 'result') {
        cleanUp()
        resolve(data.analysis)
      } else {
        cleanUp()
        reject(new Error(data.message))
      }
    }
    worker.onerror = (event) => {
      cleanUp()
      reject(new Error(event.message || 'The audio analysis worker could not start.'))
    }
    worker.postMessage({ file })
  })
}
