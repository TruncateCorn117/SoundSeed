import type { DemoRecording, TimeRange } from './types'

/** Reproducible synthetic fixture, not a benchmark of real-world accuracy. */
export function createDoorbellDemo(): DemoRecording {
  const rate = 16000
  const duration = 90
  const audio = new Float32Array(rate * duration)
  let state = 20260923
  const noise = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return (state / 0x100000000) * 2 - 1
  }
  for (let i = 0; i < audio.length; i++) {
    const t = i / rate
    audio[i] = noise() * 0.006 + Math.sin(2 * Math.PI * 60 * t) * 0.002
  }
  const truth: TimeRange[] = [5, 17.4, 29.8, 44.1, 58.7, 71.2, 83.4].map((start) => ({
    start,
    end: start + 1.55,
  }))
  const addTone = (
    start: number,
    seconds: number,
    frequency: number,
    gain: number,
    decay: number,
    harmonic = 0.28,
  ) => {
    const first = Math.round(start * rate)
    const count = Math.floor(seconds * rate)
    for (let i = 0; i < count && first + i < audio.length; i++) {
      const t = i / rate
      const attack = Math.min(1, t / 0.006)
      const envelope = attack * Math.exp(-decay * t) * Math.min(1, (seconds - t) / 0.025)
      audio[first + i] +=
        gain *
        envelope *
        (Math.sin(2 * Math.PI * frequency * t) +
          harmonic * Math.sin(2 * Math.PI * frequency * 2.76 * t))
    }
  }
  truth.forEach(({ start }, i) => {
    const gain = 0.23 + (i % 3) * 0.035
    addTone(start, 1.1, 784, gain, 4)
    addTone(start + 0.48, 1.07, 622.25, gain * 0.9, 3.7)
  })
  // Deliberate distractors: single notification chimes and higher appliance beeps.
  for (const start of [11.5, 36, 51.8, 77.2]) addTone(start, 0.85, 1046.5, 0.19, 4.5)
  for (const start of [23, 64]) {
    for (let pulse = 0; pulse < 3; pulse++) addTone(start + pulse * 0.24, 0.13, 1480, 0.14, 0.2, 0)
  }
  // A soft broadband scrape makes silence an imperfect shortcut.
  for (const start of [8.8, 32.2, 48.8, 68]) {
    for (let i = 0; i < rate * 0.6; i++)
      audio[Math.round(start * rate) + i] += noise() * 0.06 * Math.sin((Math.PI * i) / (rate * 0.6))
  }
  const buffer = new ArrayBuffer(44 + audio.length * 2)
  const view = new DataView(buffer)
  const put = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  put(0, 'RIFF')
  view.setUint32(4, buffer.byteLength - 8, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  put(36, 'data')
  view.setUint32(40, audio.length * 2, true)
  for (let i = 0; i < audio.length; i++)
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, audio[i])) * 32767), true)
  return {
    file: new File([buffer], 'doorbell-lab-demo.wav', { type: 'audio/wav' }),
    truth,
    suggestedExamples: truth.slice(0, 2).map((range) => ({ ...range })),
  }
}
