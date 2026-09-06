import { afterEach, describe, expect, it, vi } from 'vitest'
import { editGiteeImage, generateGiteeImage } from '../src/gitee.js'

afterEach(() => { vi.unstubAllGlobals() })
const signal = new AbortController().signal

function b64Response(): Response {
  const image = Buffer.from('gitee image bytes').toString('base64')
  return new Response(JSON.stringify({ data: [{ b64_json: image }] }), { headers: { 'content-type': 'application/json' } })
}

describe('Gitee AI adapter', () => {
  it('posts a preset-size generation to the Gitee endpoint', async () => {
    const fetchMock = vi.fn(async () => b64Response())
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateGiteeImage({
      apiKey: 'gitee-key', baseURL: 'https://ai.gitee.com/v1', model: 'z-image-turbo', prompt: 'a portrait',
      plan: { kind: 'size', size: '768x1024', notes: [] }, maxBytes: 1024, signal,
    })).resolves.toEqual({ data: new Uint8Array(Buffer.from('gitee image bytes')), mediaType: 'image/png' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ai.gitee.com/v1/images/generations')
    expect(init.headers).toMatchObject({ authorization: 'Bearer gitee-key' })
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({ model: 'z-image-turbo', prompt: 'a portrait', size: '768x1024' })
    expect(body.width).toBeUndefined()
    expect(body.height).toBeUndefined()
  })

  it('sends width/height fields instead of size for exact resolutions', async () => {
    const fetchMock = vi.fn(async () => b64Response())
    vi.stubGlobal('fetch', fetchMock)
    await generateGiteeImage({
      apiKey: 'gitee-key', baseURL: 'https://ai.gitee.com/v1/', model: 'z-image-turbo', prompt: 'a portrait',
      plan: { kind: 'width_height', width: 864, height: 1152, notes: [] }, maxBytes: 1024, signal,
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.width).toBe(864)
    expect(body.height).toBe(1152)
    expect(body.size).toBeUndefined()
  })

  it('omits every size field when the plan says omit', async () => {
    const fetchMock = vi.fn(async () => b64Response())
    vi.stubGlobal('fetch', fetchMock)
    await generateGiteeImage({
      apiKey: 'gitee-key', baseURL: 'https://ai.gitee.com/v1', model: 'wanx2.1-t2i-turbo', prompt: 'a portrait',
      plan: { kind: 'omit', notes: [] }, maxBytes: 1024, signal,
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.size).toBeUndefined()
    expect(body.width).toBeUndefined()
    expect(body.height).toBeUndefined()
  })

  it('carries optional z-image parameters under their wire names', async () => {
    const fetchMock = vi.fn(async () => b64Response())
    vi.stubGlobal('fetch', fetchMock)
    await generateGiteeImage({
      apiKey: 'gitee-key', baseURL: 'https://ai.gitee.com/v1', model: 'z-image-turbo', prompt: 'a portrait',
      plan: { kind: 'size', size: '1024x1024', notes: [] }, maxBytes: 1024, signal,
      negativePrompt: 'blurry', steps: 8, guidanceScale: 2.5, seed: 42, numImages: 2,
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({ negative_prompt: 'blurry', num_inference_steps: 8, guidance_scale: 2.5, seed: 42, num_images_per_prompt: 2 })
  })

  it('downloads URL outputs with the shared tolerant parser', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://gitee-image.example/result' }] }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9, 8, 7]), { headers: { 'content-type': 'image/jpeg' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateGiteeImage({
      apiKey: 'gitee-key', baseURL: 'https://ai.gitee.com/v1', model: 'z-image-turbo', prompt: 'a portrait',
      plan: { kind: 'size', size: '1024x1024', notes: [] }, maxBytes: 1024, signal,
    })).resolves.toEqual({ data: new Uint8Array([9, 8, 7]), mediaType: 'image/jpeg' })
  })

  it('surfaces upstream failures under the gitee provider label', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "参数无效 'size'" } }), { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateGiteeImage({
      apiKey: 'gitee-key', baseURL: 'https://ai.gitee.com/v1', model: 'z-image-turbo', prompt: 'a portrait',
      plan: { kind: 'size', size: '864x1152', notes: [] }, maxBytes: 1024, signal,
    })).rejects.toThrow('gitee image request failed (400)')
  })

  it('edits through multipart /images/edits with plan fields appended', async () => {
    const fetchMock = vi.fn(async () => b64Response())
    vi.stubGlobal('fetch', fetchMock)
    await editGiteeImage({
      apiKey: 'gitee-key', baseURL: 'https://ai.gitee.com/v1', model: 'z-image-turbo', prompt: 'make it warmer',
      sourceImages: [{ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }],
      plan: { kind: 'size', size: '1024x1024', notes: [] }, maxBytes: 1024, signal,
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ai.gitee.com/v1/images/edits')
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined()
    const form = init.body as FormData
    expect(form.get('model')).toBe('z-image-turbo')
    expect(form.get('prompt')).toBe('make it warmer')
    expect(form.get('size')).toBe('1024x1024')
    expect(form.get('image')).toBeInstanceOf(Blob)
  })
})
