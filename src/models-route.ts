/**
 * Host-side model discovery for the settings card: proxies the upstream
 * `/models` list so the API key never reaches the browser. The card posts
 * `{ provider, baseURL }`; the credential is resolved host-side from the
 * store. Google and ComfyUI are intentionally unsupported here — Google's
 * model listing speaks a different API, and ComfyUI models are the imported
 * workflows managed directly in the card.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DASHSCOPE_API_KEY_ENV, GITEE_API_KEY_ENV, MODELSCOPE_API_KEY_ENV, OPENAI_API_KEY_ENV, SEEDREAM_API_KEY_ENV, type ImageProvider } from './config.js'
import { MODELS_ROUTE } from './shared.js'

export { MODELS_ROUTE } from './shared.js'

const MAX_BODY_BYTES = 64 * 1024

/** Credential refs that back an OpenAI-shaped `/models` endpoint. */
const PROVIDER_CREDENTIALS: Partial<Record<ImageProvider, string>> = {
  openai: OPENAI_API_KEY_ENV,
  seedream: SEEDREAM_API_KEY_ENV,
  dashscope: DASHSCOPE_API_KEY_ENV,
  gitee: GITEE_API_KEY_ENV,
  modelscope: MODELSCOPE_API_KEY_ENV,
}

/** Conservative naming heuristic that flags likely image-generation models. */
const IMAGE_LIKELY_PATTERN = /(?:^|[-_.])(?:image|img|diffusion|flux|cogview|imagen|seedream|nanobanana|grok-imagine|dall-e|stable-diffusion|sdxl|kolors|z-image|wanx|qwen-image|hidream|playground|jimeng|hunyuan)/i

export interface ModelsRouteDeps {
  resolveCredential(credentialEnv: string): Promise<{ value: string } | undefined>
}

export interface DiscoveredModel {
  id: string
  /** Whether the model id matches the image-generation naming heuristic. */
  image: boolean
}

/** One upstream /models failure carrying its HTTP status (auth handling). */
export class UpstreamModelsError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'UpstreamModelsError'
    this.status = status
  }
}

/** Fetch and normalize one OpenAI-shaped `/models` listing. An empty apiKey sends an unauthenticated request (public endpoints like Gitee AI's). */
export async function listChannelModels(provider: Exclude<ImageProvider, 'google' | 'comfyui'>, baseURL: string, apiKey: string, signal: AbortSignal): Promise<DiscoveredModel[]> {
  const models = await requestModelListing(baseURL, apiKey, signal)
  if (models.length > 0 || apiKey === '') return models
  // Some gateways (Gitee AI among them) answer 200 with an EMPTY list when
  // their /models lookup does not recognize the bearer token, even though the
  // same token works for generation. The public listing is authoritative, so
  // an authenticated-but-empty answer falls back to one keyless request.
  const keyless = await requestModelListing(baseURL, '', signal)
  return keyless.length > 0 ? keyless : models
}

async function requestModelListing(baseURL: string, apiKey: string, signal: AbortSignal): Promise<DiscoveredModel[]> {
  const url = `${baseURL.trim().replace(/\/+$/, '')}/models`
  const response = await fetch(url, {
    method: 'GET', redirect: 'error', signal,
    ...(apiKey === '' ? {} : { headers: { authorization: `Bearer ${apiKey}` } }),
  })
  const text = await response.text()
  if (!response.ok) throw new UpstreamModelsError(`获取模型列表失败 (HTTP ${String(response.status)})：${text.slice(0, 200)}`, response.status)
  let payload: unknown
  try { payload = JSON.parse(text) } catch { throw new UpstreamModelsError('端点返回了非 JSON 的模型列表', response.status) }
  const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {}
  const data = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : undefined
  if (data === undefined) {
    // 200 but no recognizable listing shape — surface it instead of a silent empty list.
    throw new UpstreamModelsError(`端点返回了无法解析的模型列表：${text.slice(0, 200)}`, response.status)
  }
  const ids = new Set<string>()
  for (const item of data) {
    if (typeof item === 'string' && item.trim() !== '') { ids.add(item.trim()); continue }
    if (typeof item !== 'object' || item === null) continue
    const raw = (item as Record<string, unknown>).id
    if (typeof raw !== 'string') continue
    const id = raw.trim().replace(/^models\//, '')
    if (id !== '') ids.add(id)
  }
  return [...ids].sort().map(id => ({ id, image: IMAGE_LIKELY_PATTERN.test(id) }))
}

/** Serve the same-origin model-discovery request. */
export async function serveModels(req: IncomingMessage, res: ServerResponse, deps: ModelsRouteDeps): Promise<void> {
  if (req.method !== 'POST') return jsonError(res, 405, 'method-not-allowed')
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return jsonError(res, 415, 'json-required')
  const origin = req.headers.origin
  const host = req.headers.host
  if (origin !== undefined && host !== undefined && origin !== `http://${host}` && origin !== `https://${host}`) {
    return jsonError(res, 403, 'origin-rejected')
  }
  let body: unknown
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    return jsonError(res, 400, 'invalid-request')
  }
  const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  const provider = typeof record.provider === 'string' ? record.provider.trim() : ''
  const baseURL = typeof record.baseURL === 'string' ? record.baseURL.trim() : ''
  const credentialOverride = typeof record.apiKey === 'string' ? record.apiKey.trim() : ''
  const credentialEnv = PROVIDER_CREDENTIALS[provider as ImageProvider]
  if (credentialEnv === undefined) {
    return writeJson(res, { ok: false, error: '该渠道不支持自动获取模型，请在下方手动添加' })
  }
  if (!/^https?:\/\//i.test(baseURL)) {
    return writeJson(res, { ok: false, error: '请先填写有效的 API 地址（http/https）' })
  }
  // A key typed into the card (not yet saved) wins; otherwise the stored
  // credential is used; with neither the request goes out unauthenticated —
  // public endpoints like Gitee AI's /v1/models still answer, and only an
  // auth rejection turns into a configure-your-key hint.
  let apiKey = credentialOverride
  if (apiKey === '') {
    let credential: { value: string } | undefined
    try {
      credential = await deps.resolveCredential(credentialEnv)
    } catch {
      credential = undefined
    }
    apiKey = credential === undefined || credential.value.trim() === '' ? '' : credential.value.trim()
  }
  try {
    const models = await listChannelModels(provider as Exclude<ImageProvider, 'google' | 'comfyui'>, baseURL, apiKey, new AbortController().signal)
    return writeJson(res, { ok: true, models })
  } catch (error) {
    if (error instanceof UpstreamModelsError && apiKey === '' && (error.status === 401 || error.status === 403)) {
      return writeJson(res, { ok: false, error: `端点要求鉴权：请先配置 ${credentialEnv} 凭据后再获取模型` })
    }
    return writeJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    bytes += buffer.byteLength
    if (bytes > MAX_BODY_BYTES) throw new Error('request too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function writeJson(res: ServerResponse, payload: unknown): void {
  const data = Buffer.from(JSON.stringify(payload))
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(data.byteLength), 'cache-control': 'no-store' })
  res.end(data)
}

function jsonError(res: ServerResponse, status: number, code: string): void {
  const data = Buffer.from(JSON.stringify({ ok: false, error: code }))
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(data.byteLength), 'cache-control': 'no-store' })
  res.end(data)
}
