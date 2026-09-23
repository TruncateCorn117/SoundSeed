import type { Embedding, Example, Frame, TimeRange } from './types'

export function assertRange(range: TimeRange, name = 'Time range'): void {
  if (
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end) ||
    range.start < 0 ||
    range.end <= range.start
  ) {
    throw new Error(`${name} must have finite times with 0 ≤ start < end.`)
  }
}

export function overlap(a: TimeRange, b: TimeRange): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

export function normalizeEmbedding(vector: Embedding): Float32Array {
  if (!Number.isSafeInteger(vector.length) || vector.length < 1) {
    throw new Error('Embeddings must contain at least one finite value.')
  }
  let scale = 0
  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i])) throw new Error('Embeddings must contain only finite values.')
    scale = Math.max(scale, Math.abs(vector[i]))
  }
  const result = new Float32Array(vector.length)
  if (scale === 0) return result
  // Scaling first prevents finite-but-large inputs overflowing the norm.
  let squaredNorm = 0
  for (let i = 0; i < vector.length; i++) squaredNorm += (vector[i] / scale) ** 2
  const norm = Math.sqrt(squaredNorm)
  for (let i = 0; i < vector.length; i++) result[i] = vector[i] / scale / norm
  return result
}

export function dot(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) throw new Error('All embeddings must have the same dimensions.')
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

export function cosineSimilarity(a: Embedding, b: Embedding): number {
  return Math.max(-1, Math.min(1, dot(normalizeEmbedding(a), normalizeEmbedding(b))))
}

/** Overlap-weighted pooling keeps partial edge windows from dominating a selection. */
export function poolEmbedding(frames: readonly Frame[], range?: TimeRange): number[] {
  if (range) assertRange(range)
  let pooled: Float64Array | undefined
  let weightSum = 0
  for (const frame of frames) {
    assertRange(frame, 'Frame')
    const weight = range ? overlap(frame, range) : frame.end - frame.start
    if (weight <= 0) continue
    const vector = normalizeEmbedding(frame.embedding)
    if (!pooled) pooled = new Float64Array(vector.length)
    if (pooled.length !== vector.length)
      throw new Error('All embeddings must have the same dimensions.')
    for (let i = 0; i < vector.length; i++) pooled[i] += vector[i] * weight
    weightSum += weight
  }
  if (!pooled || weightSum === 0) throw new Error('Select a region containing analyzed audio.')
  const normalized = normalizeEmbedding(pooled)
  if (normalized.every((value) => value === 0))
    throw new Error('This region has no usable sound features. Try a different region.')
  return Array.from(normalized)
}

export function createExample(
  frames: readonly Frame[],
  range: TimeRange,
  label: Example['label'],
  id: string,
  sourceId?: string,
): Example {
  if (!id.trim()) throw new Error('Examples need a nonempty identifier.')
  if (label !== 'positive' && label !== 'negative')
    throw new Error('Example label must be positive or negative.')
  return {
    id,
    start: range.start,
    end: range.end,
    label,
    embedding: poolEmbedding(frames, range),
    sourceId,
  }
}
