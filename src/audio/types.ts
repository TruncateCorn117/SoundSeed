export interface TimeRange {
  start: number
  end: number
}

export interface AudioFrame extends TimeRange {
  index: number
  /** L2-normalized, 1024-dimensional pretrained YAMNet embedding. */
  embedding: Float32Array
}

export interface AudioAnalysis {
  fileName: string
  /** Versioned content identity; unaffected by renaming or changed timestamps. */
  sourceId: string
  duration: number
  sampleRate: 16000
  sourceSampleRate: number
  sourceChannels: number
  frames: AudioFrame[]
  /** Uniformly spaced absolute waveform maxima; values are in [0, 1]. */
  peaks: Float32Array
  model: 'yamnet'
  backend: string
}

export interface AnalysisProgress {
  phase: 'reading' | 'loading-model' | 'analyzing'
  /** Progress within this phase, in [0, 1]. */
  progress: number
  message: string
}

export interface DemoRecording {
  file: File
  truth: TimeRange[]
  suggestedExamples: TimeRange[]
}

export type WorkerResponse =
  | { type: 'progress'; progress: AnalysisProgress }
  | { type: 'result'; analysis: AudioAnalysis }
  | { type: 'error'; message: string }
