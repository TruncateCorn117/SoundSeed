/** A bounded-memory RIFF/WAVE reader. Audio never enters a remote service. */
export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  format: 1 | 3
  blockAlign: number
  dataOffset: number
  dataBytes: number
  sampleCount: number
  duration: number
}

const fourCC = (view: DataView, offset: number) =>
  String.fromCharCode(...Array.from({ length: 4 }, (_, i) => view.getUint8(offset + i)))

export async function readWavInfo(file: Blob): Promise<WavInfo> {
  if (file.size < 44) throw new Error('The file is too small to be a WAV recording.')
  const header = new DataView(await file.slice(0, 12).arrayBuffer())
  if (fourCC(header, 0) !== 'RIFF' || fourCC(header, 8) !== 'WAVE') {
    throw new Error('Please choose a little-endian RIFF WAV file (PCM or IEEE float).')
  }
  let format: WavInfo | undefined
  let dataOffset = 0
  let dataBytes = 0
  for (let offset = 12; offset + 8 <= file.size; ) {
    const chunk = new DataView(await file.slice(offset, offset + 8).arrayBuffer())
    const id = fourCC(chunk, 0)
    const length = chunk.getUint32(4, true)
    if (offset + 8 + length > file.size)
      throw new Error('The WAV file is truncated or has an invalid chunk length.')
    if (id === 'fmt ') {
      if (length < 16) throw new Error('The WAV format header is incomplete.')
      const fmt = new DataView(
        await file.slice(offset + 8, offset + 8 + Math.min(length, 40)).arrayBuffer(),
      )
      let encoding = fmt.getUint16(0, true)
      if (encoding === 0xfffe) {
        if (length < 40 || fmt.getUint16(16, true) < 22)
          throw new Error('The extended WAV header is incomplete.')
        // WAVE_FORMAT_EXTENSIBLE stores the real format in its subformat GUID.
        const guidTail = [0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113]
        if (!guidTail.every((value, index) => fmt.getUint8(26 + index) === value)) {
          throw new Error('This extended WAV codec is unsupported. Export as PCM WAV.')
        }
        encoding = fmt.getUint16(24, true)
      }
      const channels = fmt.getUint16(2, true)
      const sampleRate = fmt.getUint32(4, true)
      const blockAlign = fmt.getUint16(12, true)
      const bitsPerSample = fmt.getUint16(14, true)
      if (encoding !== 1 && encoding !== 3)
        throw new Error('Compressed WAV is unsupported. Export as PCM or IEEE float WAV.')
      if (channels < 1 || channels > 32 || sampleRate < 8000 || sampleRate > 384000) {
        throw new Error('Unsupported WAV sample rate or channel count.')
      }
      const validBits = encoding === 1 ? [8, 16, 24, 32] : [32, 64]
      if (!validBits.includes(bitsPerSample) || blockAlign !== (channels * bitsPerSample) / 8) {
        throw new Error('Unsupported WAV bit depth or block alignment.')
      }
      format = {
        sampleRate,
        channels,
        bitsPerSample,
        format: encoding,
        blockAlign,
        dataOffset: 0,
        dataBytes: 0,
        sampleCount: 0,
        duration: 0,
      }
    } else if (id === 'data' && dataOffset === 0) {
      dataOffset = offset + 8
      dataBytes = length
    }
    if (format && dataOffset) break
    offset += 8 + length + (length % 2)
  }
  if (!format || !dataOffset || !dataBytes)
    throw new Error('No readable audio data was found in this WAV file.')
  if (dataBytes % format.blockAlign !== 0)
    throw new Error('The WAV audio data ends inside a sample.')
  const sampleCount = dataBytes / format.blockAlign
  return {
    ...format,
    dataOffset,
    dataBytes,
    sampleCount,
    duration: sampleCount / format.sampleRate,
  }
}

