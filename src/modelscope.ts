/**
 * ModelScope (api-inference.modelscope.cn) open-platform image adapter.
 *
 * ModelScope speaks an async task protocol on top of OpenAI-shaped routes:
 * generation submits with `X-ModelScope-Async-Mode: true` and answers a bare
 * task id; polling `GET /tasks/{id}` with `X-ModelScope-Task-Type:
 * image_generation` runs until SUCCEED/FAILED, and success carries
 * `output_images[]` as plain CDN URLs. Wire dialect notes: sampling steps are
 * `steps` (not num_inference_steps) and guidance is `guidance` (not
 * guidance_scale); `size` is a free-form "WxH" string with 512–2048 per side.
 * Editing is deliberately unsupported until the protocol is verified.
 */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { SizePlan } from './vocab.js'

const POLL_INTERVAL_MS = 2_500
const POLL_TIMEOUT_MS = 240_000
const ERROR_LIMIT = 4096

export interface GeneratedModelScopeImage {
  data: Uint8Array
  mediaType: ImageMediaType
}

/** Statuses the task endpoint reports while work is still in flight. */
const NON_TERMINAL_STATUSES = new Set(['PENDING', 'RUNNING', 'QUEUED', 'PROCESSING', 'RETRYING'])

/** Turn a validated SizePlan into ModelScope's `size` string. */
function planSize(plan: SizePlan): string {
  if (plan.kind === 'size' && plan.size !== undefined && plan.size.length > 0) return plan.size
  if (plan.kind === 'width_height' && plan.width !== undefined && plan.height !== undefined) return `${Math.round(plan.width)}x${Math.round(plan.height)}`
  return '1024x1024'
}

export async function generateModelScopeImage(input: {
  apiKey: string
  baseURL: string
  model: string
  prompt: string
  plan: SizePlan
  maxBytes: number
  signal: AbortSignal
  negativePrompt?: string | undefined
  steps?: number | undefined
  guidance?: number | undefined
  seed?: number | undefined
  numImages?: number | undefined
  /** Poll cadence override (tests); default 2.5s. */
  pollIntervalMs?: number | undefined
}): Promise<GeneratedModelScopeImage> {
  const submitResponse = await fetch(modelscopeEndpoint(input.baseURL, 'images/generations'), {
    method: 'POST', redirect: 'error', signal: input.signal,
    headers: {
      authorization: `Bearer ${input.apiKey.trim()}`,
      'content-type': 'application/json',
      'X-ModelScope-Async-Mode': 'true',
    },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      size: planSize(input.plan),
      ...(input.negativePrompt !== undefined && input.negativePrompt.trim() !== '' ? { negative_prompt: input.negativePrompt.trim() } : {}),
      ...(input.steps !== undefined ? { steps: input.steps } : {}),
      ...(input.guidance !== undefined ? { guidance: input.guidance } : {}),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      ...(input.numImages !== undefined && input.numImages > 1 ? { num_images_per_prompt: input.numImages } : {}),
    }),
  })
  const submitText = await readBoundedText(submitResponse, ERROR_LIMIT * 4)
  if (!submitResponse.ok) throw new Error(`modelscope submission failed (${submitResponse.status}): ${submitText.slice(0, ERROR_LIMIT)}`)
  let submitPayload: unknown
  try { submitPayload = JSON.parse(submitText) } catch { throw new Error('modelscope submission returned invalid JSON') }
  const taskId = (submitPayload as Record<string, unknown> | null)?.task_id
  if (typeof taskId !== 'string' || taskId.trim() === '') {
    throw new Error(`modelscope submission returned no task_id: ${submitText.slice(0, ERROR_LIMIT)}`)
  }

  const startedAt = Date.now()
  const pollIntervalMs = input.pollIntervalMs ?? POLL_INTERVAL_MS
  for (;;) {
    await signalAwareDelay(pollIntervalMs, input.signal)
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error(`modelscope task ${taskId} did not finish within ${String(Math.round(POLL_TIMEOUT_MS / 1000))} seconds`)
    }
    const pollResponse = await fetch(modelscopeEndpoint(input.baseURL, `tasks/${encodeURIComponent(taskId)}`), {
      method: 'GET', redirect: 'error', signal: input.signal,
      headers: {
        authorization: `Bearer ${input.apiKey.trim()}`,
        'X-ModelScope-Task-Type': 'image_generation',
      },
    })
    const pollText = await readBoundedText(pollResponse, ERROR_LIMIT * 16)
    if (!pollResponse.ok) throw new Error(`modelscope task poll failed (${pollResponse.status}): ${pollText.slice(0, ERROR_LIMIT)}`)
    let task: unknown
    try { task = JSON.parse(pollText) } catch { throw new Error('modelscope task poll returned invalid JSON') }
    const record = typeof task === 'object' && task !== null ? task as Record<string, unknown> : {}
    const status = typeof record.task_status === 'string' ? record.task_status : ''
    if (status === 'SUCCEED') {
      const urls = outputImageUrls(record)
      const url = urls[0]
      if (url === undefined) throw new Error(`modelscope task ${taskId} succeeded without output images: ${pollText.slice(0, ERROR_LIMIT)}`)
      return downloadImage(url, input)
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      throw new Error(`modelscope task ${taskId} failed (${status}): ${pollText.slice(0, ERROR_LIMIT)}`)
    }
    if (status !== '' && !NON_TERMINAL_STATUSES.has(status)) {
      // Unknown status: keep polling until the timeout, but surface it in the
      // final timeout error rather than guessing.
    }
  }
}

