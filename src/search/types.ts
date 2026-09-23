/** Embeddings may stay in typed arrays; JSON-saved examples can use number arrays. */
export type Embedding = ArrayLike<number>

export interface TimeRange {
  start: number
  end: number
}

export interface Frame extends TimeRange {
  embedding: Embedding
}

export interface Example extends Frame {
  id: string
  label: 'positive' | 'negative'
  /** An opaque recording identifier, not a filename. */
  sourceId?: string
}

export interface SearchOptions {
  /** Ranking score in [0, 1], not a calibrated probability. Default: 0.7. */
  threshold?: number
  /** Join adjacent passing windows up to this gap in seconds. Default: 0.3. */
  mergeGap?: number
  minDuration?: number
  /** Used only to identify timestamp exclusions in the active recording. */
  sourceId?: string
  /** Exclude positive training regions too. Negative regions are always excluded. */
  excludeLabeledRegions?: boolean
}

export interface ScoredWindow extends TimeRange {
  score: number
  similarity: number
  /** Logistic output is an internal score, not a calibrated probability. */
  learnedScore?: number
  nearestExampleId: string
  excluded: boolean
}

export interface Candidate extends TimeRange {
  id: string
  /** Peak window ranking score. */
  score: number
  peakTime: number
  nearestExampleId: string
  windowCount: number
  /** Larger values suggest a useful next candidate to review. */
  reviewPriority: number
}

export interface SearchResult {
  candidates: Candidate[]
  windows: ScoredWindow[]
  training: {
    mode: 'similarity' | 'contrastive-logistic'
    positiveCount: number
    negativeCount: number
  }
}

export interface CandidateChange {
  before: Candidate
  after?: Candidate
  /** Peak score over the old interval, including windows now below threshold. */
  afterScore?: number
  /** Undefined only when no analyzed window overlaps the old interval. */
  scoreDelta?: number
  status: 'retained' | 'removed'
}

export interface EvaluationOptions {
  /** Boundary/onset tolerance in seconds. Default: 0.25. */
  tolerance?: number
  /** Required intersection / shorter event length. Default: 0.3. */
  minimumOverlapRatio?: number
  /** Training intervals in this recording; removed from events and exposure. */
  excludeRegions?: TimeRange[]
}

export interface EvaluationResult {
  truePositives: number
  falsePositives: number
  falseNegatives: number
  precision: number
  recall: number
  falsePositivesPerHour: number
  evaluatedHours: number
  excludedPredictions: number
  excludedEvents: number
  /** Indices refer to the original input arrays. */
  matches: { predictionIndex: number; eventIndex: number }[]
}
