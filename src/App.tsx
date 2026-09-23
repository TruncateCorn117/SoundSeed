import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  FileAudio,
  Fingerprint,
  FolderOpen,
  Headphones,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sprout,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react'
import { analyzeFile } from './audio/analyze'
import { createDoorbellDemo } from './audio/demo'
import type { AudioAnalysis, AnalysisProgress } from './audio/types'
import { createExample, searchFrames, evaluateEvents } from './search'
import type { Example, Candidate } from './search'
import Waveform, { type Range } from './components/Waveform'
import { csvCell, download, time } from './lib/format'

const EMPTY = {
  candidates: [],
  windows: [],
  training: { mode: 'similarity' as const, positiveCount: 0, negativeCount: 0 },
}
export default function App() {
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [examples, setExamples] = useState<Example[]>([])
  const [history, setHistory] = useState<Example[][]>([])
  const [selection, setSelection] = useState<Range | null>(null)
  const [targetName, setTargetName] = useState('我的目标声音')
  const [threshold, setThreshold] = useState(0.7)
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [truth, setTruth] = useState<Range[] | null>(null)
  const [demo, setDemo] = useState(false)
  const [showDemoBanner, setShowDemoBanner] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [sort, setSort] = useState('time')
  const [help, setHelp] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [page, setPage] = useState(1)
  const fileInput = useRef<HTMLInputElement>(null)
  const seedInput = useRef<HTMLInputElement>(null)
  const truthInput = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)
  const player = useRef<HTMLAudioElement>(null)
  const playEnd = useRef<number | null>(null)
  const [audioUrl, setAudioUrl] = useState('')
  const positives = examples.filter((e) => e.label === 'positive')
  const negatives = examples.filter((e) => e.label === 'negative')
  const currentExamples = examples.filter((e) => e.sourceId === sourceId)
  const result = useMemo(
    () =>
      analysis && positives.length
        ? searchFrames(analysis.frames, examples, { threshold, sourceId })
        : EMPTY,
    [analysis, examples, threshold, sourceId],
  )
  const baseline = useMemo(
    () =>
      analysis && positives.length
        ? searchFrames(
            analysis.frames,
            examples.filter((e) => e.label === 'positive'),
            { threshold, sourceId },
          )
        : EMPTY,
    [analysis, examples, threshold, sourceId],
  )
  const candidates = useMemo(
    () =>
      [...result.candidates].sort((a, b) =>
        sort === 'score'
          ? b.score - a.score
          : sort === 'review'
            ? b.reviewPriority - a.reviewPriority
            : a.start - b.start,
      ),
    [result, sort],
  )
  const prioritized = useMemo(
    () => [...result.candidates].sort((a, b) => b.reviewPriority - a.reviewPriority).slice(0, 3),
    [result],
  )
  const metrics = useMemo(
    () =>
      analysis && truth && positives.length
        ? {
            before: evaluateEvents(baseline.candidates, truth, analysis.duration, {
              excludeRegions: currentExamples,
            }),
            after: evaluateEvents(result.candidates, truth, analysis.duration, {
              excludeRegions: currentExamples,
            }),
          }
        : null,
    [analysis, truth, baseline, result, examples],
  )
  useEffect(() => {
    setPage(1)
  }, [result, sort])
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setAudioUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  async function loadFile(nextFile: File, demoData?: ReturnType<typeof createDoorbellDemo>) {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    player.current?.pause()
    setPlaying(false)
    setError('')
    setProgress({ phase: 'reading', progress: 0, message: '正在读取 WAV…' })
    try {
      const next = await analyzeFile(nextFile, setProgress, controller.signal)
      if (controller.signal.aborted) return
      const id = next.sourceId
      setFile(nextFile)
      setSourceId(id)
      setAnalysis(next)
      setSelection(null)
      setPlayhead(0)
      setHistory([])
      setDemo(!!demoData)
      setShowDemoBanner(true)
      setTruth(demoData?.truth ?? null)
      if (demoData) {
        setTargetName('双音门铃')
        setThreshold(0.7)
        setExamples(
          demoData.suggestedExamples.map((range, i) =>
            createExample(next.frames, range, 'positive', `demo-${i}`, id),
          ),
        )
        setNotice('已圈选 2 段合成门铃。试听候选，试着排除相似的提示音。')
      } else if (examples.length)
        setNotice('已保留声音种子，正在新录音中搜索。可在右侧清空后重新定义目标。')
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : '读取录音失败。')
    } finally {
      if (abort.current === controller) setProgress(null)
    }
  }
  function changeExamples(next: Example[]) {
    setHistory((h) => [...h.slice(-49), examples])
    setExamples(next)
  }
  function label(range: Range | null, value: 'positive' | 'negative') {
    if (!analysis || !range || range.end - range.start < 0.1) {
      setNotice('先圈选至少 0.1 秒的声音。建议圈出一个完整事件。')
      return
    }
    if (range.end - range.start > 15) {
      setNotice('样例请控制在 15 秒内，圈出一个完整目标声音。')
      return
    }
    if (examples.length >= 256) {
      setNotice('最多保存 256 个样例，请移除不再需要的样例。')
      return
    }
    try {
      const example = createExample(analysis.frames, range, value, crypto.randomUUID(), sourceId)
      const retained = examples.filter(
        (e) =>
          !(e.sourceId === sourceId && Math.min(e.end, range.end) > Math.max(e.start, range.start)),
      )
      changeExamples([...retained, example])
      setSelection(range)
      setNotice(
        value === 'positive'
          ? '已加入正例，搜索结果已更新。'
          : '已学习这个反例，相似片段的排序已更新。',
      )
    } catch (err) {
      setError(String(err))
    }
  }
  function undo() {
    if (!history.length) return
    setExamples(history[history.length - 1])
    setHistory((h) => h.slice(0, -1))
    setNotice('已撤销上一次标记。')
  }
  async function play(range?: Range | null) {
    const audio = player.current
    if (!audio || !analysis) return
    if (!range && playing) {
      audio.pause()
      setPlaying(false)
      return
    }
    const region = range ?? selection
    audio.currentTime = region
      ? Math.max(0, region.start - 0.25)
      : audio.currentTime >= analysis.duration
        ? 0
        : audio.currentTime
    playEnd.current = region ? Math.min(analysis.duration, region.end + 0.4) : null
    if (region) setSelection(region)
    try {
      await audio.play()
      setPlaying(true)
    } catch {
      setError('浏览器无法播放此 WAV 编码。请转换为 16-bit PCM WAV 后重试。')
    }
  }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.target as HTMLElement).matches('input,textarea,select,button')) return
      if (event.code === 'Space' && analysis) {
        event.preventDefault()
        void play()
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'z') {
        event.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  async function importSeeds(seedFile?: File) {
    if (!seedFile) return
    try {
      if (seedFile.size > 8_000_000) throw new Error('种子文件过大。')
      const data = JSON.parse(await seedFile.text())
      if (
        data.version !== 1 ||
        data.model !== 'yamnet' ||
        !Array.isArray(data.examples) ||
        data.examples.length > 256 ||
        typeof data.targetName !== 'string'
      )
        throw new Error('不是有效的 SoundSeed v1 种子文件。')
      const imported: Example[] = data.examples.map((e: Example) => {
        if (
          !['positive', 'negative'].includes(e.label) ||
          !Array.isArray(e.embedding) ||
          e.embedding.length !== 1024 ||
          !e.embedding.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e6) ||
          !e.embedding.some((v) => Math.abs(v) > 1e-12) ||
          !Number.isFinite(e.start) ||
          !Number.isFinite(e.end) ||
          e.start < 0 ||
          e.end <= e.start
        )
          throw new Error('种子包含无效的音频特征。')
        return {
          ...e,
          id: crypto.randomUUID(),
          sourceId: typeof e.sourceId === 'string' ? e.sourceId : 'imported',
        }
      })
      changeExamples(imported)
      setTargetName(data.targetName.slice(0, 60))
      setNotice('声音种子已载入，可以在另一条录音中搜索。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法载入种子文件。')
    }
  }
  async function importTruth(truthFile?: File) {
    if (!truthFile || !analysis) return
    try {
      if (truthFile.size > 4_000_000) throw new Error('标注文件过大。')
      const data = JSON.parse(await truthFile.text())
      if (
        data.version !== 1 ||
        data.recording?.name !== analysis.fileName ||
        !Array.isArray(data.events) ||
        data.events.length > 50000
      )
        throw new Error(
          '标注需为 v1 JSON，recording.name 必须与当前 WAV 文件名一致。详见 docs/evaluation.md。',
        )
      if (
        !data.events.every(
          (e: Range) =>
            Number.isFinite(e.start) &&
            Number.isFinite(e.end) &&
            e.start >= 0 &&
            e.end > e.start &&
            e.end <= analysis.duration,
        )
      )
        throw new Error('标注时间必须位于当前录音内。')
      setTruth(data.events)
      setNotice('参考标注已载入。评估会排除参与训练的区域。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取标注。')
    }
  }
  function exportResults(format: 'csv' | 'json') {
    if (!analysis) return
    const confirmed = currentExamples
      .filter((e) => e.label === 'positive')
      .map((e) => ({ start: e.start, end: e.end, score: null, status: 'confirmed' }))
    const rows = [
      ...result.candidates.map((c) => ({
        start: c.start,
        end: c.end,
        score: c.score,
        status: 'candidate',
      })),
      ...confirmed,
    ].sort((a, b) => a.start - b.start)
    if (format === 'csv')
      download(
        'soundseed-results.csv',
        '\uFEFF' +
          [
            ['recording', 'target', 'start_seconds', 'end_seconds', 'score', 'status'],
            ...rows.map((r) => [
              analysis.fileName,
              targetName,
              r.start.toFixed(3),
              r.end.toFixed(3),
              r.score?.toFixed(4) ?? '',
              r.status,
            ]),
          ]
            .map((row) => row.map(csvCell).join(','))
            .join('\r\n'),
        'text/csv;charset=utf-8',
      )
    else
      download(
        'soundseed-results.json',
        JSON.stringify(
          {
            version: 1,
            model: 'yamnet',
            recording: analysis.fileName,
            syntheticDemo: demo,
            duration: analysis.duration,
            target: targetName,
            threshold,
            mode: result.training.mode,
            scoresAreProbabilities: false,
            examples: examples.map(({ embedding: _embedding, ...rest }) => rest),
            events: rows,
            evaluation: metrics,
          },
          null,
          2,
        ),
      )
    setExportOpen(false)
    setNotice(`已导出 ${rows.length} 个候选与已确认事件。`)
  }
  function saveSeeds() {
    download(
      'soundseed.seed.json',
      JSON.stringify(
        {
          version: 1,
          model: 'yamnet',
          targetName,
          examples: examples.map((e) => ({ ...e, embedding: Array.from(e.embedding) })),
        },
        null,
        2,
      ),
    )
    setNotice('声音种子已保存，包含特征和标签，不含录音。')
  }

  const selectionValid = !!selection && selection.end > selection.start
  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files[0] && !progress) void loadFile(e.dataTransfer.files[0])
      }}
    >
      <aside className="sidebar">
        <a className="brand" href="#">
          <span className="brand-mark">
            <AudioLines size={25} />
          </span>
          SoundSeed<span className="version">BETA</span>
        </a>
        <div className="side-label">工作空间</div>
        <button
          className="nav-item active"
          onClick={() =>
            document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth' })
          }
        >
          <Activity size={18} />
          声音探索
          <span className="nav-dot" />
        </button>
        <button className="nav-item" onClick={() => seedInput.current?.click()}>
          <Sprout size={18} />
          载入声音种子
          <ArrowDownToLine size={14} className="ml-auto" />
        </button>
        <button
          className="nav-item"
          disabled={!analysis}
          onClick={() => truthInput.current?.click()}
        >
          <CheckCheck size={18} />
          验证检测结果
        </button>
        <div className="side-divider" />
        <div className="side-label">你的工作流</div>
        <div className="workflow">
          <span className={analysis ? 'done' : 'current'}>
            {analysis ? <Check size={12} /> : '1'}
          </span>
          <div>
            带来一段录音<small>本地 WAV 文件</small>
          </div>
        </div>
        <div className="workflow">
          <span className={positives.length ? 'done' : analysis ? 'current' : ''}>
            {positives.length ? <Check size={12} /> : '2'}
          </span>
          <div>
            种下声音样例<small>圈出几次目标声音</small>
          </div>
        </div>
        <div className="workflow">
          <span className={negatives.length ? 'done' : positives.length ? 'current' : ''}>
            {negatives.length ? <Check size={12} /> : '3'}
          </span>
          <div>
            一起找到更多<small>试听、纠正、导出</small>
          </div>
        </div>
        <div className="side-bottom">
          <div className="privacy-card">
            <LockKeyhole size={18} />
            <strong>你的声音，留在这里。</strong>
            <p>特征提取和学习都在本机完成，录音不会上传。</p>
            <span>
              <i className="dot green" /> LOCAL-FIRST
            </span>
          </div>
          <button className="help-button" onClick={() => setHelp(true)}>
            <CircleHelp size={16} />
            使用指南<span>v0.1.0</span>
          </button>
        </div>
      </aside>
      <main id="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间 <span>/</span> <b>声音探索</b>
          </div>
          <div className="local-status">
            <i className="dot green" />
            浏览器本地处理
          </div>
        </header>
        <div className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">A LITTLE SOUND. A WHOLE NEW WAY TO SEARCH.</div>
              <h1>
                听见每一次<span>。</span>
              </h1>
              <p>圈出几段声音，让整条录音里的相似瞬间浮现。</p>
            </div>
            <button
              className="button primary"
              disabled={!!progress}
              onClick={() => fileInput.current?.click()}
            >
              <Plus size={17} />
              导入录音
            </button>
          </div>
          {error && (
            <div role="alert" className="error-banner">
              <span>{error}</span>
              <button aria-label="关闭错误提示" onClick={() => setError('')}>
                <X size={17} />
              </button>
            </div>
          )}
          {progress && (
            <div role="status" className="progress-panel">
              <LoaderCircle className="spin" size={20} />
              <div>
                <strong>{progress.message}</strong>
                <div className="progress-track">
                  <i style={{ width: `${Math.max(2, progress.progress * 100)}%` }} />
                </div>
                <small>
                  录音正在本机处理 · {Math.round(progress.progress * 100)}% ·
                  长录音首次分析可能需要几分钟
                </small>
              </div>
              <button
                className="button text"
                onClick={() => {
                  abort.current?.abort()
                  setProgress(null)
                  setNotice('已取消分析。')
                }}
              >
                取消
              </button>
            </div>
          )}
          {!analysis ? (
            <>
              <section className="empty-workspace panel">
                <div className="empty-visual">
                  <div className="orb">
                    <AudioLines size={40} />
                  </div>
                  <div className="decor-bars">
                    {Array.from({ length: 53 }, (_, i) => (
                      <i
                        key={i}
                        style={{
                          height: `${12 + Math.abs(Math.sin(i * 1.37)) * 38 + Math.abs(Math.sin(i * 0.2)) * 25}px`,
                        }}
                      />
                    ))}
                  </div>
                </div>
                <span className="pill lavender">听几次，就有线索</span>
                <h2>
                  想找到什么声音？
                  <br />
                  从一段录音开始。
                </h2>
                <p>
                  门铃、鸟鸣、咖啡机提示音……
                  <br />
                  你来定义目标，SoundSeed 帮你寻找。
                </p>
                <button
                  className="button primary large"
                  disabled={!!progress}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={18} />
                  选择本地 WAV 文件
                </button>
                <span className="drop-hint">或拖动文件到这里 · 支持长录音 · 不上传音频</span>
                <div className="empty-separator">
                  <span>还没有准备好录音？</span>
                </div>
                <button
                  className="demo-link"
                  disabled={!!progress}
                  onClick={() => {
                    const d = createDoorbellDemo()
                    void loadFile(d.file, d)
                  }}
                >
                  <Play size={15} fill="currentColor" />
                  体验门铃演示
                  <ArrowRight size={16} />
                </button>
                <small className="demo-disclaimer">
                  一段包含门铃和干扰音的合成录音，实际运行音频模型
                </small>
              </section>
              <div className="feature-strip">
                <div>
                  <Fingerprint />
                  <strong>你定义的声音</strong>
                  <p>用样例描述，不受预设分类限制。</p>
                </div>
                <div>
                  <WandSparkles />
                  <strong>每次纠正，都有回应</strong>
                  <p>标出一个误报，即时重新检索。</p>
                </div>
                <div>
                  <Headphones />
                  <strong>保留声音的上下文</strong>
                  <p>带前后留白试听，不错过线索。</p>
                </div>
              </div>
            </>
          ) : (
            <>
              {demo && showDemoBanner && (
                <div className="demo-banner">
                  <Sparkles size={16} />
                  <span>
                    <b>门铃实验室</b> · 合成录音体验，已选好 2
                    个正例。点击候选试听，再把相似提示音标为误报。
                  </span>
                  <button onClick={() => setShowDemoBanner(false)} aria-label="关闭演示提示">
                    <X size={15} />
                  </button>
                </div>
              )}
              <div className="workspace-grid">
                <div className="workspace-left">
                  <section className="panel recording-panel">
                    <div className="panel-heading">
                      <div className="recording-title">
                        <span className="file-icon">
                          <FileAudio size={21} />
                        </span>
                        <div>
                          <h2 title={analysis.fileName}>{analysis.fileName}</h2>
                          <span>
                            {time(analysis.duration)} <i>·</i>{' '}
                            {(analysis.sourceSampleRate / 1000).toFixed(1)} kHz <i>·</i>{' '}
                            {analysis.sourceChannels === 1
                              ? '单声道'
                              : `${analysis.sourceChannels} 声道`}{' '}
                            <i>·</i> WAV
                          </span>
                        </div>
                      </div>
                      <span className="pill muted">
                        <i className="dot green" />
                        分析完成
                      </span>
                    </div>
                    <Waveform
                      key={sourceId}
                      peaks={analysis.peaks}
                      duration={analysis.duration}
                      selection={selection}
                      candidates={result.candidates}
                      positives={currentExamples.filter((e) => e.label === 'positive')}
                      negatives={currentExamples.filter((e) => e.label === 'negative')}
                      playhead={playhead}
                      onSelect={setSelection}
                    />
                    <div className="transport">
                      <button
                        className="play-button"
                        onClick={() => void play()}
                        title={playing ? '暂停（空格）' : '播放（空格）'}
                        aria-label={playing ? '暂停' : '播放'}
                      >
                        {playing ? (
                          <Pause size={18} fill="currentColor" />
                        ) : (
                          <Play size={18} fill="currentColor" />
                        )}
                      </button>
                      <span className="play-time">
                        {time(playhead)}
                        <small>/ {time(analysis.duration)}</small>
                      </span>
                      <div className="selection-inputs">
                        <label>
                          从
                          <input
                            aria-label="选区开始秒数"
                            type="number"
                            min="0"
                            max={analysis.duration}
                            step="0.01"
                            value={selection ? Number(selection.start.toFixed(2)) : ''}
                            placeholder="0.00"
                            onChange={(e) => {
                              const start = Math.max(
                                0,
                                Math.min(analysis.duration, Number(e.target.value)),
                              )
                              setSelection({
                                start,
                                end: Math.max(
                                  start,
                                  selection?.end ?? Math.min(analysis.duration, start + 1),
                                ),
                              })
                            }}
                          />
                        </label>
                        <span>→</span>
                        <label>
                          至
                          <input
                            aria-label="选区结束秒数"
                            type="number"
                            min="0"
                            max={analysis.duration}
                            step="0.01"
                            value={selection ? Number(selection.end.toFixed(2)) : ''}
                            placeholder="0.00"
                            onChange={(e) =>
                              setSelection({
                                start: selection?.start ?? 0,
                                end: Math.max(
                                  0,
                                  Math.min(analysis.duration, Number(e.target.value)),
                                ),
                              })
                            }
                          />
                        </label>
                        <span>秒</span>
                      </div>
                    </div>
                    <div className="selection-actions">
                      <span>
                        {selectionValid
                          ? `已选 ${time(selection!.start, true)} – ${time(selection!.end, true)}`
                          : '先圈出一段完整的目标声音'}
                      </span>
                      <button
                        className="button small"
                        disabled={!selectionValid}
                        onClick={() => label(selection, 'negative')}
                      >
                        <X size={14} />
                        不是这个声音
                      </button>
                      <button
                        className="button primary small"
                        disabled={!selectionValid}
                        onClick={() => label(selection, 'positive')}
                      >
                        <Plus size={14} />
                        设为正例
                      </button>
                    </div>
                  </section>
                  <section className="panel results-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          发现的声音 <span className="count-badge">{result.candidates.length}</span>
                        </h2>
                        <p>候选需要你来确认，匹配分数不代表概率。</p>
                      </div>
                      <div className="export-wrap">
                        <button
                          className="button small"
                          onClick={() => setExportOpen(!exportOpen)}
                          disabled={!positives.length}
                        >
                          <ArrowDownToLine size={14} />
                          导出结果
                          <ChevronDown size={13} />
                        </button>
                        {exportOpen && (
                          <div className="dropdown">
                            <button onClick={() => exportResults('csv')}>CSV 时间戳</button>
                            <button onClick={() => exportResults('json')}>JSON 完整结果</button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="results-filter">
                      <span>
                        <i className="dot purple" />
                        待复核 {result.candidates.length}
                      </span>
                      <span>
                        <i className="dot green" />
                        已确认 {currentExamples.filter((e) => e.label === 'positive').length}
                      </span>
                      <label className="ml-auto">
                        排序{' '}
                        <select
                          aria-label="结果排序"
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
                          <option value="time">时间顺序</option>
                          <option value="score">匹配分数</option>
                          <option value="review">优先复核</option>
                        </select>
                      </label>
                    </div>
                    {!positives.length ? (
                      <div className="results-empty">
                        <Sprout size={30} />
                        <h3>一颗声音种子，就能开始。</h3>
                        <p>在上方圈选一个目标声音，点击“设为正例”。</p>
                      </div>
                    ) : !candidates.length ? (
                      <div className="results-empty">
                        <Search size={28} />
                        <h3>暂时没有达到阈值的候选</h3>
                        <p>试试降低匹配阈值，或再添加一个不同的正例。</p>
                      </div>
                    ) : (
                      <div className="candidate-list">
                        <div className="table-header">
                          <span>试听</span>
                          <span>出现位置</span>
                          <span>匹配分数</span>
                          <span>你的判断</span>
                        </div>
                        {candidates.slice((page - 1) * 8, page * 8).map((c, i) => (
                          <CandidateRow
                            key={c.id}
                            candidate={c}
                            index={(page - 1) * 8 + i}
                            selected={selection?.start === c.start && selection.end === c.end}
                            nearestIndex={
                              positives.findIndex((e) => e.id === c.nearestExampleId) + 1
                            }
                            onPlay={() => void play(c)}
                            onLabel={(value) =>
                              label(
                                c.end - c.start > 15
                                  ? {
                                      start: Math.max(c.start, c.peakTime - 1.5),
                                      end: Math.min(c.end, c.peakTime + 1.5),
                                    }
                                  : c,
                                value,
                              )
                            }
                          />
                        ))}
                        <div className="results-footer">
                          <span>
                            共 {candidates.length} 个候选片段 · 分析步长 0.48 秒 · 近似定位
                          </span>
                          {candidates.length > 8 && (
                            <div>
                              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                                上一页
                              </button>
                              <span>
                                {page} / {Math.ceil(candidates.length / 8)}
                              </span>
                              <button
                                disabled={page >= Math.ceil(candidates.length / 8)}
                                onClick={() => setPage((p) => p + 1)}
                              >
                                下一页
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                </div>
                <div className="workspace-right">
                  <section className="panel seed-panel">
                    <div className="panel-heading">
                      <h2>
                        <Sprout size={18} />
                        声音种子
                      </h2>
                      <span className="pill lavender">1 个目标</span>
                    </div>
                    <label className="field-label">
                      我想找的声音
                      <input
                        maxLength={60}
                        value={targetName}
                        onChange={(e) => setTargetName(e.target.value)}
                        placeholder="为目标声音取个名字"
                      />
                    </label>
                    <div className="example-counts">
                      <span>
                        <b>{positives.length.toString().padStart(2, '0')}</b>
                        <i className="dot green" />
                        正例
                      </span>
                      <span>
                        <b>{negatives.length.toString().padStart(2, '0')}</b>
                        <i className="dot coral" />
                        反例
                      </span>
                    </div>
                    <div className="examples-list">
                      {examples.length === 0 ? (
                        <p>圈选 2–5 次清晰的声音，通常比只选一次更有帮助。</p>
                      ) : (
                        examples.map((e, i) => (
                          <div className="example-item" key={e.id}>
                            <span className={`example-icon ${e.label}`}>
                              {e.label === 'positive' ? <Check size={13} /> : <X size={13} />}
                            </span>
                            <div>
                              <strong>
                                {e.label === 'positive' ? '正例' : '反例'}{' '}
                                {examples
                                  .filter((x) => x.label === e.label)
                                  .findIndex((x) => x.id === e.id) + 1}
                              </strong>
                              <small>
                                {e.sourceId === sourceId
                                  ? `${time(e.start, true)} – ${time(e.end, true)}`
                                  : '来自另一条录音'}
                              </small>
                            </div>
                            {e.sourceId === sourceId && (
                              <button title="试听样例" onClick={() => void play(e)}>
                                <Play size={13} />
                              </button>
                            )}
                            <button
                              title="移除样例"
                              onClick={() => changeExamples(examples.filter((x) => x.id !== e.id))}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="seed-actions">
                      <button disabled={!history.length} title="撤销上一次标记" onClick={undo}>
                        <RotateCcw size={14} />
                        撤销
                      </button>
                      <button disabled={!examples.length} onClick={() => changeExamples([])}>
                        清空
                      </button>
                      <button disabled={!examples.length} onClick={saveSeeds}>
                        <ArrowDownToLine size={14} />
                        保存种子
                      </button>
                    </div>
                  </section>
                  <section className="panel sensitivity-panel">
                    <h2>
                      <SlidersHorizontal size={16} />
                      匹配阈值 <span>{threshold.toFixed(2)}</span>
                    </h2>
                    <input
                      aria-label="匹配阈值"
                      type="range"
                      min="0.3"
                      max="0.99"
                      step="0.01"
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                    />
                    <div className="range-labels">
                      <span>多找一些</span>
                      <span>更严格</span>
                    </div>
                    <p>
                      {negatives.length
                        ? '已启用反例学习。阈值可控制召回与误报之间的取舍。'
                        : '先用相似度寻找线索，添加反例后会学习区分相似干扰音。'}
                    </p>
                  </section>
                  <section className="review-card">
                    <div className="review-heading">
                      <Sparkles size={17} />
                      <h2>下一段，听这个</h2>
                      <span>SMART REVIEW</span>
                    </div>
                    <p>优先复核阈值附近、与已有样例不同的候选。</p>
                    {prioritized.length ? (
                      prioritized.map((c, i) => (
                        <button key={c.id} onClick={() => void play(c)}>
                          <span className="review-number">0{i + 1}</span>
                          <span>
                            {time(c.start, true)}
                            <small>
                              {(c.end - c.start).toFixed(2)} 秒 · 分数 {c.score.toFixed(2)}
                            </small>
                          </span>
                          <Play size={14} />
                        </button>
                      ))
                    ) : (
                      <div className="review-placeholder">
                        找到候选后，这里会推荐值得先听的片段。
                      </div>
                    )}
                  </section>
                </div>
              </div>
              <section className="panel evaluation-panel">
                <div className="evaluation-intro">
                  <h2>
                    <Activity size={17} />
                    让改善看得见
                  </h2>
                  <p>
                    {truth
                      ? demo
                        ? '合成演示的事件级检查，不代表真实录音准确率。'
                        : '参考标注评估；已排除当前录音的训练区域。'
                      : '载入独立标注，衡量真实事件召回和每小时误报。'}
                  </p>
                  <button className="button small" onClick={() => truthInput.current?.click()}>
                    <FolderOpen size={14} />
                    载入参考标注
                  </button>
                </div>
                <div className="metric">
                  <span>检出的真实事件</span>
                  <b>
                    {metrics
                      ? `${metrics.after.truePositives} / ${metrics.after.truePositives + metrics.after.falseNegatives}`
                      : '—'}
                  </b>
                  <small>
                    {metrics
                      ? `召回 ${(metrics.after.recall * 100).toFixed(0)}% · 精确率 ${(metrics.after.precision * 100).toFixed(0)}%`
                      : '需要参考标注'}
                  </small>
                </div>
                <div className="metric">
                  <span>每小时误报</span>
                  <b>{metrics ? metrics.after.falsePositivesPerHour.toFixed(1) : '—'}</b>
                  <small>
                    {metrics
                      ? `仅正例 ${metrics.before.falsePositivesPerHour.toFixed(1)} 次 / 小时`
                      : '需要完整负样本时长'}
                  </small>
                </div>
                <div className="metric">
                  <span>误报纠正</span>
                  <b>
                    {negatives.length.toString().padStart(2, '0')}
                    <em> 次</em>
                  </b>
                  <small>
                    {Math.max(0, baseline.candidates.length - result.candidates.length)}{' '}
                    个候选被移除或合并
                  </small>
                </div>
              </section>
              <div className="workspace-footnote">
                <LockKeyhole size={13} />
                YAMNet · {analysis.backend.toUpperCase()} · 本地推理
                <span>声音种子可以保存，用于不同日期的录音</span>
              </div>
            </>
          )}
          <footer className="footer">
            <span>
              SoundSeed <i>·</i> 每一次声音，都值得被找到。
            </span>
            <span>
              BUILT FOR CURIOUS EARS <Leaf size={12} />
            </span>
          </footer>
        </div>
      </main>
      <input
        ref={fileInput}
        type="file"
        accept=".wav,audio/wav,audio/x-wav"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) void loadFile(e.target.files[0])
          e.target.value = ''
        }}
      />
      <input
        ref={seedInput}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => {
          void importSeeds(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <input
        ref={truthInput}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => {
          void importTruth(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <audio
        ref={player}
        src={audioUrl || undefined}
        onTimeUpdate={(e) => {
          const a = e.currentTarget
          setPlayhead(a.currentTime)
          if (playEnd.current !== null && a.currentTime >= playEnd.current) {
            a.pause()
            setPlaying(false)
            playEnd.current = null
          }
        }}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
      />
      {notice && (
        <div role="status" className="toast">
          <Check size={16} />
          {notice}
        </div>
      )}
      {dragOver && (
        <div className="drop-overlay">
          <Upload size={48} />
          <h2>把录音放在这里</h2>
          <p>声音会留在你的设备上</p>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-label="使用指南"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="close-modal" aria-label="关闭指南" onClick={() => setHelp(false)}>
              <X size={20} />
            </button>
            <span className="brand-mark">
              <AudioLines size={25} />
            </span>
            <h2>让声音成为搜索词。</h2>
            <ol>
              <li>
                <strong>导入录音</strong>
                <p>
                  支持 PCM 或浮点 WAV。首次使用先运行 pnpm setup:model
                  下载官方模型，此后推理无需联网。
                </p>
              </li>
              <li>
                <strong>圈选样例</strong>
                <p>
                  拖动波形或输入起止秒数，圈选一个完整事件，点击“设为正例”。放大时间线能更准确地选区。
                </p>
              </li>
              <li>
                <strong>试听和纠正</strong>
                <p>用“是这个”增加正例，用“不是”学习反例。空格播放选区，Ctrl / ⌘ Z 撤销标记。</p>
              </li>
              <li>
                <strong>带走结果</strong>
                <p>
                  导出 CSV / JSON 时间戳。保存声音种子，再导入另一日期的 WAV，验证它是否仍然有效。
                </p>
              </li>
            </ol>
            <div className="help-note">
              分数是排序依据，不是概率。0.96
              秒模型窗口适合重复声音检索；极短、重叠或与背景非常相近的声音可能漏检。
            </div>
            <button className="button primary" onClick={() => setHelp(false)}>
              开始探索
              <ArrowRight size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  )
}

function CandidateRow({
  candidate: c,
  index,
  selected,
  nearestIndex,
  onPlay,
  onLabel,
}: {
  candidate: Candidate
  index: number
  selected: boolean
  nearestIndex: number
  onPlay: () => void
  onLabel: (value: 'positive' | 'negative') => void
}) {
  return (
    <div className={`candidate-row ${selected ? 'selected' : ''}`}>
      <button
        className="candidate-play"
        onClick={onPlay}
        aria-label={`试听候选 ${index + 1}，${time(c.start)}`}
      >
        <Play size={14} fill="currentColor" />
      </button>
      <div className="candidate-time">
        <strong>
          {time(c.start, true)}
          <span> → </span>
          {time(c.end, true)}
        </strong>
        <small>
          {(c.end - c.start).toFixed(2)} 秒 · 最像正例 {nearestIndex}
        </small>
      </div>
      <div className="candidate-score">
        <span>{c.score.toFixed(2)}</span>
        <i>
          <b style={{ width: `${c.score * 100}%` }} />
        </i>
      </div>
      <div className="candidate-feedback">
        <button title="确认为目标声音" onClick={() => onLabel('positive')}>
          <Check size={14} />
          是这个
        </button>
        <button title="标记为误报并学习" onClick={() => onLabel('negative')}>
          <X size={14} />
          不是
        </button>
      </div>
    </div>
  )
}
