import type {
  Candidate,
  CandidateChange,
  Example,
  Frame,
  SearchOptions,
  SearchResult,
  TimeRange,
} from './types'
import { trainClassifier } from './classifier'
import { assertRange, dot, normalizeEmbedding, overlap } from './vectors'

const clamp = (value: number) => Math.max(0, Math.min(1, value))

export function searchFrames(
  frames: readonly Frame[],
  examples: readonly Example[],
  options: SearchOptions = {},
): SearchResult {
  const threshold = options.threshold ?? 0.7
  const mergeGap = options.mergeGap ?? 0.3
  const minDuration = options.minDuration ?? 0
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new Error('Threshold must be between 0 and 1.')
  if (
    !Number.isFinite(mergeGap) ||
    mergeGap < 0 ||
    !Number.isFinite(minDuration) ||
    minDuration < 0
  ) {
    throw new Error('Merge gap and minimum duration must be finite, nonnegative seconds.')
  }

  let dimensions: number | undefined
  const checkedVector = (frame: Frame) => {
    assertRange(frame)
    const vector = normalizeEmbedding(frame.embedding)
    dimensions ??= vector.length
    if (dimensions !== vector.length)
      throw new Error('All embeddings must have the same dimensions.')
    return vector
  }
  const ids = new Set<string>()
  const labels = examples.map((example) => {
    if (!example.id.trim() || ids.has(example.id))
      throw new Error('Example identifiers must be nonempty and unique.')
    if (example.label !== 'positive' && example.label !== 'negative')
      throw new Error('Unknown example label.')
    ids.add(example.id)
    const vector = checkedVector(example)
    if (vector.every((value) => value === 0))
      throw new Error('Examples must contain usable, nonzero sound features.')
    return { example, vector, positive: example.label === 'positive' }
  })
  const ordered = [...frames].sort((a, b) => a.start - b.start || a.end - b.end)
  const vectors = ordered.map(checkedVector)
  const positives = labels.filter((sample) => sample.positive)
  const negatives = labels.filter((sample) => !sample.positive)
  const training: SearchResult['training'] = {
    mode: positives.length && negatives.length ? 'contrastive-logistic' : 'similarity',
    positiveCount: positives.length,
    negativeCount: negatives.length,
  }
  if (!positives.length) return { candidates: [], windows: [], training }

  const average = new Float64Array(dimensions!)
  for (const sample of positives) {
    for (let j = 0; j < average.length; j++) average[j] += sample.vector[j] / positives.length
  }
  const prototype = normalizeEmbedding(average)
  const classifier = negatives.length ? trainClassifier(labels) : undefined
  const exclusions = examples.filter(
    (example) =>
      example.sourceId === options.sourceId &&
      (example.label === 'negative' || options.excludeLabeledRegions !== false),
  )
  const windows = ordered.map((frame, index) => {
    const vector = vectors[index]
    let nearest = positives[0]
    let nearestSimilarity = -Infinity
    for (const sample of positives) {
      const similarity = dot(vector, sample.vector)
      if (similarity > nearestSimilarity) {
        nearestSimilarity = similarity
        nearest = sample
      }
    }
    // The strongest example preserves legitimate target variations; the pooled
    // prototype contributes only a small stabilizing signal.
    const similarity = clamp(0.9 * nearestSimilarity + 0.1 * dot(vector, prototype))
    const learnedScore = classifier?.score(vector)
    const score = learnedScore === undefined ? similarity : similarity * (0.3 + 0.7 * learnedScore)
    return {
      start: frame.start,
      end: frame.end,
      score: clamp(score),
      similarity,
      learnedScore,
      nearestExampleId: nearest.example.id,
      excluded: exclusions.some((example) => overlap(frame, example) > 0),
    }
  })

  const candidates: Candidate[] = []
  let active: Candidate | undefined
  let activePeakIndex = -1
  const finish = () => {
    if (active && active.end - active.start >= minDuration) {
      const peakVector = vectors[activePeakIndex]
      const familiarity = Math.max(...labels.map((sample) => dot(peakVector, sample.vector)))
      const uncertainty = clamp(
        1 - Math.abs(active.score - threshold) / Math.max(0.1, 1 - threshold),
      )
      active.reviewPriority = clamp(0.7 * uncertainty + 0.3 * (1 - clamp(familiarity)))
      active.id = `event-${Math.round(active.start * 1000)}-${Math.round(active.end * 1000)}`
      candidates.push(active)
    }
    active = undefined
    activePeakIndex = -1
  }
  windows.forEach((window, index) => {
    if (window.excluded || window.score < threshold || window.similarity <= 0) return
    const span: TimeRange | undefined = active
      ? { start: active.start, end: Math.max(active.end, window.end) }
      : undefined
    const crossesExclusion = span && exclusions.some((example) => overlap(span, example) > 0)
    if (!active || window.start > active.end + mergeGap || crossesExclusion) {
      finish()
      active = {
        id: '',
        start: window.start,
        end: window.end,
        score: window.score,
        peakTime: (window.start + window.end) / 2,
        nearestExampleId: window.nearestExampleId,
        windowCount: 1,
        reviewPriority: 0,
      }
      activePeakIndex = index
      return
    }
    active.end = Math.max(active.end, window.end)
    active.windowCount++
    if (window.score > active.score) {
      active.score = window.score
      active.peakTime = (window.start + window.end) / 2
      active.nearestExampleId = window.nearestExampleId
      activePeakIndex = index
    }
  })
  finish()
  return { candidates, windows, training }
}

/** Compare actual ranking changes; disappearance alone does not prove a correction. */
export function compareResults(
  before: SearchResult,
  after: SearchResult,
): {
  changes: CandidateChange[]
  retainedCount: number
  removedCount: number
  addedCount: number
  meanScoreDelta: number
} {
  const used = new Set<string>()
  const changes: CandidateChange[] = before.candidates.map((candidate) => {
    const match = after.candidates
      .filter((other) => !used.has(other.id) && overlap(candidate, other) > 0)
      .sort((a, b) => overlap(candidate, b) - overlap(candidate, a))[0]
    if (match) used.add(match.id)
    const scores = after.windows
      .filter((window) => overlap(candidate, window) > 0)
      .map((window) => window.score)
    const afterScore = scores.length ? Math.max(...scores) : undefined
    return {
      before: candidate,
      after: match,
      afterScore,
      scoreDelta: afterScore === undefined ? undefined : afterScore - candidate.score,
      status: match ? 'retained' : 'removed',
    }
  })
  const deltas = changes.flatMap((change) =>
    change.scoreDelta === undefined ? [] : [change.scoreDelta],
  )
  return {
    changes,
    retainedCount: used.size,
    removedCount: changes.filter((change) => change.status === 'removed').length,
    addedCount: after.candidates.length - used.size,
    meanScoreDelta: deltas.length
      ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length
      : 0,
  }
}
