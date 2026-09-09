/** User-facing configuration for supported image providers. */
import z from '@deepseek-ai/schemastery'

import {
  DEFAULT_ANTIGRAVITY_BASE_URL,
  DEFAULT_ANTIGRAVITY_MODEL,
  DEFAULT_DASHSCOPE_ENDPOINT,
  DEFAULT_DASHSCOPE_MODEL,
  DEFAULT_COMFYUI_BASE_URL,
  DEFAULT_COMFYUI_TIMEOUT_MS,
  DEFAULT_COMFYUI_WORKFLOW_LABEL,
  DEFAULT_GITEE_BASE_URL,
  DEFAULT_GITEE_MODEL,
  DEFAULT_GOOGLE_ENDPOINT,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_MODELSCOPE_BASE_URL,
  DEFAULT_MODELSCOPE_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_SEEDREAM_BASE_URL,
  DEFAULT_SEEDREAM_MODEL,
  IMAGE_PROVIDERS,
  PROVIDER_LABELS,
  activeComfyUIWorkflow,
  resolveComfyUIWorkflows,
  type ComfyUIWorkflowEntry,
  type ImageProvider,
} from './shared.js'

export {
  DEFAULT_ANTIGRAVITY_BASE_URL,
  DEFAULT_ANTIGRAVITY_MODEL,
  DEFAULT_DASHSCOPE_ENDPOINT,
  DEFAULT_DASHSCOPE_MODEL,
  DEFAULT_COMFYUI_BASE_URL,
  DEFAULT_COMFYUI_TIMEOUT_MS,
  DEFAULT_COMFYUI_WORKFLOW_LABEL,
  DEFAULT_GITEE_BASE_URL,
  DEFAULT_GITEE_MODEL,
  DEFAULT_GOOGLE_ENDPOINT,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_MODELSCOPE_BASE_URL,
  DEFAULT_MODELSCOPE_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_SEEDREAM_BASE_URL,
  DEFAULT_SEEDREAM_MODEL,
  IMAGE_PROVIDERS,
  PROVIDER_LABELS,
  activeComfyUIWorkflow,
  resolveComfyUIWorkflows,
  type ComfyUIWorkflowEntry,
  type ImageProvider,
}

/** Default workspace subfolder that receives generated image files. */
export const DEFAULT_WORKSPACE_FOLDER = 'dsh-image-gen'

/** Google API credential reference. */
export const GOOGLE_API_KEY_ENV = 'GEMINI_API_KEY'
/** OpenAI Platform or compatible relay credential reference. */
export const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY'
/** Volcengine Ark credential reference. */
export const SEEDREAM_API_KEY_ENV = 'ARK_API_KEY'
/** DashScope credential reference. */
export const DASHSCOPE_API_KEY_ENV = 'DASHSCOPE_API_KEY'
/** Gitee AI (ai.gitee.com) credential reference. */
export const GITEE_API_KEY_ENV = 'GITEE_API_KEY'
/** ModelScope (api-inference.modelscope.cn) credential reference. */
export const MODELSCOPE_API_KEY_ENV = 'MODELSCOPE_API_KEY'
/** Antigravity Tools local proxy credential reference. */
export const ANTIGRAVITY_API_KEY_ENV = 'ANTIGRAVITY_API_KEY'

/** Google tool-level controls. */
export const ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'] as const
export const IMAGE_SIZES = ['1K', '2K', '4K'] as const
export type AspectRatio = typeof ASPECT_RATIOS[number]
export type ImageSize = typeof IMAGE_SIZES[number]

