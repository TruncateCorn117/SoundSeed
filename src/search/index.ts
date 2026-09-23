export type {
  Embedding,
  TimeRange,
  Frame,
  Example,
  SearchOptions,
  ScoredWindow,
  Candidate,
  SearchResult,
  CandidateChange,
  EvaluationOptions,
  EvaluationResult,
} from './types'
export { normalizeEmbedding, cosineSimilarity, poolEmbedding, createExample } from './vectors'
export { searchFrames, compareResults } from './search'
export { evaluateEvents } from './evaluation'
