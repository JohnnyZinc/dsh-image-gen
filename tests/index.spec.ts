import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-settings', () => {
  // Prototype method so the dual-path detection in src/index.ts sees it.
  class SettingsProvider {
    installSection(): void {}
  }
  return { SettingsProvider }
})

import { apply } from '../src/index.js'

function attachment(id: string): ImageAttachmentRef {
  return {
    attachmentId: id as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: 12,
    width: 32,
    height: 24,
    name: 'image.png',
  }
}

/** Tool exec carrying a latest user message with the given inline images. */
function execWithUserImages(...ids: string[]): never {
  return {
    signal: new AbortController().signal,
    agent: {
      session: {
        header: {},
        deriveMessages: () => [{
          source: { kind: 'user' },
          content: ids.map(id => ({ type: 'image', attachment: attachment(id) })),
        }],
      },
    },
  } as never
}

function harnessContext(): { ctx: Context; tools: ToolDefinition[]; installSection: ReturnType<typeof vi.fn>; sections: Array<{ name: string; order: number; text: () => string }> } {
  const tools: ToolDefinition[] = []
  const installSection = vi.fn()
  const sections: Array<{ name: string; order: number; text: () => string }> = []
  const ctx = {
    tools: { register: (tool: ToolDefinition) => { tools.push(tool) } },
    effect: (setup: () => unknown) => setup(),
    webServer: { register: vi.fn(() => () => {}) },
    credentials: { resolve: vi.fn(async () => ({ value: 'test-key' })) },
    inject: (services: readonly string[], callback: (owner: unknown) => void) => {
      if (services.includes('settings')) callback({ settings: { installSection } })
      if (services.includes('systemPrompt')) {
        callback({ systemPrompt: { section: (section: { name: string; order: number; text: () => string }) => { sections.push(section); return () => {} } } })
      }
    },
    attachments: {
      imageLimits: {
        maxImageBytes: 10 * 1024 * 1024,
        mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      },
      readImage: vi.fn(),
      saveImage: vi.fn(async () => attachment('sha256:saved-image')),
    },
    logger: { warn: vi.fn() },
  } as unknown as Context
  return { ctx, tools, installSection, sections }
}

function toolByName(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`missing tool ${name}`)
  return tool
}