/** Bundle configuration from the profile patch and the Web settings page. */
export interface Config {
  provider?: ImageProvider
  googleModel?: string
  googleEndpoint?: string
  openaiBaseURL?: string
  openaiModel?: string
  seedreamBaseURL?: string
  seedreamModel?: string
  dashscopeEndpoint?: string
  dashscopeModel?: string
  giteeBaseURL?: string
  giteeModel?: string
  modelscopeBaseURL?: string
  modelscopeModel?: string
  /** Extra agent-selectable models on the Google channel. */
  googleModels?: string[]
  /** Extra agent-selectable models on the OpenAI channel. */
  openaiModels?: string[]
  /** Extra agent-selectable models on the Seedream channel. */
  seedreamModels?: string[]
  /** Extra agent-selectable models on the DashScope channel. */
  dashscopeModels?: string[]
  /** Extra agent-selectable models on the Gitee AI channel. */
  giteeModels?: string[]
  /** Extra agent-selectable models on the ModelScope channel. */
  modelscopeModels?: string[]
  /** Antigravity Tools local proxy endpoint. */
  antigravityBaseURL?: string
  /** Model on the Antigravity channel. */
  antigravityModel?: string
  /** Extra agent-selectable models on the Antigravity channel. */
  antigravityModels?: string[]
  comfyuiBaseURL?: string
  /** Named ComfyUI workflows managed by the Web settings page. */
  comfyuiWorkflows?: ComfyUIWorkflowEntry[]
  /** Name of the workflow ComfyUI calls use by default. */
  comfyuiActiveWorkflow?: string
  /** Legacy single-workflow storage; synced to the active entry for downgrades. */
  comfyuiWorkflowJson?: string
  /** Original imported file name of the legacy single workflow. */
  comfyuiWorkflowName?: string
  comfyuiTimeoutMs?: number
  /** User-declared channel instances from the settings「添加渠道」cards; empty falls back to the legacy per-provider fields below. */
  channels?: ChannelConfig[]
  /** The channel that holds the default model (settings radio); empty = the first declared channel. */
  defaultChannelId?: string
  /** The model used when the user does not name one; empty = the first model of the default channel. */
  defaultModel?: string
  /** Also write every generated image as a file under the session workspace. */
  saveToWorkspace?: boolean
  /** Workspace subfolder for generated images; empty means the workspace root. */
  workspaceFolder?: string
}

/** One user-declared channel instance: a provider, its endpoint, credential ref, and model list. */
export interface ChannelConfig {
  /** Stable channel id — what agent calls reference when provider names are ambiguous. */
  id: string
  provider: ImageProvider
  /** Endpoint override; empty uses the provider default. */
  baseURL?: string
  /** Credential ref override; empty uses the provider default (GITEE_API_KEY, ...). */
  apiKeyEnv?: string
  /** Agent-selectable models on this channel. */
  models?: string[]
}

/** Cordis configuration schema. */
export const Config: z<Config> = z.object({
  provider: z.union(IMAGE_PROVIDERS).default('google'),
  channels: z.array(z.object({
    id: z.string(),
    provider: z.union(IMAGE_PROVIDERS),
    baseURL: z.string().default(''),
    apiKeyEnv: z.string().default(''),
    models: z.array(z.string()).default([]),
  })).default([]),
  defaultChannelId: z.string().default(''),
  defaultModel: z.string().default(''),
  googleModel: z.string().default(DEFAULT_GOOGLE_MODEL),
  googleEndpoint: z.string().default(DEFAULT_GOOGLE_ENDPOINT),
  googleModels: z.array(z.string()).default([]),
  openaiBaseURL: z.string().default(DEFAULT_OPENAI_BASE_URL),
  openaiModel: z.string().default(DEFAULT_OPENAI_MODEL),
  openaiModels: z.array(z.string()).default([]),
  seedreamBaseURL: z.string().default(DEFAULT_SEEDREAM_BASE_URL),
  seedreamModel: z.string().default(DEFAULT_SEEDREAM_MODEL),
  seedreamModels: z.array(z.string()).default([]),
  dashscopeEndpoint: z.string().default(DEFAULT_DASHSCOPE_ENDPOINT),
  dashscopeModel: z.string().default(DEFAULT_DASHSCOPE_MODEL),
  dashscopeModels: z.array(z.string()).default([]),
  giteeBaseURL: z.string().default(DEFAULT_GITEE_BASE_URL),
  giteeModel: z.string().default(DEFAULT_GITEE_MODEL),
  giteeModels: z.array(z.string()).default([]),
  modelscopeBaseURL: z.string().default(DEFAULT_MODELSCOPE_BASE_URL),
  modelscopeModel: z.string().default(DEFAULT_MODELSCOPE_MODEL),
  modelscopeModels: z.array(z.string()).default([]),
  antigravityBaseURL: z.string().default(DEFAULT_ANTIGRAVITY_BASE_URL),
  antigravityModel: z.string().default(DEFAULT_ANTIGRAVITY_MODEL),
  antigravityModels: z.array(z.string()).default([]),
  comfyuiBaseURL: z.string().default(DEFAULT_COMFYUI_BASE_URL),
  comfyuiWorkflows: z.array(z.object({ name: z.string(), json: z.string(), presetPrompt: z.string().default('') })).default([]),
  comfyuiActiveWorkflow: z.string().default(''),
  comfyuiWorkflowJson: z.string().default(''),
  comfyuiWorkflowName: z.string().default(''),
  comfyuiTimeoutMs: z.number().min(1_000).max(3_600_000).default(DEFAULT_COMFYUI_TIMEOUT_MS),
  saveToWorkspace: z.boolean().default(true),
  workspaceFolder: z.string().default(DEFAULT_WORKSPACE_FOLDER),
})

