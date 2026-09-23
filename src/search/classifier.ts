import type { Embedding } from './types'
import { dot } from './vectors'

interface LabeledVector {
  vector: Float32Array
  positive: boolean
}

export interface LightweightClassifier {
  score: (vector: Embedding) => number
}

function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value))
}

/**
 * Balanced L2-regularized logistic regression, fitted only to explicit labels.
 * Centering and a single RMS scale make nearby audio embeddings separable with
 * a handful of examples without unstable per-dimension variance estimates.
 */
export function trainClassifier(samples: readonly LabeledVector[]): LightweightClassifier {
  const positiveCount = samples.filter((sample) => sample.positive).length
  const negativeCount = samples.length - positiveCount
  if (!positiveCount || !negativeCount)
    throw new Error('Classifier requires both positive and negative examples.')
  const dimensions = samples[0].vector.length
  const center = new Float64Array(dimensions)
  for (const sample of samples) {
    const weight = 0.5 / (sample.positive ? positiveCount : negativeCount)
    for (let j = 0; j < dimensions; j++) center[j] += sample.vector[j] * weight
  }
  let variance = 0
  for (const sample of samples) {
    const weight = 0.5 / (sample.positive ? positiveCount : negativeCount)
    for (let j = 0; j < dimensions; j++) variance += (sample.vector[j] - center[j]) ** 2 * weight
  }
  // A floor avoids magnifying roundoff or contradictory identical examples.
  const scale = Math.max(0.05, Math.sqrt(variance))
  const training = samples.map((sample) => ({
    x: Float64Array.from(sample.vector, (value, j) => (value - center[j]) / scale),
    y: sample.positive ? 1 : 0,
    weight: 0.5 / (sample.positive ? positiveCount : negativeCount),
  }))
  const weights = new Float64Array(dimensions)
  let bias = 0
  const regularization = 0.06
  // The weighted mean squared sample norm is ≤ 1, bounding the gradient step.
  for (let step = 0; step < 180; step++) {
    const gradient = Float64Array.from(weights, (weight) => weight * regularization)
    let biasGradient = 0
    for (const sample of training) {
      const error = (sigmoid(dot(weights, sample.x) + bias) - sample.y) * sample.weight
      biasGradient += error
      for (let j = 0; j < dimensions; j++) gradient[j] += error * sample.x[j]
    }
    for (let j = 0; j < dimensions; j++) weights[j] -= gradient[j]
    bias -= biasGradient
  }
  // Fold centering and scaling into one dot product for every recording window.
  for (let j = 0; j < dimensions; j++) weights[j] /= scale
  const intercept = bias - dot(weights, center)
  return { score: (vector) => sigmoid(dot(weights, vector) + intercept) }
}
