import { describe, expect, it } from 'vitest'
import {
  Config,
  DEFAULT_DASHSCOPE_ENDPOINT,
  DEFAULT_DASHSCOPE_MODEL,
  DEFAULT_COMFYUI_BASE_URL,
  DEFAULT_COMFYUI_TIMEOUT_MS,
  DEFAULT_COMFYUI_WORKFLOW_LABEL,
  DEFAULT_GITEE_BASE_URL,
  DEFAULT_GITEE_MODEL,
  DEFAULT_GOOGLE_ENDPOINT,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_SEEDREAM_BASE_URL,
  DEFAULT_SEEDREAM_MODEL,
  agentChannels,
  channelProfile,
  modelOptionsFor,
  resolveAgentSelection,
  resolveProvider,
  selectComfyUIWorkflow,
  withProviderModel,
} from '../src/config.js'
import { mergeComfyUIPrompt, resolveComfyUIWorkflows, uniqueComfyUIWorkflowName } from '../src/shared.js'

describe('resolveProvider', () => {
  it('resolves the Google defaults', () => {
    expect(resolveProvider({})).toEqual({ provider: 'google', apiKeyEnv: 'GEMINI_API_KEY', endpoint: DEFAULT_GOOGLE_ENDPOINT, model: DEFAULT_GOOGLE_MODEL, aspectRatio: '1:1', imageSize: '1K' })
  })

  it('resolves editable OpenAI-compatible profiles independently', () => {
    expect(resolveProvider({ provider: 'openai' })).toEqual({ provider: 'openai', apiKeyEnv: 'OPENAI_API_KEY', baseURL: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_OPENAI_MODEL, imageSize: '1024x1024' })
    expect(resolveProvider({ provider: 'seedream' })).toEqual({ provider: 'seedream', apiKeyEnv: 'ARK_API_KEY', baseURL: DEFAULT_SEEDREAM_BASE_URL, model: DEFAULT_SEEDREAM_MODEL, imageSize: '2K' })
  })

  it('resolves the Gitee AI profile with its own credential and defaults', () => {
    expect(resolveProvider({ provider: 'gitee' })).toEqual({
      provider: 'gitee',
      apiKeyEnv: 'GITEE_API_KEY',
      baseURL: DEFAULT_GITEE_BASE_URL,
      model: DEFAULT_GITEE_MODEL,
      imageSize: '1024x1024',
    })
    expect(resolveProvider({ provider: 'gitee', giteeBaseURL: 'https://ai.gitee.com/v1', giteeModel: 'z-image' })).toMatchObject({ model: 'z-image' })
  })

  it('resolves the ModelScope profile with the org/model default', () => {
    expect(resolveProvider({ provider: 'modelscope' })).toEqual({
      provider: 'modelscope',
      apiKeyEnv: 'MODELSCOPE_API_KEY',
      baseURL: 'https://api-inference.modelscope.cn/v1',
      model: 'Tongyi-MAI/Z-Image-Turbo',
      imageSize: '1024x1024',
    })
  })

  it('resolves DashScope profile', () => {
    expect(resolveProvider({ provider: 'dashscope' })).toEqual({
      provider: 'dashscope',
      apiKeyEnv: 'DASHSCOPE_API_KEY',
      endpoint: DEFAULT_DASHSCOPE_ENDPOINT,
      model: DEFAULT_DASHSCOPE_MODEL,
      imageSize: '1024*1024',
    })
  })

  it('resolves a credential-free ComfyUI profile', () => {
    expect(resolveProvider({ provider: 'comfyui' })).toEqual({
      provider: 'comfyui',
      baseURL: DEFAULT_COMFYUI_BASE_URL,
      workflows: [],
      timeoutMs: DEFAULT_COMFYUI_TIMEOUT_MS,
    })
  })
})