/** Resolve exactly one provider profile for a tool call. */
export function resolveProvider(config: Config):
  | { provider: 'google'; apiKeyEnv: string; model: string; endpoint: string; aspectRatio: AspectRatio; imageSize: ImageSize }
  | { provider: 'openai'; apiKeyEnv: string; model: string; baseURL: string; imageSize: string }
  | { provider: 'seedream'; apiKeyEnv: string; model: string; baseURL: string; imageSize: string }
  | { provider: 'dashscope'; apiKeyEnv: string; model: string; endpoint: string; imageSize: string }
  | { provider: 'gitee'; apiKeyEnv: string; model: string; baseURL: string; imageSize: string }
  | { provider: 'modelscope'; apiKeyEnv: string; model: string; baseURL: string; imageSize: string }
  | { provider: 'antigravity'; apiKeyEnv: string; model: string; baseURL: string; imageSize: string }
  | { provider: 'comfyui'; baseURL: string; workflows: ComfyUIWorkflowEntry[]; workflow?: ComfyUIWorkflowEntry; timeoutMs: number } {
  switch (config.provider ?? 'google') {
    case 'openai': return { provider: 'openai', apiKeyEnv: OPENAI_API_KEY_ENV, model: config.openaiModel ?? DEFAULT_OPENAI_MODEL, baseURL: config.openaiBaseURL ?? DEFAULT_OPENAI_BASE_URL, imageSize: '1024x1024' }
    case 'seedream': return { provider: 'seedream', apiKeyEnv: SEEDREAM_API_KEY_ENV, model: config.seedreamModel ?? DEFAULT_SEEDREAM_MODEL, baseURL: config.seedreamBaseURL ?? DEFAULT_SEEDREAM_BASE_URL, imageSize: '2K' }
    case 'dashscope': return { provider: 'dashscope', apiKeyEnv: DASHSCOPE_API_KEY_ENV, model: config.dashscopeModel ?? DEFAULT_DASHSCOPE_MODEL, endpoint: config.dashscopeEndpoint ?? DEFAULT_DASHSCOPE_ENDPOINT, imageSize: '1024*1024' }
    case 'gitee': return { provider: 'gitee', apiKeyEnv: GITEE_API_KEY_ENV, model: config.giteeModel ?? DEFAULT_GITEE_MODEL, baseURL: config.giteeBaseURL ?? DEFAULT_GITEE_BASE_URL, imageSize: '1024x1024' }
    case 'modelscope': return { provider: 'modelscope', apiKeyEnv: MODELSCOPE_API_KEY_ENV, model: config.modelscopeModel ?? DEFAULT_MODELSCOPE_MODEL, baseURL: config.modelscopeBaseURL ?? DEFAULT_MODELSCOPE_BASE_URL, imageSize: '1024x1024' }
    case 'antigravity': return { provider: 'antigravity', apiKeyEnv: ANTIGRAVITY_API_KEY_ENV, model: config.antigravityModel ?? DEFAULT_ANTIGRAVITY_MODEL, baseURL: config.antigravityBaseURL ?? DEFAULT_ANTIGRAVITY_BASE_URL, imageSize: '1024x1024' }
    case 'comfyui': {
      const workflows = resolveComfyUIWorkflows(config)
      const workflow = activeComfyUIWorkflow(config)
      return {
        provider: 'comfyui',
        baseURL: config.comfyuiBaseURL ?? DEFAULT_COMFYUI_BASE_URL,
        workflows,
        ...(workflow === undefined ? {} : { workflow }),
        timeoutMs: config.comfyuiTimeoutMs ?? DEFAULT_COMFYUI_TIMEOUT_MS,
      }
    }
    case 'google': return { provider: 'google', apiKeyEnv: GOOGLE_API_KEY_ENV, model: config.googleModel ?? DEFAULT_GOOGLE_MODEL, endpoint: config.googleEndpoint ?? DEFAULT_GOOGLE_ENDPOINT, aspectRatio: '1:1', imageSize: '1K' }
  }
}

