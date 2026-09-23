export function time(seconds: number, precise = false) {
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = precise
    ? (s % 60).toFixed(2).padStart(5, '0')
    : Math.floor(s % 60)
        .toString()
        .padStart(2, '0')
  return `${h ? `${h}:` : ''}${m.toString().padStart(2, '0')}:${sec}`
}
export function download(name: string, body: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([body], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function csvCell(value: unknown) {
  let s = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replaceAll('"', '""')}"`
}