describe('ComfyUI workflow resolution', () => {
  const workflows = [
    { name: 'flux.json', json: '{"6":{"class_type":"CLIPTextEncode","inputs":{"text":"{{prompt}}"}}}' },
    { name: 'img2img.json', json: '{"1":{"class_type":"LoadImage","inputs":{"image":"{{image}}"}},"6":{"class_type":"CLIPTextEncode","inputs":{"text":"{{prompt}}"}}}' },
  ]

  it('prefers named workflows and resolves the configured active one', () => {
    expect(resolveProvider({ provider: 'comfyui', comfyuiWorkflows: workflows, comfyuiActiveWorkflow: 'img2img.json' })).toMatchObject({
      provider: 'comfyui',
      workflows,
      workflow: workflows[1],
    })
  })

  it('falls back to the first workflow when the active name is missing', () => {
    expect(resolveProvider({ provider: 'comfyui', comfyuiWorkflows: workflows, comfyuiActiveWorkflow: 'missing.json' }))
      .toMatchObject({ workflow: workflows[0] })
  })

  it('falls back to the legacy single-workflow fields', () => {
    expect(resolveProvider({ provider: 'comfyui', comfyuiWorkflowJson: '{"6":{}}', comfyuiWorkflowName: 'legacy.json' })).toMatchObject({
      workflows: [{ name: 'legacy.json', json: '{"6":{}}' }],
      workflow: { name: 'legacy.json', json: '{"6":{}}' },
    })
    expect(resolveProvider({ provider: 'comfyui', comfyuiWorkflowJson: '{"6":{}}' })).toMatchObject({
      workflows: [{ name: DEFAULT_COMFYUI_WORKFLOW_LABEL, json: '{"6":{}}' }],
    })
  })

  it('ignores malformed workflow entries instead of failing the profile', () => {
    const malformed = [
      { name: '', json: 'x' },
      { name: 'ok.json', json: 'y' },
      { json: 'z' },
      'nope',
    ] as never
    expect(resolveProvider({ provider: 'comfyui', comfyuiWorkflows: malformed })).toMatchObject({
      workflows: [{ name: 'ok.json', json: 'y' }],
    })
  })

  it('derives collision-free workflow labels for imports', () => {
    expect(uniqueComfyUIWorkflowName('flux.json', ['other.json'])).toBe('flux.json')
    expect(uniqueComfyUIWorkflowName('flux.json', ['flux.json'])).toBe('flux.json (2)')
    expect(uniqueComfyUIWorkflowName('flux.json', ['flux.json', 'flux.json (2)'])).toBe('flux.json (3)')
    expect(uniqueComfyUIWorkflowName('  ', [])).toBe(DEFAULT_COMFYUI_WORKFLOW_LABEL)
  })
})

describe('mergeComfyUIPrompt', () => {
  it('prepends the preset before the user prompt with one separator', () => {
    expect(mergeComfyUIPrompt('masterpiece, best quality', 'a cat')).toBe('masterpiece, best quality, a cat')
  })

  it('never doubles separators when the preset ends with commas or whitespace', () => {
    expect(mergeComfyUIPrompt('masterpiece, ', 'a cat')).toBe('masterpiece, a cat')
    expect(mergeComfyUIPrompt('masterpiece,', 'a cat')).toBe('masterpiece, a cat')
    expect(mergeComfyUIPrompt('masterpiece ;', 'a cat')).toBe('masterpiece, a cat')
  })

  it('reduces to the non-empty side', () => {
    expect(mergeComfyUIPrompt('', 'a cat')).toBe('a cat')
    expect(mergeComfyUIPrompt(undefined, 'a cat')).toBe('a cat')
    expect(mergeComfyUIPrompt('masterpiece', '')).toBe('masterpiece')
    expect(mergeComfyUIPrompt('  ', '  ')).toBe('')
  })
})

describe('resolveComfyUIWorkflows preset handling', () => {
  it('keeps trimmed presets on named entries and omits blank ones', () => {
    expect(resolveComfyUIWorkflows({ comfyuiWorkflows: [
      { name: 'a.json', json: 'x', presetPrompt: ' masterpiece, ' },
      { name: 'b.json', json: 'y', presetPrompt: '   ' },
    ] })).toEqual([
      { name: 'a.json', json: 'x', presetPrompt: 'masterpiece,' },
      { name: 'b.json', json: 'y' },
    ])
  })
})

describe('selectComfyUIWorkflow', () => {
  const workflows = [
    { name: 'gen.json', json: '{"gen":{}}' },
    { name: 'alt.json', json: '{"alt":{}}' },
  ]

  it('returns the active workflow when no name is requested', () => {
    expect(selectComfyUIWorkflow({ workflows, workflow: workflows[1] })).toBe(workflows[1])
    expect(selectComfyUIWorkflow({ workflows, workflow: workflows[1] }, '  ')).toBe(workflows[1])
  })

  it('resolves a requested workflow by exact name', () => {
    expect(selectComfyUIWorkflow({ workflows, workflow: workflows[0] }, 'alt.json')).toBe(workflows[1])
  })

  it('lists available workflows when the requested name is unknown', () => {
    expect(() => selectComfyUIWorkflow({ workflows, workflow: workflows[0] }, 'nope.json'))
      .toThrow('No ComfyUI workflow named "nope.json" is configured. Available workflows: gen.json, alt.json.')
  })

  it('explains the missing workflow before any ComfyUI request runs', () => {
    expect(() => selectComfyUIWorkflow({ workflows: [], workflow: undefined }))
      .toThrow('requires an imported workflow')
  })
})