export function decodePcm(
  view: DataView,
  info: Pick<WavInfo, 'format' | 'bitsPerSample' | 'channels' | 'blockAlign'>,
): Float32Array {
  const result = new Float32Array(Math.floor(view.byteLength / info.blockAlign))
  const width = info.bitsPerSample / 8
  for (let frame = 0; frame < result.length; frame++) {
    let total = 0
    for (let channel = 0; channel < info.channels; channel++) {
      const offset = frame * info.blockAlign + channel * width
      let sample: number
      if (info.format === 3)
        sample =
          info.bitsPerSample === 32 ? view.getFloat32(offset, true) : view.getFloat64(offset, true)
      else if (info.bitsPerSample === 8) sample = (view.getUint8(offset) - 128) / 128
      else if (info.bitsPerSample === 16) sample = view.getInt16(offset, true) / 32768
      else if (info.bitsPerSample === 24) {
        let value =
          view.getUint8(offset) |
          (view.getUint8(offset + 1) << 8) |
          (view.getUint8(offset + 2) << 16)
        if (value & 0x800000) value -= 0x1000000
        sample = value / 8388608
      } else sample = view.getInt32(offset, true) / 2147483648
      total += Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0
    }
    result[frame] = total / info.channels
  }
  return result
}

const TARGET_RATE = 16000
const filterRadius = (sampleRate: number) => Math.max(24, Math.ceil((8 * sampleRate) / TARGET_RATE))
const resampleFilters = new Map<number, { divisor: number; weights: Float32Array[] }>()

function filtersFor(sampleRate: number) {
  const existing = resampleFilters.get(sampleRate)
  if (existing) return existing
  let a = sampleRate
  let b = TARGET_RATE
  while (b) [a, b] = [b, a % b]
  const phases = TARGET_RATE / a
  const radius = filterRadius(sampleRate)
  const cutoff = Math.min(1, TARGET_RATE / sampleRate) * 0.94
  const weights = Array.from({ length: phases }, (_, phase) => {
    const kernel = new Float32Array(radius * 2)
    let sum = 0
    for (let tap = 0; tap < kernel.length; tap++) {
      const distance = tap - radius + 1 - phase / phases
      const x = Math.PI * distance * cutoff
      const sinc = Math.abs(x) < 1e-8 ? 1 : Math.sin(x) / x
      const window = 0.5 + 0.5 * Math.cos((Math.PI * distance) / radius)
      kernel[tap] = cutoff * sinc * window
      sum += kernel[tap]
    }
    for (let tap = 0; tap < kernel.length; tap++) kernel[tap] /= sum
    return kernel
  })
  const filters = { divisor: a, weights }
  resampleFilters.set(sampleRate, filters)
  return filters
}

/** Read only the necessary source samples, then anti-alias and resample to 16 kHz. */
export async function readMono16k(
  file: Blob,
  info: WavInfo,
  startSample: number,
  length: number,
): Promise<Float32Array> {
  const output = new Float32Array(length)
  const ratio = info.sampleRate / TARGET_RATE
  const radius = filterRadius(info.sampleRate)
  const sourceStart = Math.max(0, Math.floor(startSample * ratio) - radius)
  const sourceEnd = Math.min(info.sampleCount, Math.ceil((startSample + length) * ratio) + radius)
  if (sourceEnd <= sourceStart) return output
  const bytes = await file
    .slice(
      info.dataOffset + sourceStart * info.blockAlign,
      info.dataOffset + sourceEnd * info.blockAlign,
    )
    .arrayBuffer()
  const source = decodePcm(new DataView(bytes), info)
  if (info.sampleRate === TARGET_RATE) {
    output.set(source.subarray(startSample - sourceStart, startSample - sourceStart + length))
    return output
  }
  // A windowed-sinc low-pass avoids the aliases introduced by linear interpolation.
  const filters = filtersFor(info.sampleRate)
  for (let i = 0; i < length; i++) {
    const numerator = (startSample + i) * info.sampleRate
    const center = Math.floor(numerator / TARGET_RATE)
    if (center >= info.sampleCount) break
    const kernel = filters.weights[(numerator % TARGET_RATE) / filters.divisor]
    let sum = 0
    const left = center - radius + 1 - sourceStart
    for (let tap = 0; tap < kernel.length; tap++) {
      sum += (source[left + tap] ?? 0) * kernel[tap]
    }
    output[i] = Math.max(-1, Math.min(1, sum))
  }
  return output
}

export function addWaveformPeaks(
  peaks: Float32Array,
  samples: Float32Array,
  startSample: number,
  totalSamples: number,
) {
  const count = Math.min(samples.length, totalSamples - startSample)
  for (let i = 0; i < count; i++) {
    const bin = Math.min(
      peaks.length - 1,
      Math.floor(((startSample + i) / totalSamples) * peaks.length),
    )
    peaks[bin] = Math.max(peaks[bin], Math.abs(samples[i]))
  }
}
