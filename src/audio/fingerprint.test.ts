import { describe, expect, it } from 'vitest'
import { fingerprintFile } from './fingerprint'

describe('recording content identity', () => {
  it('gives identical bytes the same ID after filename and timestamp changes', async () => {
    const bytes = new Uint8Array(4 * 1024 * 1024 + 200)
    bytes[100] = 19
    bytes[bytes.length - 20] = 42
    const original = new File([bytes], 'monday.wav', { lastModified: 100 })
    const renamed = new File([bytes], 'renamed-tuesday.wav', { lastModified: 999999 })
    const id = await fingerprintFile(original)
    expect(id).toMatch(/^wav-sha256tree-v1:[a-f0-9]{64}$/)
    expect(await fingerprintFile(renamed)).toBe(id)
  })

  it('detects changed inner audio bytes even with the same length and file metadata', async () => {
    const bytes = new Uint8Array(8 * 1024 * 1024 + 100)
    const original = new File([bytes], 'same.wav', { lastModified: 100 })
    bytes[4 * 1024 * 1024 + 42] = 1
    const changed = new File([bytes], 'same.wav', { lastModified: 100 })
    expect(await fingerprintFile(original)).not.toBe(await fingerprintFile(changed))
  })

  it('keeps reads bounded and reports completion', async () => {
    const blob = new Blob([new Uint8Array(5 * 1024 * 1024)])
    const slice = blob.slice.bind(blob)
    let largest = 0
    blob.slice = (start, end, type) => {
      largest = Math.max(largest, (end ?? blob.size) - (start ?? 0))
      return slice(start, end, type)
    }
    const progress: number[] = []
    await fingerprintFile(blob, (value) => progress.push(value))
    expect(largest).toBe(4 * 1024 * 1024)
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(1)
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true)
  })
})