describe('Config Schema validation', () => {
  it('validates provider: dashscope without rejection', () => {
    const validated = Config({ provider: 'dashscope' })
    expect(validated.provider).toBe('dashscope')
    expect(validated.dashscopeModel).toBe(DEFAULT_DASHSCOPE_MODEL)
    expect(validated.dashscopeEndpoint).toBe(DEFAULT_DASHSCOPE_ENDPOINT)
  })

  it('validates provider: comfyui and applies local defaults', () => {
    const validated = Config({ provider: 'comfyui' })
    expect(validated.provider).toBe('comfyui')
    expect(validated.comfyuiBaseURL).toBe(DEFAULT_COMFYUI_BASE_URL)
    expect(validated.comfyuiTimeoutMs).toBe(DEFAULT_COMFYUI_TIMEOUT_MS)
    expect(validated.comfyuiWorkflows).toEqual([])
    expect(validated.comfyuiActiveWorkflow).toBe('')
  })

  it('round-trips named workflows through the schema, defaulting blank presets', () => {
    const validated = Config({
      provider: 'comfyui',
      comfyuiWorkflows: [{ name: 'a.json', json: '{}' }, { name: 'b.json', json: '{}', presetPrompt: 'masterpiece' }],
      comfyuiActiveWorkflow: 'a.json',
    })
    expect(validated.comfyuiWorkflows).toEqual([
      { name: 'a.json', json: '{}', presetPrompt: '' },
      { name: 'b.json', json: '{}', presetPrompt: 'masterpiece' },
    ])
    expect(validated.comfyuiActiveWorkflow).toBe('a.json')
  })

  it('defaults the gitee fields and accepts model lists', () => {
    const validated = Config({ provider: 'gitee', giteeModels: ['z-image-turbo', ' z-image ', ''] })
    expect(validated.giteeBaseURL).toBe(DEFAULT_GITEE_BASE_URL)
    expect(validated.giteeModel).toBe(DEFAULT_GITEE_MODEL)
    expect(validated.giteeModels).toEqual(['z-image-turbo', ' z-image ', ''])
  })
})

