const CHUNK_BYTES = 4 * 1024 * 1024
const ID_VERSION = 'wav-sha256tree-v1:'

/**
 * Content identity independent of filename and filesystem timestamps.
 * This versioned hash tree is NOT a standard whole-file SHA-256.
 * Only one 4 MiB audio chunk and the small list of digests are held at once.
 */
export async function fingerprintFile(
  file: Blob,
  onProgress?: (progress: number) => void,
): Promise<string> {
  const header = new TextEncoder().encode(`${ID_VERSION}${CHUNK_BYTES}:`)
  const chunkCount = Math.ceil(file.size / CHUNK_BYTES)
  const manifest = new Uint8Array(header.length + 8 + chunkCount * 32)
  manifest.set(header)
  new DataView(manifest.buffer).setBigUint64(header.length, BigInt(file.size), false)
  onProgress?.(0)
  for (let index = 0; index < chunkCount; index++) {
    const start = index * CHUNK_BYTES
    const bytes = await file.slice(start, Math.min(file.size, start + CHUNK_BYTES)).arrayBuffer()
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    manifest.set(new Uint8Array(hash), header.length + 8 + index * 32)
    onProgress?.((index + 1) / chunkCount)
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', manifest))
  onProgress?.(1)
  return ID_VERSION + Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
