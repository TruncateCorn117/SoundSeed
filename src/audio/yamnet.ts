import * as tf from '@tensorflow/tfjs'

/** Produce exactly count normalized embeddings, ignoring upstream padding-only rows. */
export async function embedBatch(
  model: tf.GraphModel,
  samples: Float32Array,
  count: number,
): Promise<Float32Array[]> {
  const input = tf.tensor1d(samples)
  let embedding: tf.Tensor | undefined
  try {
    embedding = model.execute(input, 'Identity_1') as tf.Tensor
    // The upstream graph's float32 ceil can add one padded patch at an exact
    // hop boundary. Retain the requested complete patches, never that extra row.
    if (
      embedding.rank !== 2 ||
      embedding.shape[1] !== 1024 ||
      embedding.shape[0] < count ||
      embedding.shape[0] > count + 1
    ) {
      throw new Error(`Unexpected YAMNet output shape: ${embedding.shape.join(' × ')}.`)
    }
    const values = await embedding.data()
    const vectors: Float32Array[] = []
    for (let row = 0; row < count; row++) {
      const vector = Float32Array.from(values.slice(row * 1024, (row + 1) * 1024))
      let sum = 0
      for (const value of vector) {
        if (!Number.isFinite(value)) throw new Error('YAMNet returned non-finite audio features.')
        sum += value * value
      }
      const norm = Math.sqrt(sum)
      if (norm > 0) for (let j = 0; j < vector.length; j++) vector[j] /= norm
      vectors.push(vector)
    }
    return vectors
  } finally {
    input.dispose()
    embedding?.dispose()
  }
}
