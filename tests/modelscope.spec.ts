import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateModelScopeImage } from '../src/modelscope.js'

afterEach(() => { vi.unstubAllGlobals() })
const signal = new AbortController().signal

const PLAN = { kind: 'size' as const, size: '768x1024', notes: [] }

describe('ModelScope async adapter', () => {
  it('submits with the async header, polls until SUCCEED, and downloads the output image', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'task-abc' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_status: 'RUNNING' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_status: 'SUCCEED', output_images: ['https://modelscope-cdn.example/result.png'] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(generateModelScopeImage({
      apiKey: 'ms-key', baseURL: 'https://api-inference.modelscope.cn/v1', model: 'Tongyi-MAI/Z-Image-Turbo', prompt: 'a poster',
      plan: PLAN, maxBytes: 1024, signal, pollIntervalMs: 5,
    })).resolves.toEqual({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' })

    const [submitUrl, submitInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(submitUrl).toBe('https://api-inference.modelscope.cn/v1/images/generations')
    expect((submitInit.headers as Record<string, string>)['X-ModelScope-Async-Mode']).toBe('true')
    expect((submitInit.headers as Record<string, string>).authorization).toBe('Bearer ms-key')
    expect(JSON.parse(String(submitInit.body))).toMatchObject({ model: 'Tongyi-MAI/Z-Image-Turbo', prompt: 'a poster', size: '768x1024' })
    const [pollUrl, pollInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(pollUrl).toBe('https://api-inference.modelscope.cn/v1/tasks/task-abc')
    expect((pollInit.headers as Record<string, string>)['X-ModelScope-Task-Type']).toBe('image_generation')
    const [downloadUrl, downloadInit] = fetchMock.mock.calls[3] as unknown as [string, RequestInit]
    expect(downloadUrl).toBe('https://modelscope-cdn.example/result.png')
    expect((downloadInit as RequestInit | undefined)?.headers).toBeUndefined()
  })

  it('surfaces a failed task with its payload', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'task-xyz' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_status: 'FAILED', message: 'quota exceeded' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateModelScopeImage({
      apiKey: 'ms-key', baseURL: 'https://api-inference.modelscope.cn/v1', model: 'Tongyi-MAI/Z-Image-Turbo', prompt: 'a poster',
      plan: PLAN, maxBytes: 1024, signal, pollIntervalMs: 5,
    })).rejects.toThrow('modelscope task task-xyz failed (FAILED)')
  })

  it('fails clearly when the submission returns no task id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'no capacity' }), { status: 200 })))
    await expect(generateModelScopeImage({
      apiKey: 'ms-key', baseURL: 'https://api-inference.modelscope.cn/v1', model: 'Tongyi-MAI/Z-Image-Turbo', prompt: 'a poster',
      plan: PLAN, maxBytes: 1024, signal,
    })).rejects.toThrow('returned no task_id')
  })

  it('carries ModelScope wire names for optional parameters', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'task-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_status: 'FAILED' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await generateModelScopeImage({
      apiKey: 'ms-key', baseURL: 'https://api-inference.modelscope.cn/v1', model: 'Tongyi-MAI/Z-Image-Turbo', prompt: 'a poster',
      plan: PLAN, maxBytes: 1024, signal, pollIntervalMs: 5,
      negativePrompt: 'blurry', steps: 30, guidance: 5, seed: 7,
    }).catch(() => undefined)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({ negative_prompt: 'blurry', steps: 30, guidance: 5, seed: 7 })
    expect(body.num_inference_steps).toBeUndefined()
    expect(body.guidance_scale).toBeUndefined()
  })
})
