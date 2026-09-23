import { describe, expect, it } from 'vitest'
import { addWaveformPeaks, decodePcm, readMono16k, readWavInfo } from './wav'
import { createDoorbellDemo } from './demo'

function wav(
  samples: number[],
  sampleRate = 16000,
  channels = 1,
  bits = 16,
  format = 1,
  junk = false,
): Blob {
  const junkLength = junk ? 12 : 0
  const bytes = bits / 8
  const buffer = new ArrayBuffer(44 + junkLength + samples.length * bytes)
  const view = new DataView(buffer)
  const string = (offset: number, value: string) => {
    ;[...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
  }
  string(0, 'RIFF')
  view.setUint32(4, buffer.byteLength - 8, true)
  string(8, 'WAVE')
  if (junk) {
    string(12, 'JUNK')
    view.setUint32(16, 3, true)
  }
  const p = 12 + junkLength
  string(p, 'fmt ')
  view.setUint32(p + 4, 16, true)
  view.setUint16(p + 8, format, true)
  view.setUint16(p + 10, channels, true)
  view.setUint32(p + 12, sampleRate, true)
  view.setUint32(p + 16, sampleRate * channels * bytes, true)
  view.setUint16(p + 20, channels * bytes, true)
  view.setUint16(p + 22, bits, true)
  string(p + 24, 'data')
  view.setUint32(p + 28, samples.length * bytes, true)
  samples.forEach((value, i) => {
    const offset = p + 32 + i * bytes
    if (format === 3) {
      if (bits === 32) view.setFloat32(offset, value, true)
      else view.setFloat64(offset, value, true)
    } else if (bits === 8) view.setUint8(offset, value)
    else if (bits === 16) view.setInt16(offset, value, true)
    else if (bits === 24) {
      view.setUint8(offset, value & 255)
      view.setUint8(offset + 1, (value >> 8) & 255)
      view.setUint8(offset + 2, (value >> 16) & 255)
    } else view.setInt32(offset, value, true)
  })
  return new Blob([buffer])
}

describe('WAV reader', () => {
  it('skips padded metadata and averages stereo PCM without reading the whole file', async () => {
    const file = wav([32767, -32768, 16384, 16384, 0, 0], 16000, 2, 16, 1, true)
    const info = await readWavInfo(file)
    expect(info.channels).toBe(2)
    expect(info.sampleCount).toBe(3)
    const result = await readMono16k(file, info, 0, 4)
    expect(Array.from(result)).toEqual([-1 / 65536, 0.5, 0, 0])
  })

  it.each([8, 16, 24, 32])('decodes %i-bit integer PCM with correct signedness', async (bits) => {
    const bound = 2 ** (bits - 1)
    const values = bits === 8 ? [0, 128, 255] : [-bound, 0, bound - 1]
    const file = wav(values, 16000, 1, bits)
    const info = await readWavInfo(file)
    const result = await readMono16k(file, info, 0, 3)
    expect(result[0]).toBe(-1)
    expect(result[1]).toBe(0)
    expect(result[2]).toBeCloseTo((bound - 1) / bound)
  })

  it.each([32, 64])('sanitizes %i-bit float PCM before inference', async (bits) => {
    const file = wav([NaN, Infinity, 1.5, -2, 0.25], 16000, 1, bits, 3)
    const info = await readWavInfo(file)
    expect(Array.from(await readMono16k(file, info, 0, 5))).toEqual([0, 0, 1, -1, 0.25])
  })

  it('reads WAVE_FORMAT_EXTENSIBLE PCM and validates its subformat GUID', async () => {
    const original = new Uint8Array(await wav([16384, -16384]).arrayBuffer())
    const bytes = new Uint8Array(original.length + 24)
    bytes.set(original.subarray(0, 36))
    bytes.set(original.subarray(36), 60)
    const view = new DataView(bytes.buffer)
    view.setUint32(4, bytes.length - 8, true)
    view.setUint32(16, 40, true)
    view.setUint16(20, 0xfffe, true)
    view.setUint16(36, 22, true)
    view.setUint16(38, 16, true)
    bytes.set([1, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113], 44)
    const file = new Blob([bytes])
    expect(Array.from(await readMono16k(file, await readWavInfo(file), 0, 2))).toEqual([0.5, -0.5])
    bytes[55] = 0
    await expect(readWavInfo(new Blob([bytes]))).rejects.toThrow('extended WAV codec')
  })

  it('rejects compressed and truncated files with actionable errors', async () => {
    await expect(readWavInfo(wav([1, 2, 3], 16000, 1, 16, 6))).rejects.toThrow('Compressed WAV')
    const valid = wav([1, 2, 3])
    await expect(readWavInfo(valid.slice(0, valid.size - 1))).rejects.toThrow('truncated')
    await expect(readWavInfo(new Blob(['hello']))).rejects.toThrow('too small')
  })

  it('produces identical 44.1 kHz resampling across chunk boundaries', async () => {
    const values = Array.from({ length: 4410 }, (_, i) =>
      Math.round(Math.sin((2 * Math.PI * 1000 * i) / 44100) * 16000),
    )
    const file = wav(values, 44100)
    const info = await readWavInfo(file)
    const all = await readMono16k(file, info, 0, 1600)
    const first = await readMono16k(file, info, 0, 777)
    const second = await readMono16k(file, info, 777, 823)
    expect(Array.from(all)).toEqual([...first, ...second])
  })

  it.each([48000, 192000, 384000])(
    'attenuates frequencies above the 16 kHz Nyquist limit from %i Hz input',
    async (sampleRate) => {
      const make = async (hz: number) => {
        const file = wav(
          Array.from({ length: sampleRate / 10 }, (_, i) =>
            Math.round(Math.sin((2 * Math.PI * hz * i) / sampleRate) * 16000),
          ),
          sampleRate,
        )
        return readMono16k(file, await readWavInfo(file), 100, 1000)
      }
      const energy = (values: Float32Array) =>
        values.reduce((sum, value) => sum + value * value, 0) / values.length
      expect(energy(await make(12000))).toBeLessThan(energy(await make(1000)) * 0.005)
    },
  )

  it('keeps reads bounded to the requested chunk, not the full high-rate recording', async () => {
    const file = wav(new Array(48000 * 10).fill(0), 48000)
    const info = await readWavInfo(file)
    let largestRead = 0
    const original = file.slice.bind(file)
    file.slice = (start, end, contentType) => {
      largestRead = Math.max(largestRead, (end ?? file.size) - (start ?? 0))
      return original(start, end, contentType)
    }
    await readMono16k(file, info, 16000, 16000)
    expect(largestRead).toBeLessThan(97000)
    expect(largestRead).toBeLessThan(file.size / 5)
  })

  it('decodes empty buffers and calculates bounded waveform peaks', () => {
    expect(
      decodePcm(new DataView(new ArrayBuffer(0)), {
        format: 1,
        bitsPerSample: 16,
        channels: 1,
        blockAlign: 2,
      }),
    ).toHaveLength(0)
    const peaks = new Float32Array(2)
    addWaveformPeaks(peaks, new Float32Array([0.1, -0.8, 0.2, 0.3, 1]), 0, 4)
    expect(peaks[0]).toBeCloseTo(0.8)
    expect(peaks[1]).toBeCloseTo(0.3)
  })

  it('creates a reproducible, explicitly synthetic demo with seven known events', async () => {
    const demo = createDoorbellDemo()
    expect(demo.truth).toHaveLength(7)
    expect(demo.suggestedExamples).toHaveLength(2)
    expect((await readWavInfo(demo.file)).duration).toBe(90)
    expect(await demo.file.arrayBuffer()).toEqual(await createDoorbellDemo().file.arrayBuffer())
  })
})