/** The workflow a ComfyUI call runs: the requested name when given, else the active one. */
export function selectComfyUIWorkflow(
  active: { workflows: ComfyUIWorkflowEntry[]; workflow?: ComfyUIWorkflowEntry },
  requested?: string,
): ComfyUIWorkflowEntry {
  if (active.workflow === undefined) {
    throw new Error('ComfyUI image generation requires an imported workflow; import one in Settings > Plugins > Image generation.')
  }
  if (typeof requested !== 'string' || requested.trim().length === 0) return active.workflow
  const name = requested.trim()
  const workflow = active.workflows.find(candidate => candidate.name === name)
  if (workflow === undefined) {
    throw new Error(`No ComfyUI workflow named "${name}" is configured. Available workflows: ${active.workflows.map(entry => entry.name).join(', ')}.`)
  }
  return workflow
}

// ---------------------------------------------------------------------------
// Agent channel & model selection.
//
// The user curates channels and a default model in settings. An unnamed call
// resolves to the default silently — no asking step, no guidance injection.
// Naming a model or channel resolves it (model names may switch channels);
// only unknown names error, with option lists the agent can relay.
// ---------------------------------------------------------------------------

/** One agent-selectable channel with its model options. */
export interface AgentChannelChoice {
  /** Stable channel id (the settings card's channel instance). */
  id: string
  provider: ImageProvider
  label: string
  models: string[]
  /** Endpoint override carried from the channel card; undefined = provider default. */
  baseURL?: string | undefined
  /** Credential ref override carried from the channel card; undefined = provider default. */
  apiKeyEnv?: string | undefined
}

/** The channel + model one agent call resolves to. */
export interface AgentSelection {
  channel: AgentChannelChoice
  model: string
}

function cleanList(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed !== '') seen.add(trimmed)
  }
  return [...seen]
}

/** Valid user-declared channel instances, in declaration order. */
export function declaredChannels(config: Config): ChannelConfig[] {
  const channels = Array.isArray(config.channels) ? config.channels : []
  const valid: ChannelConfig[] = []
  for (const channel of channels) {
    if (channel === null || typeof channel !== 'object') continue
    if (typeof channel.id !== 'string' || channel.id.trim() === '') continue
    if (!(IMAGE_PROVIDERS as readonly string[]).includes(channel.provider)) continue
    valid.push({ ...channel, id: channel.id.trim() })
  }
  return valid
}

/** All model options the agent may pick on one provider (legacy single-provider config). */
export function modelOptionsFor(config: Config, provider: ImageProvider): string[] {
  switch (provider) {
    case 'google': { const list = cleanList(config.googleModels); return list.length > 0 ? list : [config.googleModel ?? DEFAULT_GOOGLE_MODEL] }
    case 'openai': { const list = cleanList(config.openaiModels); return list.length > 0 ? list : [config.openaiModel ?? DEFAULT_OPENAI_MODEL] }
    case 'seedream': { const list = cleanList(config.seedreamModels); return list.length > 0 ? list : [config.seedreamModel ?? DEFAULT_SEEDREAM_MODEL] }
    case 'dashscope': { const list = cleanList(config.dashscopeModels); return list.length > 0 ? list : [config.dashscopeModel ?? DEFAULT_DASHSCOPE_MODEL] }
    case 'gitee': { const list = cleanList(config.giteeModels); return list.length > 0 ? list : [config.giteeModel ?? DEFAULT_GITEE_MODEL] }
    case 'modelscope': { const list = cleanList(config.modelscopeModels); return list.length > 0 ? list : [config.modelscopeModel ?? DEFAULT_MODELSCOPE_MODEL] }
    case 'antigravity': { const list = cleanList(config.antigravityModels); return list.length > 0 ? list : [config.antigravityModel ?? DEFAULT_ANTIGRAVITY_MODEL] }
    case 'comfyui': return resolveComfyUIWorkflows(config).map(entry => entry.name)
  }
}

function channelExplicitlyConfigured(config: Config, provider: ImageProvider): boolean {
  switch (provider) {
    case 'google': return cleanList(config.googleModels).length > 0
    case 'openai': return cleanList(config.openaiModels).length > 0
    case 'seedream': return cleanList(config.seedreamModels).length > 0
    case 'dashscope': return cleanList(config.dashscopeModels).length > 0
    case 'gitee': return cleanList(config.giteeModels).length > 0
    case 'modelscope': return cleanList(config.modelscopeModels).length > 0
    case 'antigravity': return cleanList(config.antigravityModels).length > 0
    case 'comfyui': return resolveComfyUIWorkflows(config).length > 0
  }
}

