import { describe, expect, it } from 'vitest'
import {
  compareResults,
  cosineSimilarity,
  createExample,
  evaluateEvents,
  normalizeEmbedding,
  poolEmbedding,
  searchFrames,
} from '../src/search'
import type { Example, Frame } from '../src/search'

const frame = (start: number, embedding: ArrayLike<number>, duration = 0.96): Frame => ({
  start,
  end: start + duration,
  embedding,
})
const positive: Example = {
  id: 'doorbell',
  start: 0,
  end: 1,
  label: 'positive',
  embedding: [1, 0, 0],
  sourceId: 'training-day',
}
const negative: Example = {
  id: 'microwave',
  start: 5,
  end: 6,
  label: 'negative',
  embedding: [0.94, 0.34, 0],
  sourceId: 'training-day',
}

describe('embeddings and examples', () => {
  it('normalizes finite large vectors, typed arrays, and silent frames safely', () => {
    expect(Array.from(normalizeEmbedding(new Float32Array([3, 4])))).toEqual([
      expect.closeTo(0.6),
      expect.closeTo(0.8),
    ])
    expect(cosineSimilarity([1e300, 1e300], [1, 1])).toBeCloseTo(1)
    expect(Array.from(normalizeEmbedding([0, 0]))).toEqual([0, 0])
    expect(() => normalizeEmbedding([NaN, 1])).toThrow(/finite/)
    expect(() => normalizeEmbedding([])).toThrow(/at least one/)
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(/dimensions/)
  })

  it('pools only overlapping windows with overlap weighting', () => {
    const frames = [frame(0, [1, 0], 1), frame(1, [0, 1], 1), frame(4, [1, 1], 1)]
    expect(cosineSimilarity(poolEmbedding(frames, { start: 0, end: 1.25 }), [1, 0.25])).toBeCloseTo(
      1,
    )
    expect(createExample(frames, { start: 0, end: 1 }, 'positive', 'sample', 'day-1')).toEqual({
      id: 'sample',
      start: 0,
      end: 1,
      label: 'positive',
      embedding: [1, 0],
      sourceId: 'day-1',
    })
    expect(() => poolEmbedding(frames, { start: 10, end: 11 })).toThrow(/containing analyzed/)
    expect(() => poolEmbedding([frame(0, [0, 0])])).toThrow(/no usable sound/)
  })
})

describe('few-shot retrieval', () => {
  it('merges neighboring matches, preserves explanations, and orders events by time', () => {
    const result = searchFrames(
      [
        frame(10, [1, 0, 0]),
        frame(2.48, [0.98, 0.02, 0]),
        frame(2, [1, 0, 0]),
        frame(4, [0, 0, 1]),
      ],
      [positive],
      { sourceId: 'test-day' },
    )
    expect(result.training.mode).toBe('similarity')
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0]).toMatchObject({
      start: 2,
      end: 3.44,
      windowCount: 2,
      nearestExampleId: 'doorbell',
    })
    expect(result.candidates[1].start).toBe(10)
    expect(result.candidates.every((candidate) => Number.isFinite(candidate.reviewPriority))).toBe(
      true,
    )
  })

  it('a confirmed negative suppresses similar false alarms while retaining unseen positives', () => {
    const frames = [
      frame(10, [0.999, 0.015, 0.01]), // target on another day
      frame(20, [0.95, 0.32, 0.01]), // same distractor elsewhere
      frame(30, [0.998, -0.02, 0.01]), // another target
      frame(40, [0, 0, 1]), // unrelated sound must not become a classifier hit
    ]
    const before = searchFrames(frames, [positive], { sourceId: 'test-day' })
    const after = searchFrames(frames, [positive, negative], { sourceId: 'test-day' })
    expect(before.candidates.map((candidate) => candidate.start)).toEqual([10, 20, 30])
    expect(after.training.mode).toBe('contrastive-logistic')
    expect(after.candidates.map((candidate) => candidate.start)).toEqual([10, 30])
    expect(after.windows[1].score).toBeLessThan(before.windows[1].score - 0.4)
    expect(after.windows[0].score).toBeGreaterThan(0.7)
    const comparison = compareResults(before, after)
    expect(comparison.removedCount).toBe(1)
    expect(comparison.retainedCount).toBe(2)
    expect(comparison.changes[1].scoreDelta).toBeLessThan(-0.4)
  })

  it('balances classes so repeated negatives do not erase positives', () => {
    const manyNegatives = Array.from({ length: 12 }, (_, index) => ({
      ...negative,
      id: `negative-${index}`,
    }))
    const frames = [frame(10, [1, 0, 0]), frame(20, [0.94, 0.34, 0])]
    const result = searchFrames(frames, [positive, ...manyNegatives], { sourceId: 'test-day' })
    expect(result.candidates.map((candidate) => candidate.start)).toEqual([10])
  })

  it('preserves multiple distinct positive variations', () => {
    const second: Example = { ...positive, id: 'variation', embedding: [0, 1, 0] }
    const result = searchFrames([frame(10, [1, 0, 0]), frame(20, [0, 1, 0])], [positive, second])
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[1].nearestExampleId).toBe('variation')
  })

  it('never reintroduces a labeled negative via a merged event and keeps old-file timestamps separate', () => {
    const localNegative: Example = {
      ...negative,
      embedding: [0, 1, 0],
      start: 2,
      end: 3,
      sourceId: 'current',
    }
    const frames = [frame(1, [1, 0, 0], 1), frame(2, [1, 0, 0], 1), frame(3, [1, 0, 0], 1)]
    const result = searchFrames(frames, [positive, localNegative], {
      sourceId: 'current',
      mergeGap: 10,
      excludeLabeledRegions: false,
    })
    expect(result.candidates.map((candidate) => [candidate.start, candidate.end])).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(result.windows[1].excluded).toBe(true)
    const otherFile = searchFrames(frames, [positive, localNegative], {
      sourceId: 'other',
      mergeGap: 10,
    })
    expect(otherFile.candidates.map((candidate) => [candidate.start, candidate.end])).toEqual([
      [1, 4],
    ])
  })

  it('excludes local positive training regions by default and permits showing them explicitly', () => {
    const frames = [frame(0, [1, 0, 0]), frame(5, [1, 0, 0])]
    expect(
      searchFrames(frames, [positive], { sourceId: 'training-day' }).candidates.map(
        (candidate) => candidate.start,
      ),
    ).toEqual([5])
    expect(
      searchFrames(frames, [positive], { sourceId: 'training-day', excludeLabeledRegions: false })
        .candidates,
    ).toHaveLength(2)
  })

  it('handles no labels or empty recordings and rejects invalid inputs', () => {
    expect(searchFrames([], [positive]).candidates).toEqual([])
    expect(searchFrames([frame(0, [1, 0, 0])], []).candidates).toEqual([])
    expect(searchFrames([frame(0, [0, 0, 0])], [positive], { threshold: 0 }).candidates).toEqual([])
    expect(() => searchFrames([frame(0, [1, 0])], [positive])).toThrow(/dimensions/)
    expect(() => searchFrames([], [positive], { threshold: NaN })).toThrow(/Threshold/)
    expect(() => searchFrames([frame(-1, [1, 0, 0])], [positive])).toThrow(/finite times/)
    expect(() => searchFrames([], [positive, positive])).toThrow(/unique/)
  })
})