describe('image tool registration', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('installs the settings section through the modern service API', () => {
    const { ctx, tools, installSection } = harnessContext()
    apply(ctx, { provider: 'google', saveToWorkspace: false })
    expect(tools.map(tool => tool.name)).toEqual(['generate_image', 'edit_image'])
    expect(installSection).toHaveBeenCalledTimes(1)
    const [owner, ns, schema, entry, hooks] = installSection.mock.calls[0] as unknown as [Context, string, unknown, unknown, { setSource(): void; onChange(): void }]
    expect(owner).toBe(ctx)
    expect(ns).toBe('image-generation')
    expect((schema as { toJSON?(): unknown }).toJSON).toBeTypeOf('function')
    expect(entry).toMatchObject({ provider: 'google', saveToWorkspace: false })
    expect(hooks.setSource).toBeTypeOf('function')
    expect(hooks.onChange).toBeTypeOf('function')
    // setSource must rewire the live config the tools read through.
    hooks.setSource(() => ({ provider: 'openai', saveToWorkspace: false }))
    expect(ctx.logger.warn).not.toHaveBeenCalled()
  })

  it('registers generate_image and edit_image', () => {
    const { ctx, tools } = harnessContext()
    apply(ctx, { provider: 'google', saveToWorkspace: false })
    expect(tools.map(tool => tool.name)).toEqual(['generate_image', 'edit_image'])
  })

  it('declares the ComfyUI seed in both tool output schemas', () => {
    const { ctx, tools } = harnessContext()
    apply(ctx, { provider: 'comfyui', saveToWorkspace: false })

    for (const name of ['generate_image', 'edit_image']) {
      const schema = toolByName(tools, name).output.schema as {
        properties?: Record<string, unknown>
      }
      expect(schema.properties?.seed).toEqual({ type: 'integer' })
    }
  })

  it('renders a real image block and exposes the full attachment id for both tools', () => {
    const { ctx, tools } = harnessContext()
    apply(ctx, { provider: 'google', saveToWorkspace: false })
    const ref = attachment('sha256:full-attachment-id')
    const value = { attachment: ref, provider: 'google', model: 'gemini-3.1-flash-image', output: '1:1, 1K' }

    for (const name of ['generate_image', 'edit_image']) {
      const tool = toolByName(tools, name)
      const content = tool.output.render({ prompt: 'test prompt' }, value)
      expect(content).toHaveLength(2)
      expect(content[0]).toMatchObject({ type: 'text' })
      expect(content[0]?.type === 'text' ? content[0].text : '').toContain('Attachment ID: sha256:full-attachment-id')
      expect(content[1]).toEqual({ type: 'image', attachment: ref })
    }
  })

  it('exposes provider-neutral size control on edit_image', () => {
    const { ctx, tools } = harnessContext()
    apply(ctx, { provider: 'openai', saveToWorkspace: false })
    const edit = toolByName(tools, 'edit_image')
    const parameters = edit.parameters as { properties?: Record<string, unknown> }
    expect(parameters.properties).toHaveProperty('aspect_ratio')
    expect(parameters.properties).toHaveProperty('quality')
    expect(parameters.properties).toHaveProperty('resolution')
    expect(parameters.properties).toHaveProperty('channel')
    expect(parameters.properties).toHaveProperty('model')
    expect(parameters.properties).toHaveProperty('source_attachment_ids')
    expect(parameters.properties).toHaveProperty('source_paths')
  })

  it('silently uses the configured default model when the call names none', async () => {
    const { ctx, tools } = harnessContext()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('gitee').toString('base64') }] }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    apply(ctx, { provider: 'gitee', giteeModels: ['z-image-turbo', 'z-image'], defaultChannelId: 'gitee', defaultModel: 'z-image', saveToWorkspace: false })

    const value = await toolByName(tools, 'generate_image').execute(
      { prompt: 'a poster', aspect_ratio: '3:4', quality: '1K' },
      { signal: new AbortController().signal } as never,
    ) as { model: string }

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'z-image', size: '768x1024' })
    expect(value.model).toBe('z-image')
  })

  it('errors with the option list when the named model is not configured', async () => {
    const { ctx, tools } = harnessContext()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    apply(ctx, { provider: 'gitee', giteeModels: ['z-image-turbo', 'z-image'], defaultChannelId: 'gitee', defaultModel: 'z-image-turbo', saveToWorkspace: false })

    await expect(toolByName(tools, 'generate_image').execute(
      { prompt: 'a poster', aspect_ratio: '3:4', model: 'flux-1-dev' },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow('Unknown model "flux-1-dev" on Gitee AI. Available models: "z-image-turbo", "z-image".')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('translates gitee ratio and quality into the registered preset', async () => {
    const { ctx, tools } = harnessContext()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('gitee').toString('base64') }] }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    apply(ctx, { provider: 'gitee', saveToWorkspace: false })

    const value = await toolByName(tools, 'generate_image').execute(
      { prompt: 'a poster', aspect_ratio: '3:4', quality: '1K' },
      { signal: new AbortController().signal } as never,
    ) as { provider: string; model: string; output: string }

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ai.gitee.com/v1/images/generations')
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'z-image-turbo', prompt: 'a poster', size: '768x1024' })
    expect(value).toMatchObject({ provider: 'gitee', model: 'z-image-turbo', output: '768x1024' })
    expect(ctx.credentials.resolve).toHaveBeenCalledWith('GITEE_API_KEY')
  })

  it('escapes to gitee width/height for exact resolutions', async () => {
    const { ctx, tools } = harnessContext()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('gitee').toString('base64') }] }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    apply(ctx, { provider: 'gitee', saveToWorkspace: false })

    await toolByName(tools, 'generate_image').execute(
      { prompt: 'a poster', resolution: '864x1152' },
      { signal: new AbortController().signal } as never,
    )

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ width: 864, height: 1152 })
  })

  it('routes modelscope generation through submit, poll, and download', async () => {
    const { ctx, tools } = harnessContext()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'task-9' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_status: 'SUCCEED', output_images: ['https://cdn.example/out.png'] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6]), { status: 200, headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetchMock)
    apply(ctx, { provider: 'modelscope', saveToWorkspace: false })

    const value = await toolByName(tools, 'generate_image').execute(
      { prompt: 'a poster', aspect_ratio: '3:4', quality: '1K' },
      { signal: new AbortController().signal } as never,
    ) as { provider: string; model: string; output: string }

    const [submitUrl, submitInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(submitUrl).toBe('https://api-inference.modelscope.cn/v1/images/generations')
    expect((submitInit.headers as Record<string, string>)['X-ModelScope-Async-Mode']).toBe('true')
    expect(JSON.parse(String(submitInit.body))).toMatchObject({ model: 'Tongyi-MAI/Z-Image-Turbo', size: '768x1024' })
    expect(value).toMatchObject({ provider: 'modelscope', output: '768x1024' })
    expect(ctx.credentials.resolve).toHaveBeenCalledWith('MODELSCOPE_API_KEY')
  })

  it('maps google vocabulary arguments through the shared translation', async () => {
    const { ctx, tools } = harnessContext()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ output_image: { data: Buffer.from('google').toString('base64'), mime_type: 'image/png' } }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    apply(ctx, { provider: 'google', saveToWorkspace: false })

    await toolByName(tools, 'generate_image').execute(
      { prompt: 'a poster', aspect_ratio: '3:4', quality: '2K' },
      { signal: new AbortController().signal } as never,
    )

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ response_format: { aspect_ratio: '3:4', image_size: '2K' } })
  })

  it('tells the agent to use current inline attachments without workspace discovery', () => {
    const { ctx, tools } = harnessContext()
    apply(ctx, { provider: 'google', saveToWorkspace: false })
    const edit = toolByName(tools, 'edit_image')

    expect(edit.description).toContain('NEVER call read_image, glob, or shell')
    expect(edit.description).toContain('call edit_image immediately with prompt only')
  })

  it('routes ComfyUI generation without resolving an API credential', async () => {
    const { ctx, tools } = harnessContext()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: 'job-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        'job-1': {
          status: { status_str: 'success', completed: true },
          outputs: { save: { images: [{ filename: 'final.png', subfolder: '', type: 'output' }] } },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })))
    apply(ctx, {
      provider: 'comfyui',
      comfyuiWorkflowJson: JSON.stringify({ 6: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } } }),
      comfyuiWorkflowName: 'portrait.json',
      saveToWorkspace: false,
    })

    const value = await toolByName(tools, 'generate_image').execute(
      { prompt: 'a portrait' },
      { signal: new AbortController().signal } as never,
    ) as { provider: string; model: string; attachment: ImageAttachmentRef }

    expect(value).toMatchObject({ provider: 'comfyui', model: 'portrait.json', attachment: attachment('sha256:saved-image') })
    expect(ctx.credentials.resolve).not.toHaveBeenCalled()
  })

  it('runs the ComfyUI workflow named by the call instead of the active one', async () => {
    const { ctx, tools } = harnessContext()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: 'job-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        'job-1': {
          status: { status_str: 'success', completed: true },
          outputs: { save: { images: [{ filename: 'final.png', subfolder: '', type: 'output' }] } },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetchMock)
    apply(ctx, {
      provider: 'comfyui',
      comfyuiWorkflows: [
        { name: 'gen.json', json: JSON.stringify({ 6: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } } }) },
        { name: 'alt.json', json: JSON.stringify({ 6: { class_type: 'CLIPTextEncode', inputs: { text: 'ALT {{prompt}}' } } }) },
      ],
      comfyuiActiveWorkflow: 'gen.json',
      saveToWorkspace: false,
    })

    const value = await toolByName(tools, 'generate_image').execute(
      { prompt: 'a portrait', workflow: 'alt.json' },
      { signal: new AbortController().signal } as never,
    ) as { provider: string; model: string }

    const submitted = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body)) as { prompt: { 6: { inputs: { text: string } } } }
    expect(submitted.prompt[6].inputs.text).toBe('ALT a portrait')
    expect(value.model).toBe('alt.json')
    expect(ctx.credentials.resolve).not.toHaveBeenCalled()
  })

  it('prepends the workflow preset before the user prompt on ComfyUI calls', async () => {
    const { ctx, tools } = harnessContext()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: 'job-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        'job-1': {
          status: { status_str: 'success', completed: true },
          outputs: { save: { images: [{ filename: 'final.png', subfolder: '', type: 'output' }] } },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetchMock)
    apply(ctx, {
      provider: 'comfyui',
      comfyuiWorkflows: [
        { name: 'gen.json', json: JSON.stringify({ 6: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } } }), presetPrompt: 'masterpiece, best quality, ' },
      ],
      comfyuiActiveWorkflow: 'gen.json',
      saveToWorkspace: false,
    })

    await toolByName(tools, 'generate_image').execute(
      { prompt: 'a portrait' },
      { signal: new AbortController().signal } as never,
    )

    const submitted = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body)) as { prompt: { 6: { inputs: { text: string } } } }
    expect(submitted.prompt[6].inputs.text).toBe('masterpiece, best quality, a portrait')
  })

  it('omits the separator entirely when the workflow has no preset', async () => {
    const { ctx, tools } = harnessContext()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: 'job-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        'job-1': {
          status: { status_str: 'success', completed: true },
          outputs: { save: { images: [{ filename: 'final.png', subfolder: '', type: 'output' }] } },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetchMock)
    apply(ctx, {
      provider: 'comfyui',
      comfyuiWorkflows: [
        { name: 'gen.json', json: JSON.stringify({ 6: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } } }), presetPrompt: '' },
      ],
      comfyuiActiveWorkflow: 'gen.json',
      saveToWorkspace: false,
    })

    await toolByName(tools, 'generate_image').execute(
      { prompt: 'a portrait' },
      { signal: new AbortController().signal } as never,
    )

    const submitted = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body)) as { prompt: { 6: { inputs: { text: string } } } }
    expect(submitted.prompt[6].inputs.text).toBe('a portrait')
  })

  it('uses the active ComfyUI workflow when the call does not name one', async () => {
    const { ctx, tools } = harnessContext()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: 'job-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        'job-1': {
          status: { status_str: 'success', completed: true },
          outputs: { save: { images: [{ filename: 'final.png', subfolder: '', type: 'output' }] } },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetchMock)
    apply(ctx, {
      provider: 'comfyui',
      comfyuiWorkflows: [
        { name: 'gen.json', json: JSON.stringify({ 6: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } } }) },
        { name: 'alt.json', json: JSON.stringify({ 6: { class_type: 'CLIPTextEncode', inputs: { text: 'ALT {{prompt}}' } } }) },
      ],
      comfyuiActiveWorkflow: 'alt.json',
      saveToWorkspace: false,
    })

    const value = await toolByName(tools, 'generate_image').execute(
      { prompt: 'a portrait' },
      { signal: new AbortController().signal } as never,
    ) as { model: string }

    const submitted = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body)) as { prompt: { 6: { inputs: { text: string } } } }
    expect(submitted.prompt[6].inputs.text).toBe('ALT a portrait')
    expect(value.model).toBe('alt.json')
  })

  it('lists configured ComfyUI workflows when the call names an unknown one', async () => {
    const { ctx, tools } = harnessContext()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    apply(ctx, {
      provider: 'comfyui',
      comfyuiWorkflows: [
        { name: 'gen.json', json: JSON.stringify({ 6: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } } }) },
        { name: 'img2img.json', json: JSON.stringify({
          1: { class_type: 'LoadImage', inputs: { image: '{{image}}' } },
          6: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
        }) },
      ],
      saveToWorkspace: false,
    })

    await expect(toolByName(tools, 'generate_image').execute(
      { prompt: 'a portrait', workflow: 'missing.json' },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow('No ComfyUI workflow named "missing.json" is configured. Available workflows: gen.json, img2img.json.')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.credentials.resolve).not.toHaveBeenCalled()
  })

  it('fails clearly before image lookup when ComfyUI editing is requested', async () => {
    const { ctx, tools } = harnessContext()
    apply(ctx, { provider: 'comfyui', saveToWorkspace: false })

    await expect(toolByName(tools, 'edit_image').execute(
      { prompt: 'restyle it' },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow('edit_image requires an active DSH agent session')
    expect(ctx.credentials.resolve).not.toHaveBeenCalled()
  })

  it('routes ComfyUI editing through upload and the imported workflow', async () => {
    const { ctx, tools } = harnessContext()
    vi.mocked(ctx.attachments.readImage).mockResolvedValue({
      ref: { mediaType: 'image/png', attachmentId: 'sha256:source-image' as ImageAttachmentRef['attachmentId'], bytes: 3, width: 4, height: 4 },
      data: new Uint8Array([1, 2, 3]),
    } as never)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'source.png', subfolder: '' }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: 'job-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        'job-1': {
          status: { status_str: 'success', completed: true },
          outputs: { save: { images: [{ filename: 'final.png', subfolder: '', type: 'output' }] } },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 8, 9]), { status: 200, headers: { 'content-type': 'image/png' } })))
    apply(ctx, {
      provider: 'comfyui',
      comfyuiWorkflowJson: JSON.stringify({
        1: { class_type: 'LoadImage', inputs: { image: '{{image}}' } },
        6: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
      }),
      comfyuiWorkflowName: 'img2img.json',
      saveToWorkspace: false,
    })

    const value = await toolByName(tools, 'edit_image').execute(
      { prompt: 'restyle it' },
      execWithUserImages('sha256:source-image'),
    ) as { provider: string; model: string; attachment: ImageAttachmentRef; seed?: number }

    expect(value).toMatchObject({ provider: 'comfyui', model: 'img2img.json', attachment: attachment('sha256:saved-image') })
    expect(value.seed).toBeTypeOf('number')
    expect(ctx.credentials.resolve).not.toHaveBeenCalled()
  })

  it('rejects ComfyUI editing of several images with a selector hint', async () => {
    const { ctx, tools } = harnessContext()
    vi.mocked(ctx.attachments.readImage).mockResolvedValue({
      ref: { mediaType: 'image/png', attachmentId: 'sha256:a' as ImageAttachmentRef['attachmentId'], bytes: 1, width: 2, height: 2 },
      data: new Uint8Array([1]),
    } as never)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    apply(ctx, { provider: 'comfyui', saveToWorkspace: false })

    await expect(toolByName(tools, 'edit_image').execute(
      { prompt: 'restyle it' },
      execWithUserImages('sha256:a', 'sha256:b'),
    )).rejects.toThrow('exactly one source image')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.credentials.resolve).not.toHaveBeenCalled()
  })
})