/** Channels selectable by the agent: declared channel instances when present, else the legacy per-provider config. */
export function agentChannels(config: Config): AgentChannelChoice[] {
  const declared = declaredChannels(config)
  if (declared.length > 0) {
    const perProvider = new Map<string, number>()
    for (const channel of declared) perProvider.set(channel.provider, (perProvider.get(channel.provider) ?? 0) + 1)
    return declared.map(channel => ({
      id: channel.id,
      provider: channel.provider,
      label: (perProvider.get(channel.provider) ?? 0) > 1 ? `${PROVIDER_LABELS[channel.provider]} · ${channel.id}` : PROVIDER_LABELS[channel.provider],
      // A ComfyUI channel's selectable "models" are its imported workflows.
      models: channel.provider === 'comfyui' ? resolveComfyUIWorkflows(config).map(entry => entry.name) : cleanList(channel.models),
      ...(channel.baseURL !== undefined && channel.baseURL.trim() !== '' ? { baseURL: channel.baseURL.trim() } : {}),
      ...(channel.apiKeyEnv !== undefined && channel.apiKeyEnv.trim() !== '' ? { apiKeyEnv: channel.apiKeyEnv.trim() } : {}),
    }))
  }
  const active = config.provider ?? 'google'
  const channels: AgentChannelChoice[] = []
  for (const provider of IMAGE_PROVIDERS) {
    if (provider !== active && !channelExplicitlyConfigured(config, provider)) continue
    channels.push({ id: provider, provider, label: PROVIDER_LABELS[provider], models: modelOptionsFor(config, provider) })
  }
  return channels
}

function describeChannels(channels: readonly AgentChannelChoice[]): string {
  return channels
    .map(channel => `${channel.label} (channel "${channel.id}"${channel.models.length > 0 ? `, models: ${channel.models.map(model => `"${model}"`).join(', ')}` : ', no models configured'})`)
    .join('; ')
}

/**
 * Resolve the agent's channel choice when the call names one (by id, provider
 * id, or label). Unnamed calls are handled by {@link resolveAgentSelection}.
 */
function matchChannel(channels: readonly AgentChannelChoice[], wanted: string, raw: string): AgentChannelChoice {
  const byId = channels.find(channel => channel.id.toLowerCase() === wanted)
  if (byId !== undefined) return byId
  const byProvider = channels.filter(channel => channel.provider === wanted || channel.label.toLowerCase() === wanted)
  if (byProvider.length === 1) return byProvider[0]!
  if (byProvider.length > 1) {
    throw new Error(`"${raw}" matches several channels (${byProvider.map(channel => `"${channel.id}"`).join(', ')}) — call again with the exact channel id. Channels: ${describeChannels(byProvider)}.`)
  }
  throw new Error(`Unknown image channel "${raw}". Available channels: ${describeChannels(channels)}.`)
}

/** The channel that serves the default model: the recorded one, else the first declared. */
function defaultChannel(config: Config, channels: readonly AgentChannelChoice[]): AgentChannelChoice {
  const wanted = config.defaultChannelId?.trim().toLowerCase() ?? ''
  return channels.find(channel => channel.id.toLowerCase() === wanted) ?? channels[0]!
}

/** The model an unnamed call uses on the given channel: the recorded default when it lives here, else the first entry. */
export function defaultModelOn(config: Config, channel: AgentChannelChoice): string {
  const recorded = config.defaultModel?.trim() ?? ''
  if (recorded !== '' && config.defaultChannelId?.trim().toLowerCase() === channel.id.toLowerCase() && channel.models.includes(recorded)) return recorded
  return channel.models[0] ?? ''
}

/**
 * Resolve one agent call to its channel and model.
 *
 * The user curates a default in settings (one model on one channel); an
 * unnamed request goes there silently — no asking step. Naming a model
 * switches to whichever channel hosts it; naming an unknown one errors with
 * the closest option list so the agent can relay it.
 */