describe('agent channel and model resolution', () => {
  it('resolves the legacy single-provider config silently to its default model', () => {
    const channels = agentChannels({ provider: 'gitee' })
    expect(channels).toEqual([{ id: 'gitee', provider: 'gitee', label: 'Gitee AI', models: [DEFAULT_GITEE_MODEL] }])
    expect(resolveAgentSelection({ provider: 'gitee' }, undefined, undefined)).toEqual({
      channel: { id: 'gitee', provider: 'gitee', label: 'Gitee AI', models: [DEFAULT_GITEE_MODEL] },
      model: DEFAULT_GITEE_MODEL,
    })
    expect(resolveAgentSelection({ provider: 'gitee' }, 'gitee', undefined).model).toBe(DEFAULT_GITEE_MODEL)
    expect(resolveAgentSelection({ provider: 'gitee' }, 'Gitee AI', undefined).model).toBe(DEFAULT_GITEE_MODEL)
  })

  it('adds every channel with an explicitly configured model list (legacy fields)', () => {
    const config = { provider: 'gitee', giteeModels: ['z-image-turbo', 'z-image'], openaiModels: ['gpt-image-2'] }
    const channels = agentChannels(config)
    expect(channels.map(channel => channel.provider)).toEqual(['openai', 'gitee'])
    expect(modelOptionsFor(config, 'gitee')).toEqual(['z-image-turbo', 'z-image'])
  })

  it('prefers declared channel instances over the legacy per-provider fields', () => {
    const config = { channels: [
      { id: 'gitee-main', provider: 'gitee', baseURL: 'https://ai.gitee.com/v1', models: ['z-image-turbo', 'FLUX.2-dev'] },
      { id: 'relay-1', provider: 'openai', baseURL: 'https://relay.example/v1', models: ['gpt-image-2'] },
    ] }
    const channels = agentChannels(config)
    expect(channels.map(channel => channel.id)).toEqual(['gitee-main', 'relay-1'])
    expect(channels[0]?.label).toBe('Gitee AI')
    expect(resolveAgentSelection(config, 'gitee-main', undefined)).toMatchObject({ channel: { id: 'gitee-main', baseURL: 'https://ai.gitee.com/v1' }, model: 'z-image-turbo' })
    expect(resolveAgentSelection(config, 'relay-1', undefined)).toMatchObject({ channel: { id: 'relay-1' }, model: 'gpt-image-2' })
    expect(resolveAgentSelection(config, 'openai', undefined)).toMatchObject({ channel: { id: 'relay-1' } })
    // Model lists from legacy fields must NOT leak into declared channels.
    expect(agentChannels({ channels: [...config.channels!, { id: 'x', provider: 'google' }], giteeModels: ['legacy'] })[0]?.models).toEqual(['z-image-turbo', 'FLUX.2-dev'])
  })

  it('offers configured ComfyUI workflows as models on the comfyui channel', () => {
    const config = { provider: 'gitee', comfyuiWorkflows: [{ name: 'gen.json', json: '{}' }] }
    expect(modelOptionsFor(config, 'comfyui')).toEqual(['gen.json'])
    expect(agentChannels(config).map(channel => channel.provider)).toContain('comfyui')
  })

  it('unnamed requests fall back through default → first channel/model', () => {
    const config = { provider: 'gitee', giteeModels: ['z-image-turbo'], openaiModels: ['gpt-image-2'] }
    // No recorded default: the first declared channel (openai) serves.
    expect(resolveAgentSelection(config, undefined, undefined)).toMatchObject({ channel: { id: 'openai' }, model: 'gpt-image-2' })
    // A recorded default wins over order.
    const withDefault = { ...config, defaultChannelId: 'gitee', defaultModel: 'z-image-turbo' }
    expect(resolveAgentSelection(withDefault, undefined, undefined)).toMatchObject({ channel: { id: 'gitee' }, model: 'z-image-turbo' })
    // Unknown channel name still errors with the option list.
    expect(() => resolveAgentSelection(config, 'nope', undefined)).toThrow('Unknown image channel "nope"')
  })

  it('never silently picks between two channels when the provider name matches several', () => {
    const config = { channels: [
      { id: 'gitee-a', provider: 'gitee', models: ['z-image-turbo'] },
      { id: 'gitee-b', provider: 'gitee', models: ['FLUX.2-dev'] },
    ] }
    expect(resolveAgentSelection(config, undefined, undefined)).toMatchObject({ channel: { id: 'gitee-a' }, model: 'z-image-turbo' })
    expect(() => resolveAgentSelection(config, 'gitee', undefined)).toThrow('matches several channels')
    expect(resolveAgentSelection(config, 'gitee-b', undefined)).toMatchObject({ channel: { id: 'gitee-b' }, model: 'FLUX.2-dev' })
  })

  it('naming a model switches to the channel that hosts it', () => {
    const config = { channels: [
      { id: 'gitee-main', provider: 'gitee', models: ['z-image-turbo'] },
      { id: 'relay-1', provider: 'openai', models: ['gpt-image-2', 'FLUX.2-dev'] },
    ], defaultChannelId: 'gitee-main', defaultModel: 'z-image-turbo' }
    expect(resolveAgentSelection(config, undefined, 'FLUX.2-dev')).toMatchObject({ channel: { id: 'relay-1' }, model: 'FLUX.2-dev' })
    // Ambiguous across channels: refuse rather than pick.
    const split = { channels: [
      { id: 'a', provider: 'gitee', models: ['shared-model'] },
      { id: 'b', provider: 'openai', models: ['shared-model'] },
    ] }
    expect(() => resolveAgentSelection(split, undefined, 'shared-model')).toThrow('configured on several channels')
    // Unknown name: error lists the default channel's models.
    expect(() => resolveAgentSelection(config, undefined, 'nope')).toThrow('Unknown model "nope"')
  })

  it('errors when the resolved channel has no models', () => {
    const config = { channels: [{ id: 'empty', provider: 'gitee', models: [] }] }
    expect(() => resolveAgentSelection(config, undefined, undefined)).toThrow('has no models configured')
    expect(() => resolveAgentSelection(config, 'empty', undefined)).toThrow('has no models configured')
  })

  it('pins provider and model for downstream profile resolution', () => {
    expect(withProviderModel({ provider: 'google' }, 'gitee', 'z-image')).toMatchObject({ provider: 'gitee', giteeModel: 'z-image' })
    expect(withProviderModel({ provider: 'google' }, 'openai')).toMatchObject({ provider: 'openai' })
    expect(withProviderModel({ provider: 'google' }, 'comfyui', 'ignored.json')).toMatchObject({ provider: 'comfyui' })
  })

  it('derives a channel-pinned profile with endpoint override', () => {
    expect(channelProfile({ provider: 'google' }, { provider: 'gitee', baseURL: 'https://mirror.example/v1' }, 'FLUX.2-dev')).toMatchObject({ provider: 'gitee', giteeBaseURL: 'https://mirror.example/v1', giteeModel: 'FLUX.2-dev' })
    expect(channelProfile({ provider: 'google' }, { provider: 'gitee' }, 'z-image-turbo')).toMatchObject({ provider: 'gitee', giteeModel: 'z-image-turbo' })
  })
})