describe('event evaluation', () => {
  it('counts one match per real event and reports false alarms per hour', () => {
    const result = evaluateEvents(
      [
        { start: 10, end: 11 },
        { start: 10.1, end: 11.1 },
        { start: 25, end: 26 },
      ],
      [
        { start: 10, end: 11 },
        { start: 50, end: 51 },
      ],
      1800,
    )
    expect(result).toMatchObject({
      truePositives: 1,
      falsePositives: 2,
      falseNegatives: 1,
      precision: 1 / 3,
      recall: 0.5,
      falsePositivesPerHour: 4,
    })
  })

  it('uses maximum one-to-one matching instead of an order-dependent greedy count', () => {
    const result = evaluateEvents(
      [
        { start: 1, end: 4 },
        { start: 1, end: 2 },
      ],
      [
        { start: 1, end: 2 },
        { start: 3, end: 4 },
      ],
      10,
      { tolerance: 0 },
    )
    expect(result.truePositives).toBe(2)
    expect(new Set(result.matches.map((match) => match.predictionIndex)).size).toBe(2)
  })

  it('subtracts the union of training regions from exposure and excludes their events', () => {
    const result = evaluateEvents(
      [
        { start: 10, end: 11 },
        { start: 100, end: 101 },
        { start: 400, end: 401 },
      ],
      [
        { start: 10, end: 11 },
        { start: 100, end: 101 },
      ],
      3600,
      {
        excludeRegions: [
          { start: 0, end: 1000 },
          { start: 900, end: 1800 },
        ],
      },
    )
    expect(result).toMatchObject({
      evaluatedHours: 0.5,
      truePositives: 0,
      falsePositives: 0,
      excludedPredictions: 3,
      excludedEvents: 2,
    })
    const heldOut = evaluateEvents([{ start: 1900, end: 1901 }], [], 3600, {
      excludeRegions: [{ start: 0, end: 1800 }],
    })
    expect(heldOut.falsePositivesPerHour).toBe(2)
  })

  it('keeps empty-set metrics finite and rejects impossible ranges', () => {
    expect(evaluateEvents([], [], 10)).toMatchObject({
      precision: 0,
      recall: 0,
      falsePositivesPerHour: 0,
    })
    expect(
      evaluateEvents([], [], 10, { excludeRegions: [{ start: 0, end: 10 }] }).evaluatedHours,
    ).toBe(0)
    expect(() => evaluateEvents([], [], 0)).toThrow(/duration/)
    expect(() => evaluateEvents([{ start: 9, end: 11 }], [], 10)).toThrow(/past/)
    expect(() => evaluateEvents([], [], 10, { tolerance: -1 })).toThrow(/tolerance/)
  })
})
