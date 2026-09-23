import { useEffect, useRef, useState } from 'react'
import { Minus, Plus, MoveHorizontal } from 'lucide-react'
import { time } from '../lib/format'

export type Range = { start: number; end: number }
interface Props {
  peaks: Float32Array
  duration: number
  selection: Range | null
  candidates: Range[]
  positives: Range[]
  negatives: Range[]
  playhead: number
  onSelect: (range: Range) => void
}
export default function Waveform({
  peaks,
  duration,
  selection,
  candidates,
  positives,
  negatives,
  playhead,
  onSelect,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState(0)
  const [width, setWidth] = useState(800)
  const dragging = useRef<number | null>(null)
  const viewDuration = duration / zoom
  const start = Math.min(offset, Math.max(0, duration - viewDuration))
  useEffect(() => {
    const el = canvas.current!
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const el = canvas.current!
    const dpr = window.devicePixelRatio || 1
    el.width = width * dpr
    el.height = 188 * dpr
    const ctx = el.getContext('2d')!
    ctx.scale(dpr, dpr)
    const x = (s: number) => ((s - start) / viewDuration) * width
    ctx.clearRect(0, 0, width, 188)
    for (let i = 0; i <= 8; i++) {
      ctx.strokeStyle = '#eeedf4'
      ctx.beginPath()
      ctx.moveTo((i * width) / 8, 0)
      ctx.lineTo((i * width) / 8, 188)
      ctx.stroke()
    }
    function region(range: Range, fill: string, border?: string) {
      const left = x(range.start),
        right = x(range.end)
      ctx.fillStyle = fill
      ctx.fillRect(left, 9, Math.max(right - left, 2), 169)
      if (border) {
        ctx.strokeStyle = border
        ctx.lineWidth = 1
        ctx.strokeRect(left, 9, Math.max(right - left, 2), 169)
      }
    }
    candidates.forEach((r) => region(r, '#edeafd'))
    positives.forEach((r) => region(r, '#d7f1e5'))
    negatives.forEach((r) => region(r, '#fbe4df'))
    if (selection) region(selection, '#dad4ff88', '#7465e7')
    const bars = Math.floor(width / 3)
    for (let b = 0; b < bars; b++) {
      const t0 = start + (b / bars) * viewDuration
      const t1 = start + ((b + 1) / bars) * viewDuration
      const lo = Math.floor((t0 / duration) * peaks.length),
        hi = Math.max(lo + 1, Math.ceil((t1 / duration) * peaks.length))
      let amp = 0
      for (let i = lo; i < Math.min(hi, peaks.length); i++) amp = Math.max(amp, peaks[i])
      const h = Math.max(3, Math.pow(amp, 0.65) * 140)
      ctx.fillStyle =
        selection && t0 >= selection.start && t0 <= selection.end ? '#6756d6' : '#a6a0cb'
      ctx.fillRect((b * width) / bars, 94 - h / 2, 1.8, h)
    }
    if (playhead >= start && playhead <= start + viewDuration) {
      ctx.fillStyle = '#423c61'
      ctx.fillRect(x(playhead), 0, 1.5, 188)
      ctx.beginPath()
      ctx.moveTo(x(playhead) - 4, 0)
      ctx.lineTo(x(playhead) + 4, 0)
      ctx.lineTo(x(playhead), 7)
      ctx.fill()
    }
  }, [
    peaks,
    duration,
    selection,
    candidates,
    positives,
    negatives,
    playhead,
    width,
    viewDuration,
    start,
  ])
  const pointerTime = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.max(
      start,
      Math.min(
        start + viewDuration,
        start + ((event.clientX - rect.left) / rect.width) * viewDuration,
      ),
    )
  }
  const update = (end: number) => {
    if (dragging.current !== null)
      onSelect({ start: Math.min(dragging.current, end), end: Math.max(dragging.current, end) })
  }
  return (
    <div className="waveform">
      <div className="wave-toolbar">
        <span>
          <MoveHorizontal size={14} /> 拖动波形，圈出你想找的声音
        </span>
        <div className="zoom-controls">
          <button
            title="缩小波形"
            disabled={zoom === 1}
            onClick={() => setZoom((z) => Math.max(1, z / 2))}
          >
            <Minus size={14} />
          </button>
          <span>{zoom}×</span>
          <button
            title="放大波形"
            disabled={zoom >= 64}
            onClick={() => {
              setOffset(selection?.start ?? playhead)
              setZoom((z) => Math.min(64, z * 2))
            }}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <canvas
        ref={canvas}
        aria-label="录音波形。拖动选择片段，或使用下方起止秒数输入框。"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          dragging.current = pointerTime(event)
          update(dragging.current)
        }}
        onPointerMove={(event) => update(pointerTime(event))}
        onPointerUp={(event) => {
          const t = pointerTime(event)
          if (dragging.current !== null && Math.abs(t - dragging.current) < 0.1) {
            onSelect({ start: t, end: Math.min(duration, t + 0.96) })
          } else update(t)
          dragging.current = null
        }}
        onPointerCancel={() => {
          dragging.current = null
        }}
      />
      <div className="time-ruler">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i}>{time(start + (i / 4) * viewDuration)}</span>
        ))}
      </div>
      {zoom > 1 && (
        <input
          className="pan-range"
          aria-label="移动时间线"
          type="range"
          min="0"
          max={duration - viewDuration}
          step="0.1"
          value={start}
          onChange={(e) => setOffset(Number(e.target.value))}
        />
      )}
      <div className="wave-legend">
        <span>
          <i className="dot purple" />
          候选声音
        </span>
        <span>
          <i className="dot green" />
          正例
        </span>
        <span>
          <i className="dot coral" />
          已排除
        </span>
        <span className="ml-auto">{time(viewDuration)} 可见</span>
      </div>
    </div>
  )
}