export function resolveAgentSelection(config: Config, requestedChannel: unknown, requestedModel: unknown): AgentSelection {
  const channels = agentChannels(config)
  if (channels.length === 0) {
    throw new Error('No image channel is available. Open Settings > Image generation and add one.')
  }
  const wantedChannel = typeof requestedChannel === 'string' ? requestedChannel.trim().toLowerCase() : ''
  const wantedModel = typeof requestedModel === 'string' ? requestedModel.trim() : ''

  if (wantedChannel !== '') {
    const channel = matchChannel(channels, wantedChannel, String(requestedChannel))
    if (wantedModel !== '') {
      const found = channel.models.find(model => model.toLowerCase() === wantedModel.toLowerCase())
      if (found === undefined) {
        throw new Error(`Unknown model "${wantedModel}" on ${channel.label}. Available models: ${channel.models.map(model => `"${model}"`).join(', ')}.`)
      }
      return { channel, model: found }
    }
    const model = defaultModelOn(config, channel)
    // ComfyUI is workflow-based: an empty model is legal there (the workflow
    // step resolves it) and must not trip the cloud no-models guard.
    if (model === '' && channel.provider !== 'comfyui') throw new Error(`Channel "${channel.label}" has no models configured — add one in Settings > Image generation.`)
    return { channel, model }
  }

  if (wantedModel !== '') {
    const hosts = channels.filter(channel => channel.models.some(model => model.toLowerCase() === wantedModel.toLowerCase()))
    if (hosts.length === 1) {
      const channel = hosts[0]!
      return { channel, model: channel.models.find(model => model.toLowerCase() === wantedModel.toLowerCase())! }
    }
    if (hosts.length > 1) {
      throw new Error(`"${wantedModel}" is configured on several channels (${hosts.map(channel => `"${channel.id}"`).join(', ')}) — call again with channel set to the exact id.`)
    }
    const channel = defaultChannel(config, channels)
    if (channels.length === 1) {
      throw new Error(`Unknown model "${wantedModel}" on ${channel.label}. Available models: ${channel.models.map(model => `"${model}"`).join(', ')}. Ask the user to pick one, or add "${wantedModel}" to a channel in Settings > Image generation.`)
    }
    throw new Error(`Unknown model "${wantedModel}". Available models: ${describeChannels(channels)}. Ask the user to pick one, or add "${wantedModel}" to a channel in Settings > Image generation.`)
  }

  const channel = defaultChannel(config, channels)
  const model = defaultModelOn(config, channel)
  // ComfyUI is workflow-based: an empty model is legal there (the workflow
  // step resolves it) and must not trip the cloud no-models guard.
  if (model === '' && channel.provider !== 'comfyui') {
    throw new Error(`Channel "${channel.label}" has no models configured — add one in Settings > Image generation.`)
  }
  return { channel, model }
}

/** Derive the config that pins one provider (and optionally one of its models) — legacy single-provider path. */
export function withProviderModel(config: Config, provider: ImageProvider, model?: string): Config {
  if (typeof model !== 'string' || model.trim() === '') return { ...config, provider }
  switch (provider) {
    case 'google': return { ...config, provider, googleModel: model }
    case 'openai': return { ...config, provider, openaiModel: model }
    case 'seedream': return { ...config, provider, seedreamModel: model }
    case 'dashscope': return { ...config, provider, dashscopeModel: model }
    case 'gitee': return { ...config, provider, giteeModel: model }
    case 'modelscope': return { ...config, provider, modelscopeModel: model }
    case 'antigravity': return { ...config, provider, antigravityModel: model }
    case 'comfyui': return { ...config, provider }
  }
}

/** Derive the config that pins one channel instance (endpoint + model) for profile resolution. */
export function channelProfile(config: Config, channel: { provider: ImageProvider; baseURL?: string | undefined }, model?: string): Config {
  const base = withProviderModel(config, channel.provider, model)
  const endpoint = channel.baseURL?.trim() ?? ''
  if (endpoint === '') return base
  switch (channel.provider) {
    case 'google': return { ...base, googleEndpoint: endpoint }
    case 'openai': return { ...base, openaiBaseURL: endpoint }
    case 'seedream': return { ...base, seedreamBaseURL: endpoint }
    case 'dashscope': return { ...base, dashscopeEndpoint: endpoint }
    case 'gitee': return { ...base, giteeBaseURL: endpoint }
    case 'modelscope': return { ...base, modelscopeBaseURL: endpoint }
    case 'antigravity': return { ...base, antigravityBaseURL: endpoint }
    case 'comfyui': return { ...base, comfyuiBaseURL: endpoint }
  }
}
