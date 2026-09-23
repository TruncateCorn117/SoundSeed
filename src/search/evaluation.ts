import type { EvaluationOptions, EvaluationResult, TimeRange } from './types'
import { assertRange, overlap } from './vectors'

/** Event-level maximum one-to-one matching, with training regions held out. */
export function evaluateEvents(
  predictions: readonly TimeRange[],
  groundTruth: readonly TimeRange[],
  durationSeconds: number,
  options: EvaluationOptions = {},
): EvaluationResult {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
    throw new Error('Recording duration must be positive, finite seconds.')
  const tolerance = options.tolerance ?? 0.25
  const minimumOverlapRatio = options.minimumOverlapRatio ?? 0.3
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw new Error('Matching tolerance must be finite and nonnegative.')
  if (!Number.isFinite(minimumOverlapRatio) || minimumOverlapRatio < 0 || minimumOverlapRatio > 1) {
    throw new Error('Minimum overlap ratio must be between 0 and 1.')
  }
  const exclusions: TimeRange[] = []
  for (const region of options.excludeRegions ?? []) {
    assertRange(region, 'Exclusion')
    if (region.start < durationSeconds)
      exclusions.push({ start: region.start, end: Math.min(region.end, durationSeconds) })
  }
  exclusions.sort((a, b) => a.start - b.start)
  const merged: TimeRange[] = []
  for (const region of exclusions) {
    const prior = merged.at(-1)
    if (prior && region.start <= prior.end) prior.end = Math.max(prior.end, region.end)
    else merged.push({ ...region })
  }
  const prepare = (ranges: readonly TimeRange[], name: string) =>
    ranges.flatMap((range, index) => {
      assertRange(range, name)
      if (range.end > durationSeconds + 1e-6)
        throw new Error(`${name} extends past the recording duration.`)
      return merged.some((region) => overlap(range, region) > 0) ? [] : [{ ...range, index }]
    })
  const usablePredictions = prepare(predictions, 'Prediction')
  const usableEvents = prepare(groundTruth, 'Ground-truth event')
  const edges = usablePredictions.map((prediction) =>
    usableEvents
      .map((event, index) => {
        const intersection = overlap(prediction, event)
        const ratio =
          intersection / Math.min(prediction.end - prediction.start, event.end - event.start)
        const onsetDistance = Math.abs(prediction.start - event.start)
        return {
          index,
          eligible:
            (intersection > 0 && ratio >= minimumOverlapRatio) || onsetDistance <= tolerance,
          ratio,
          onsetDistance,
        }
      })
      .filter((edge) => edge.eligible)
      .sort((a, b) => b.ratio - a.ratio || a.onsetDistance - b.onsetDistance)
      .map((edge) => edge.index),
  )

  // Augmenting paths avoid greedy matching undercounting when intervals overlap.
  const eventToPrediction = new Map<number, number>()
  const visit = (predictionIndex: number, seen: Set<number>): boolean => {
    for (const eventIndex of edges[predictionIndex]) {
      if (seen.has(eventIndex)) continue
      seen.add(eventIndex)
      const previous = eventToPrediction.get(eventIndex)
      if (previous === undefined || visit(previous, seen)) {
        eventToPrediction.set(eventIndex, predictionIndex)
        return true
      }
    }
    return false
  }
  for (let i = 0; i < usablePredictions.length; i++) visit(i, new Set())
  const matches = Array.from(eventToPrediction, ([eventIndex, predictionIndex]) => ({
    predictionIndex: usablePredictions[predictionIndex].index,
    eventIndex: usableEvents[eventIndex].index,
  })).sort((a, b) => a.predictionIndex - b.predictionIndex)
  const truePositives = matches.length
  const falsePositives = usablePredictions.length - truePositives
  const falseNegatives = usableEvents.length - truePositives
  const evaluatedSeconds = Math.max(
    0,
    durationSeconds - merged.reduce((sum, range) => sum + range.end - range.start, 0),
  )
  const evaluatedHours = evaluatedSeconds / 3600
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision: usablePredictions.length ? truePositives / usablePredictions.length : 0,
    recall: usableEvents.length ? truePositives / usableEvents.length : 0,
    falsePositivesPerHour: evaluatedHours ? falsePositives / evaluatedHours : 0,
    evaluatedHours,
    excludedPredictions: predictions.length - usablePredictions.length,
    excludedEvents: groundTruth.length - usableEvents.length,
    matches,
  }
}
