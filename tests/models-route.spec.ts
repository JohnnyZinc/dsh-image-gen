import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { listChannelModels, serveModels } from '../src/models-route.js'

afterEach(() => { vi.unstubAllGlobals() })

function fakeReq(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  } as unknown as IncomingMessage
}

function fakeRes(): { res: ServerResponse; status: () => number; body: () => any } {
  let statusCode = 0
  let payload: any
  const res = {
    writeHead(status: number): void { statusCode = status },
    end(data?: Buffer): void { payload = data === undefined ? undefined : JSON.parse(data.toString('utf8')) },
  } as unknown as ServerResponse
  return { res, status: () => statusCode, body: () => payload }
}

describe('models discovery route', () => {
  it('rejects non-POST requests', async () => {
    const req = { method: 'GET', headers: {} } as unknown as IncomingMessage
    const { res, status } = fakeRes()
    await serveModels(req, res, { resolveCredential: vi.fn() })
    expect(status()).toBe(405)
  })

  it('resolves the channel credential host-side and returns flagged models', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'z-image-turbo' }, { id: 'wanx2.1-t2i-turbo' }, { id: 'qwen2.5-72b-instruct' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const resolveCredential = vi.fn(async (credentialEnv: string) => {
      expect(credentialEnv).toBe('GITEE_API_KEY')
      return { value: 'gitee-token' }
    })
    const { res, status, body } = fakeRes()
    await serveModels(fakeReq({ provider: 'gitee', baseURL: 'https://ai.gitee.com/v1' }), res, { resolveCredential })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ai.gitee.com/v1/models')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer gitee-token')
    expect(status()).toBe(200)
    const payload = body()
    expect(payload.ok).toBe(true)
    // Server order is alphabetical; the settings card sorts image-likely ids first.
    expect(payload.models).toEqual([
      { id: 'qwen2.5-72b-instruct', image: false },
      { id: 'wanx2.1-t2i-turbo', image: true },
      { id: 'z-image-turbo', image: true },
    ])
  })

  it('attempts the request keylessly when no credential is configured (public endpoints)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'z-image-turbo' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { res, body } = fakeRes()
    await serveModels(fakeReq({ provider: 'gitee', baseURL: 'https://ai.gitee.com/v1' }), res, { resolveCredential: vi.fn(async () => undefined) })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ai.gitee.com/v1/models')
    expect((init.headers as Record<string, string> | undefined)?.authorization).toBeUndefined()
    expect(body().ok).toBe(true)
    expect(body().models).toEqual([{ id: 'z-image-turbo', image: true }])
  })

  it('retries keylessly when an authenticated listing comes back empty (Gitee behavior)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: 'list', data: [{ id: 'z-image-turbo' }, { id: 'FLUX.2-dev' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { res, body } = fakeRes()
    await serveModels(fakeReq({ provider: 'gitee', baseURL: 'https://ai.gitee.com/v1' }), res, { resolveCredential: vi.fn(async () => ({ value: 'stored-key' })) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect((firstInit.headers as Record<string, string>).authorization).toBe('Bearer stored-key')
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(secondInit.headers).toBeUndefined()
    expect(body().ok).toBe(true)
    expect(body().models.map((entry: { id: string }) => entry.id)).toEqual(['FLUX.2-dev', 'z-image-turbo'])
  })

  it('reports an unparseable 200 listing instead of a silent empty result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>blocked</html>', { status: 200 })))
    const { res, body } = fakeRes()
    await serveModels(fakeReq({ provider: 'gitee', baseURL: 'https://ai.gitee.com/v1' }), res, { resolveCredential: vi.fn(async () => undefined) })
    expect(body().ok).toBe(false)
    expect(body().error).toContain('非 JSON')
  })

  it('reports a 200 body without any listing shape instead of a silent empty result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'no permission' }), { status: 200 })))
    const { res, body } = fakeRes()
    await serveModels(fakeReq({ provider: 'gitee', baseURL: 'https://ai.gitee.com/v1' }), res, { resolveCredential: vi.fn(async () => undefined) })
    expect(body().ok).toBe(false)
    expect(body().error).toContain('无法解析')
  })

  it('turns an auth rejection into a configure-your-key hint when unauthenticated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    const { res, body } = fakeRes()
    await serveModels(fakeReq({ provider: 'gitee', baseURL: 'https://ai.gitee.com/v1' }), res, { resolveCredential: vi.fn(async () => undefined) })
    expect(body().ok).toBe(false)
    expect(body().error).toContain('GITEE_API_KEY')
  })

  it('rejects channels without an OpenAI-shaped models endpoint', async () => {
    const { res, body } = fakeRes()
    await serveModels(fakeReq({ provider: 'google', baseURL: 'https://generativelanguage.googleapis.com/v1beta/interactions' }), res, { resolveCredential: vi.fn() })
    expect(body().ok).toBe(false)
  })

  it('surfaces upstream failures as client-displayable errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    const { res, body } = fakeRes()
    await serveModels(fakeReq({ provider: 'openai', baseURL: 'https://relay.example/v1' }), res, { resolveCredential: vi.fn(async () => ({ value: 'key' })) })
    expect(body().ok).toBe(false)
    expect(body().error).toContain('HTTP 401')
  })

  it('strips the Google models/ prefix and flags image models', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'models/gemini-2.5-flash-image' }, { id: 'models/gemini-2.5-pro' }] }), { status: 200 })))
    const flagged = await listChannelModels('openai', 'https://relay.example/v1', 'key', new AbortController().signal)
    expect(flagged).toEqual([
      { id: 'gemini-2.5-flash-image', image: true },
      { id: 'gemini-2.5-pro', image: false },
    ])
  })
})
