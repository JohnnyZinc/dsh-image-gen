/** Normalize generated image bytes to PNG before Attachment persistence. */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

export interface PngResult {
  data: Uint8Array
  mediaType: ImageMediaType
}

interface SharpLike {
  (input: Uint8Array): { png(): { toBuffer(): Promise<Buffer> } }
}

/**
 * Re-encode any supported raster to an 8-bit PNG. PNG input passes through
 * unchanged; JPEG/WebP/GIF are decoded from their real bytes (sharp
 * auto-detects the container) and re-encoded as PNG so every channel persists
 * a uniform `image/png`.
 *
 * sharp is loaded lazily from the host's node_modules at runtime; if it is
 * unavailable we fall back to the original bytes so generation never regresses.
 */
export async function toPng(data: Uint8Array, mediaType: ImageMediaType): Promise<PngResult> {
  if (mediaType === 'image/png') return { data, mediaType }
  try {
    const mod = await import('sharp') as { default?: unknown } | Record<string, unknown>
    const sharp = ((mod as { default?: unknown }).default ?? mod) as SharpLike
    const buf = await sharp(data).png().toBuffer()
    return { data: new Uint8Array(buf), mediaType: 'image/png' }
  } catch {
    // sharp missing or conversion failed — keep the original output rather than drop it.
    return { data, mediaType }
  }
}