/** Extract the image URLs from a succeeded task payload, tolerating nesting. */
function outputImageUrls(record: Record<string, unknown>): string[] {
  const direct = record.output_images
  if (Array.isArray(direct)) return direct.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  const nested = (record.output ?? record.data) as Record<string, unknown> | undefined
  if (nested !== null && typeof nested === 'object' && Array.isArray(nested.output_images)) {
    return nested.output_images.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  }
  return []
}

async function downloadImage(url: string, input: { maxBytes: number; signal: AbortSignal }): Promise<GeneratedModelScopeImage> {
  if (url.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(url.trim())
    if (match?.[1] === undefined || match[2] === undefined) throw new Error('modelscope returned an invalid data URL')
    const decoded = Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
    return { data: new Uint8Array(decoded), mediaType: imageMediaType(match[1]) ?? 'image/png' }
  }
  const response = await fetch(url, { redirect: 'follow', signal: input.signal })
  if (!response.ok) throw new Error(`modelscope image download failed (${response.status})`)
  const mediaType = imageMediaType(response.headers.get('content-type'))
  if (mediaType === undefined) throw new Error('modelscope image download returned unsupported content type')
  return { data: await readBoundedBytes(response, input.maxBytes), mediaType }
}

function modelscopeEndpoint(baseURL: string, suffix: string): string {
  try { return new URL(suffix, `${baseURL.trim().replace(/\/+$/, '')}/`).toString() } catch { throw new Error('ModelScope endpoint must be an absolute URL') }
}

function imageMediaType(value: string | null | undefined): ImageMediaType | undefined {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp' || mediaType === 'image/gif' ? mediaType : undefined
}

/** Delay that rejects immediately when the caller's signal aborts. */
function signalAwareDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = (): void => { clearTimeout(timer); reject(new Error('modelscope request was cancelled')) }
    if (signal.aborted) { onAbort(); return }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> { return new TextDecoder().decode(await readBoundedBytes(response, maxBytes)) }

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0
  try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > maxBytes) throw new Error(`Image response exceeded the ${String(maxBytes)} byte limit`); chunks.push(next.value) } } finally { reader.releaseLock() }
  const joined = new Uint8Array(bytes); let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return joined
}
