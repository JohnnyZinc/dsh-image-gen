/**
 * The settings card surface for the dsh-image-gen plugin.
 *
 * Visual & structural layout is modeled after the official DeepSeek Harness
 * "Models" settings section (`packages/client/ui-settings-models`):
 *
 *   ┌── section ──────────────────────────────────────────────┐
 *   │  title                                                   │
 *   │  intro                                                   │
 *   │  saved notice (when an Apply committed)                  │
 *   │  ┌─ rows (channels) ──────────────────────────────────┐  │
 *   │  │  • rowCard                                          │  │
 *   │  │    rowHead: name · [credential dot]  [Edit][Delete] │  │
 *   │  │    editor (when open): API key + Base URL + Models  │  │
 *   │  └─────────────────────────────────────────────────────┘  │
 *   │  addBlock: two dashed buttons                            │
 *   │    [+ Add channel]    [+ Add ComfyUI workflow]          │
 *   │  delete-confirm Modal                                   │
 *   └──────────────────────────────────────────────────────────┘
 *
 * The page owns its channel/ComfyUI drafts locally and writes them through
 * `props.scope.set(...)` and `props.credentials.set(...)` — the host is the
 * source of truth, the page only mutates it.
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  CLOUD_IMAGE_PROVIDERS,
  DEFAULT_BASE_URLS,
  DEFAULT_COMFYUI_BASE_URL,
  DEFAULT_COMFYUI_TIMEOUT_MS,
  IMAGE_PROVIDERS,
  MODELS_ROUTE,
  MAX_COMFYUI_WORKFLOW_BYTES,
  activeComfyUIWorkflow,
  resolveComfyUIWorkflows,
  uniqueComfyUIWorkflowName,
  type ComfyUIWorkflowEntry,
  type ImageProvider,
} from '../shared.js'
import { validateComfyUIWorkflowJson } from '../comfyui-workflow.js'
import type { LocaleService } from './gallery-view.js'

// ---------------------------------------------------------------------------
// Settings scope & credentials surface (mirrors what `index.tsx` injects).
// Defined locally so `settings-card.tsx` doesn't form a cycle with `index.tsx`.
// ---------------------------------------------------------------------------

export interface SettingsScopeSnapshot<T> {
  value: T | undefined
  writable: boolean
}

export interface SettingsScope<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
}

// ---------------------------------------------------------------------------
// Image settings payload + credentials surface.
// ---------------------------------------------------------------------------

export interface ImageSettings {
  provider?: ImageProvider
  channels?: Array<{ id?: unknown; provider?: unknown; baseURL?: unknown; apiKeyEnv?: unknown; models?: unknown }>
  googleModel?: string
  googleEndpoint?: string
  googleModels?: string[]
  openaiBaseURL?: string
  openaiModel?: string
  openaiModels?: string[]
  seedreamBaseURL?: string
  seedreamModel?: string
  seedreamModels?: string[]
  dashscopeEndpoint?: string
  dashscopeModel?: string
  dashscopeModels?: string[]
  giteeBaseURL?: string
  giteeModel?: string
  giteeModels?: string[]
  modelscopeBaseURL?: string
  modelscopeModel?: string
  modelscopeModels?: string[]
  antigravityBaseURL?: string
  antigravityModel?: string
  antigravityModels?: string[]
  defaultChannelId?: string
  defaultModel?: string
  comfyuiBaseURL?: string
  comfyuiWorkflows?: ComfyUIWorkflowEntry[]
  comfyuiActiveWorkflow?: string
  comfyuiWorkflowJson?: string
  comfyuiWorkflowName?: string
  comfyuiTimeoutMs?: number
  saveToWorkspace?: boolean
  workspaceFolder?: string
}

interface CredentialInfo { configured?: boolean }
interface CredentialResult { ok: boolean; value?: Readonly<Record<string, CredentialInfo>> }
interface CredentialMutationResult { ok: boolean; error?: { message?: string } }
interface CredentialsRemote {
  describe(refs: string[]): Promise<CredentialResult>
  set(ref: string, value: string): Promise<CredentialMutationResult>
}

interface SettingsFace {
  scope: SettingsScope<ImageSettings>
  credentials: CredentialsRemote
  locale?: LocaleService | undefined
}

export type ImageGenerationSettingsCardProps = PropsRuntime<'settings.section'> & InjectFace<SettingsFace>

type Provider = ImageProvider

// ---------------------------------------------------------------------------
// Channel draft + model picker state.
// ---------------------------------------------------------------------------

interface ChannelDraft {
  id: string
  provider: Provider
  displayName: string
  baseURL: string
  apiKeyEnv: string
  models: string[]
  keyInput: string
  keyConfigured: boolean
  keyProbing: boolean
}

interface ModelPickerState {
  channelId: string
  provider: Provider
  baseURL: string
  apiKey: string
  loading: boolean
  error: string
  candidates: Array<{ id: string; image: boolean }>
  checked: Set<string>
  query: string
}

const KEY_REF: Partial<Record<Provider, string>> = {
  google: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  seedream: 'ARK_API_KEY',
  dashscope: 'DASHSCOPE_API_KEY',
  gitee: 'GITEE_API_KEY',
  modelscope: 'MODELSCOPE_API_KEY',
  antigravity: 'ANTIGRAVITY_API_KEY',
}

const PROVIDER_ADDABLE: Provider[] = [...CLOUD_IMAGE_PROVIDERS] as Provider[]

const DEFAULT_WORKSPACE_FOLDER = 'dsh-image-gen'

// ---------------------------------------------------------------------------
// Locale dictionaries for the settings surface.
// ---------------------------------------------------------------------------

const DICT = {
  zh: {
    title: '图像生成',
    intro: '为对话中的图像生成配置 API Key、Endpoint 与模型。默认模型在对话输入框的"图像"按钮里切换。',
    addChannel: '添加渠道',
    addWorkflow: '添加 ComfyUI 工作流',
    savedProvider: '已保存 {provider}',
    credentialConfigured: 'API Key 已配置',
    credentialMissing: 'API Key 缺失',
    edit: '编辑',
    remove: '删除',
    editProvider: '编辑 {provider}',
    removeProvider: '删除 {provider}',
    cancel: '取消',
    apply: '保存',
    applying: '保存中…',
    deleteTitle: '删除 {provider}？',
    deleteDescription: '删除 {provider} 会移除其配置；其使用的凭证（如有）由其他位置管理，将会保留。',
    deleteDescriptionWithCredential: '删除 {provider} 会移除其配置和存储的 API Key。',
    deleteConfirm: '删除 {provider}',
    deleting: '正在删除 {provider}…',
    close: '关闭',
    customized: '自定义设置',
    baseUrl: '接口地址',
    baseUrlDefault: '默认',
    reset: '重置',
    resetTitle: '重置为默认官方地址',
    keyInput: 'API Key',
    keyPlaceholder: '输入 API Key',
    keyStored: '已配置——输入新值可替换',
    keyBlank: '请输入 API Key；留空则保持已存储的 Key。',
    provider: '提供方',
    models: '模型',
    modelsEmpty: '模型选择器中将不显示任何模型；未列出的 ID 仍可在对话里直接指定。',
    addModel: '添加模型',
    removeModel: '删除模型',
    modelId: '模型 ID',
    modelName: '显示名称',
    fetchModels: '获取可用模型',
    fetching: '正在询问提供方…',
    fetchTitle: '选择要添加的模型',
    fetchDescription: '以下是 {provider} 列出的可用模型，勾选要添加的模型。',
    fetchSearch: '搜索模型',
    fetchNoMatches: '没有匹配的模型。',
    fetchSelectAll: '全选',
    fetchDeselectAll: '取消全选',
    fetchAdopt: '添加所选',
    fetchEmpty: '该提供方没有列出任何模型，请手动添加。',
    fetchNeedsBaseUrl: '请先填写接口地址，再获取。',
    workflow: 'API Workflows',
    workflowImport: '导入 JSON 文件',
    workflowMissing: '尚未导入工作流',
    workflowImported: '已导入 {name}',
    workflowHint: '从 ComfyUI 导出 API Format JSON，在提示词输入写入 {{prompt}}，种子可用 {{seed}}；图生图工作流在 LoadImage 的 image 输入写入 {{image}}（仅一次）。可导入多个工作流，Agent 也能在调用时按名称指定。',
    workflowTooLarge: '工作流文件不能超过 5 MB。',
    workflowActiveTitle: '设为当前使用的工作流',
    workflowRemove: '删除',
    workflowPresetPlaceholder: '预设提示词，留空则只用对话内容',
    workflowPresetTitle: '预设提示词：每次调用此工作流时自动加在用户提示词前面。',
    workflowNameRequired: '工作流名称不能为空。',
    workflowDuplicateName: '工作流名称不能重复。',
    timeout: '生成超时（秒）',
    timeoutHint: '包括提交、等待和下载图片；默认 300 秒。',
    workspaceTitle: '保存到工作区',
    workspaceIntro: '选择是否把每次生成的图片另存为当前会话工作区里的文件。',
    saveToWorkspace: '保存到工作区',
    saveToWorkspaceHint: '把生成结果以文件形式写入当前会话工作区；关闭后图库依然保留内存里的记录。',
    folder: '工作区文件夹',
    folderHint: '相对当前会话工作区的子目录；留空表示工作区根目录。',
    saving: '保存中…',
    save: '保存',
    saved: '已保存',
    conflict: '这些设置在卡片打开期间已被其他地方改动。请关闭后重新打开，在当前值上编辑。',
    failure: '保存失败：{message}',
    providerGoogle: 'Google Gemini',
    providerOpenAI: 'OpenAI / 中转站',
    providerSeedream: '字节 Seedream',
    providerDashScope: '阿里 DashScope',
    providerGitee: 'Gitee AI',
    providerModelScope: 'ModelScope',
    providerAntigravity: 'Antigravity',
    providerComfyUI: '本地 ComfyUI',
    modelsNotLikelyImage: '该模型 ID 不像图像模型（仍可勾选）',
    endpointHintComfyUI: '正在运行且 DSH Host 可以访问的 ComfyUI 地址，默认使用本机 8188 端口。',
    selectProvider: '选择提供方',
    confirm: '确认',
    add: '添加',
    hmodelLabel: '图像',
    hmodelTitle: '图像模型：点击切换生图默认模型',
  },
  en: {
    title: 'Image generation',
    intro: 'Configure the API key, endpoint, and model list for each image-generation provider. Switch the default model from the "Image" button in the conversation composer.',
    addChannel: 'Add provider',
    addWorkflow: 'Add ComfyUI workflow',
    savedProvider: 'Saved {provider}',
    credentialConfigured: 'API key configured',
    credentialMissing: 'API key missing',
    edit: 'Edit',
    remove: 'Delete',
    editProvider: 'Edit {provider}',
    removeProvider: 'Delete {provider}',
    cancel: 'Cancel',
    apply: 'Apply',
    applying: 'Applying…',
    deleteTitle: 'Delete {provider}?',
    deleteDescription: 'Deleting {provider} removes its configuration. Any credential it uses is managed elsewhere and will be kept.',
    deleteDescriptionWithCredential: 'Deleting {provider} removes its configuration and stored API key.',
    deleteConfirm: 'Delete {provider}',
    deleting: 'Deleting {provider}…',
    close: 'Close',
    customized: 'Customized settings',
    baseUrl: 'Endpoint / Base URL',
    baseUrlDefault: 'Provider default',
    reset: 'Reset',
    resetTitle: 'Reset to official default URL',
    keyInput: 'API key',
    keyPlaceholder: 'Enter your API key',
    keyStored: 'Configured — enter a new value to replace',
    keyBlank: 'Enter the API key, or leave the field empty to keep the stored one.',
    provider: 'Provider',
    models: 'Models',
    modelsEmpty: 'No models will be shown in the selector. Unlisted IDs can still be sent directly.',
    addModel: 'Add model',
    removeModel: 'Delete model',
    modelId: 'Model ID',
    modelName: 'Display name',
    fetchModels: 'Fetch available models',
    fetching: 'Asking the provider…',
    fetchTitle: 'Choose models to add',
    fetchDescription: 'These are the models {provider} has available. Choose the ones to add.',
    fetchSearch: 'Search models',
    fetchNoMatches: 'No matching models.',
    fetchSelectAll: 'Select all',
    fetchDeselectAll: 'Deselect all',
    fetchAdopt: 'Add selected',
    fetchEmpty: 'The provider listed no models. Add them by hand.',
    fetchNeedsBaseUrl: 'Enter the base URL first, then fetch.',
    workflow: 'API Workflows',
    workflowImport: 'Import JSON file',
    workflowMissing: 'No workflow imported',
    workflowImported: 'Imported {name}',
    workflowHint: 'Export an API Format JSON from ComfyUI and place {{prompt}} in its prompt input; {{seed}} is available for a random seed. For image editing put {{image}} (exactly once) in the LoadImage image input. Import as many workflows as you need; the Agent can also pick one by name.',
    workflowTooLarge: 'Workflow files must be no larger than 5 MB.',
    workflowActiveTitle: 'Make this the active workflow',
    workflowRemove: 'Remove',
    workflowPresetPlaceholder: 'Preset prompt (optional)',
    workflowPresetTitle: 'Preset prompt: automatically prepended to the user prompt on every call of this workflow.',
    workflowNameRequired: 'Workflow names cannot be empty.',
    workflowDuplicateName: 'Workflow names must be unique.',
    timeout: 'Generation timeout (seconds)',
    timeoutHint: 'Covers submission, waiting, and image download; defaults to 300 seconds.',
    workspaceTitle: 'Save to workspace',
    workspaceIntro: 'Choose whether every generated image is also written as a file into the current session workspace.',
    saveToWorkspace: 'Save to workspace',
    saveToWorkspaceHint: 'Write each generated image as a file into the session workspace; the gallery still keeps an in-memory record either way.',
    folder: 'Workspace folder',
    folderHint: 'Subdirectory of the session workspace; empty means the workspace root.',
    saving: 'Saving…',
    save: 'Save',
    saved: 'Saved',
    conflict: 'Someone else changed these settings while this card was open. Close it and reopen to edit the current values.',
    failure: 'Save failed: {message}',
    providerGoogle: 'Google Gemini',
    providerOpenAI: 'OpenAI / Relay',
    providerSeedream: 'ByteDance Seedream',
    providerDashScope: 'Aliyun DashScope',
    providerGitee: 'Gitee AI',
    providerModelScope: 'ModelScope',
    providerAntigravity: 'Antigravity',
    providerComfyUI: 'Local ComfyUI',
    modelsNotLikelyImage: 'This id does not look like an image model (you can still check it)',
    endpointHintComfyUI: 'A running ComfyUI server reachable by the DSH Host; the default points to port 8188 on this computer.',
    selectProvider: 'Select provider',
    confirm: 'Confirm',
    add: 'Add',
    hmodelLabel: 'Image',
    hmodelTitle: 'Image model: click to switch the generation default',
  },
} as const

type DictKey = keyof typeof DICT.zh

// ---------------------------------------------------------------------------
// Channel utilities.
// ---------------------------------------------------------------------------

function deriveKeyRef(provider: Provider): string {
  const fallback = KEY_REF[provider]
  if (fallback !== undefined) return fallback
  return provider === 'comfyui' ? '' : ''
}

type CloudProvider = Exclude<Provider, 'comfyui'>

function modelsKeyOf(provider: CloudProvider): 'googleModels' | 'openaiModels' | 'seedreamModels' | 'dashscopeModels' | 'giteeModels' | 'modelscopeModels' | 'antigravityModels' {
  switch (provider) {
    case 'google': return 'googleModels'
    case 'openai': return 'openaiModels'
    case 'seedream': return 'seedreamModels'
    case 'gitee': return 'giteeModels'
    case 'modelscope': return 'modelscopeModels'
    case 'antigravity': return 'antigravityModels'
    case 'dashscope': return 'dashscopeModels'
  }
}

function legacyEndpointKeyOf(provider: CloudProvider): 'googleEndpoint' | 'openaiBaseURL' | 'seedreamBaseURL' | 'dashscopeEndpoint' | 'giteeBaseURL' | 'modelscopeBaseURL' | 'antigravityBaseURL' {
  switch (provider) {
    case 'google': return 'googleEndpoint'
    case 'openai': return 'openaiBaseURL'
    case 'seedream': return 'seedreamBaseURL'
    case 'gitee': return 'giteeBaseURL'
    case 'modelscope': return 'modelscopeBaseURL'
    case 'antigravity': return 'antigravityBaseURL'
    case 'dashscope': return 'dashscopeEndpoint'
  }
}

function legacyModelKeyOf(provider: CloudProvider): 'googleModel' | 'openaiModel' | 'seedreamModel' | 'dashscopeModel' | 'giteeModel' | 'modelscopeModel' | 'antigravityModel' {
  switch (provider) {
    case 'google': return 'googleModel'
    case 'openai': return 'openaiModel'
    case 'seedream': return 'seedreamModel'
    case 'gitee': return 'giteeModel'
    case 'modelscope': return 'modelscopeModel'
    case 'antigravity': return 'antigravityModel'
    case 'dashscope': return 'dashscopeModel'
  }
}

function baseURLOf(provider: Provider, value: ImageSettings | undefined): string {
  const stored = provider === 'google' ? value?.googleEndpoint
    : provider === 'openai' ? value?.openaiBaseURL
    : provider === 'seedream' ? value?.seedreamBaseURL
    : provider === 'dashscope' ? value?.dashscopeEndpoint
    : provider === 'gitee' ? value?.giteeBaseURL
    : provider === 'modelscope' ? value?.modelscopeBaseURL
    : provider === 'antigravity' ? value?.antigravityBaseURL
    : value?.comfyuiBaseURL
  return typeof stored === 'string' && stored.length > 0 ? stored : DEFAULT_BASE_URLS[provider]
}

function modelsListOf(provider: CloudProvider, value: ImageSettings | undefined): string[] {
  const stored = value === undefined ? undefined : value[modelsKeyOf(provider)]
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []
}

function channelDisplayName(provider: Provider, t: (key: DictKey) => string): string {
  const key = (
    {
      google: 'providerGoogle',
      openai: 'providerOpenAI',
      seedream: 'providerSeedream',
      dashscope: 'providerDashScope',
      gitee: 'providerGitee',
      modelscope: 'providerModelScope',
      antigravity: 'providerAntigravity',
      comfyui: 'providerComfyUI',
    } as const
  )[provider]
  return t(key)
}

export function channelsFromSettings(value: ImageSettings | undefined): ChannelDraft[] {
  const declared = Array.isArray(value?.channels) ? value.channels : []
  const drafts: ChannelDraft[] = []
  for (const channel of declared) {
    if (channel === null || typeof channel !== 'object') continue
    if (typeof channel.id !== 'string' || channel.id.trim() === '') continue
    if (typeof channel.provider !== 'string' || !(IMAGE_PROVIDERS as readonly string[]).includes(channel.provider)) continue
    drafts.push({
      id: channel.id.trim(),
      provider: channel.provider as Provider,
      displayName: channelDisplayName(channel.provider as Provider, (k) => DICT.zh[k] as string),
      baseURL: typeof channel.baseURL === 'string' ? channel.baseURL : '',
      apiKeyEnv: typeof channel.apiKeyEnv === 'string' ? channel.apiKeyEnv : '',
      models: Array.isArray(channel.models) ? channel.models.filter((id): id is string => typeof id === 'string') : [],
      keyInput: '',
      keyConfigured: false,
      keyProbing: true,
    })
  }
  if (drafts.length > 0) return drafts
  const comfyWorkflows = resolveComfyUIWorkflows(value ?? {})
  if (comfyWorkflows.length > 0 || value?.provider === 'comfyui') {
    drafts.push({
      id: 'comfyui', provider: 'comfyui', displayName: DICT.zh.providerComfyUI,
      baseURL: value?.comfyuiBaseURL ?? DEFAULT_COMFYUI_BASE_URL, apiKeyEnv: '',
      models: comfyWorkflows.map(entry => entry.name), keyInput: '', keyConfigured: false, keyProbing: false,
    })
  }
  if (drafts.length > 0) return drafts
  const provider = (value?.provider ?? 'google') as Provider
  if (provider === 'comfyui') return []
  return [{ id: provider, provider, displayName: channelDisplayName(provider, (k) => DICT.zh[k] as string), baseURL: baseURLOf(provider, value), apiKeyEnv: '', models: modelsListOf(provider, value), keyInput: '', keyConfigured: false, keyProbing: true }]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerCopy(template: string, provider: string, displayName: string): string {
  const label = provider === displayName ? provider : `${displayName} (${provider})`
  return template.replace('{provider}', () => label)
}

// ---------------------------------------------------------------------------
// Icon components (inline so the bundle has no asset dependency).
// ---------------------------------------------------------------------------

function IconPlusOutline16({ size = 14 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3.25v9.5M3.25 8h9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function IconChevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}>
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconTrash(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconClose(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Modal (matches DSH's official Modal primitive style: backdrop blur, 480px,
// header w/ close button, title, description, footer).
// ---------------------------------------------------------------------------

interface ModalProps {
  open: boolean
  title: string
  description?: string
  closeLabel: string
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  width?: number
}

function Modal(props: ModalProps): ReactNode {
  if (!props.open) return null
  return (
    <div className="dsh-ig-modal-backdrop" onClick={props.onClose}>
      <div
        className="dsh-ig-modal-box"
        style={props.width !== undefined ? { maxWidth: `${String(props.width)}px` } : undefined}
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className="dsh-ig-modal-header">
          <div className="dsh-ig-modal-title">{props.title}</div>
          <button type="button" className="dsh-ig-modal-btn dsh-ig-modal-btn-cancel" aria-label={props.closeLabel} onClick={props.onClose}>
            <IconClose />
          </button>
        </div>
        {props.description !== undefined && props.description !== '' ? (
          <div className="dsh-ig-modal-body">
            <p className="dsh-ig-modal-desc">{props.description}</p>
          </div>
        ) : null}
        {props.children}
        {props.footer !== undefined ? <div className="dsh-ig-modal-footer">{props.footer}</div> : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top-level card.
// ---------------------------------------------------------------------------

export function ImageGenerationSettingsCard(props: ImageGenerationSettingsCardProps): ReactNode {
  const [snapshot, setSnapshot] = useState<SettingsScopeSnapshot<ImageSettings>>(() => props.scope.getSnapshot())
  const [lang, setLang] = useState<'zh' | 'en'>(() => (props.locale?.getSnapshot?.()?.active?.startsWith('en') ? 'en' : 'zh'))
  const [channels, setChannels] = useState<ChannelDraft[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ChannelDraft | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)

  useEffect(() => props.scope.subscribe(() => { setSnapshot(props.scope.getSnapshot()) }), [props.scope])
  useEffect(() => {
    return props.locale?.subscribe?.(() => {
      setLang(props.locale?.getSnapshot?.()?.active?.startsWith('en') ? 'en' : 'zh')
    })
  }, [props.locale])

  const t = (key: DictKey, params?: Record<string, string>): string => {
    const dict = lang === 'en' ? DICT.en : DICT.zh
    let text = (dict[key] ?? DICT.zh[key] ?? key) as string
    if (params !== undefined) {
      for (const [k, v] of Object.entries(params)) text = text.replace(`{${k}}`, v)
    }
    return text
  }

  // Re-draft channels from the snapshot whenever it changes.
  useEffect(() => {
    const drafts = channelsFromSettings(snapshot.value).map(channel => ({
      ...channel,
      displayName: channelDisplayName(channel.provider, t),
    }))
    setChannels(drafts)
    setEditingId(previous => drafts.some(channel => channel.id === previous) ? previous : null)
    setDeleteTarget(previous => drafts.some(channel => channel.id === previous?.id) ? previous : null)
  // t changes when lang changes; we want the refreshed displayName either way.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, lang])

  // Probe credentials once on mount and whenever the channels list changes.
  const probedOnceRef = useRef(false)
  useEffect(() => {
    const probeable = channels.filter(channel => channel.provider !== 'comfyui' && !channel.keyProbing)
    if (probeable.length === 0) return
    const refs = probeable.map(channel => channel.apiKeyEnv.trim() !== '' ? channel.apiKeyEnv.trim() : KEY_REF[channel.provider] ?? '').filter(ref => ref !== '')
    if (refs.length === 0) {
      setChannels(current => current.map(channel => ({ ...channel, keyConfigured: false })))
      probedOnceRef.current = true
      return
    }
    let stale = false
    void props.credentials.describe(refs).then(result => {
      if (stale || !result.ok || result.value === undefined) return
      const map = result.value
      setChannels(current => current.map(channel => {
        const ref = channel.apiKeyEnv.trim() !== '' ? channel.apiKeyEnv.trim() : KEY_REF[channel.provider] ?? ''
        return { ...channel, keyConfigured: ref !== '' ? map[ref]?.configured === true : false }
      }))
      probedOnceRef.current = true
    })
    return () => { stale = true }
  }, [channels.filter(c => c.id).map(c => c.apiKeyEnv).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const persistChannels = async (next: ChannelDraft[]): Promise<void> => {
    const stored = next.map(channel => ({
      id: channel.id,
      provider: channel.provider,
      baseURL: channel.baseURL.trim(),
      apiKeyEnv: channel.apiKeyEnv.trim(),
      models: [...new Set(channel.models)],
    }))
    await props.scope.set('channels', stored)
    // Mirror per-provider legacy fields so the Studio workbench stays functional.
    const perProvider = new Map<Provider, ChannelDraft[]>()
    for (const channel of next) {
      const list = perProvider.get(channel.provider) ?? []
      list.push(channel)
      perProvider.set(channel.provider, list)
    }
    for (const [providerKey, list] of perProvider) {
      const first = list[0]
      if (first === undefined) continue
      // ComfyUI doesn't take part in the per-provider mirror: its endpoint
      // and workflows are managed by their own dedicated editor.
      if (providerKey === 'comfyui') continue
      const endpointKey = legacyEndpointKeyOf(providerKey)
      const modelKey = legacyModelKeyOf(providerKey)
      const models = [...new Set(list.flatMap(channel => channel.models))]
      if (first.baseURL.trim() !== '') await props.scope.set(endpointKey, first.baseURL.trim())
      const headModel = models[0]
      if (headModel !== undefined && headModel !== '') await props.scope.set(modelKey, headModel)
      await props.scope.set(modelsKeyOf(providerKey), models)
    }
  }

  const persistKeys = async (channelsToSave: ChannelDraft[]): Promise<void> => {
    for (const channel of channelsToSave) {
      if (channel.provider === 'comfyui') continue
      if (channel.keyInput.trim() === '') continue
      const keyRef = channel.apiKeyEnv.trim() !== '' ? channel.apiKeyEnv.trim() : KEY_REF[channel.provider] ?? ''
      if (keyRef === undefined || keyRef === '') continue
      const response = await props.credentials.set(keyRef, channel.keyInput.trim())
      if (!response.ok) throw new Error(response.error?.message ?? 'Failed to save API key')
    }
  }

  const onChannelSaved = (channel: ChannelDraft): void => {
    setSavedId(channel.id)
    setEditingId(null)
  }

  const onChannelRemove = async (channel: ChannelDraft): Promise<void> => {
    setDeleting(true)
    try {
      const next = channels.filter(entry => entry.id !== channel.id)
      // Best-effort: also clear the legacy mirrored fields if this was the only
      // channel on its provider. Not fatal if the host refuses.
      await persistChannels(next)
      const keyRef = channel.apiKeyEnv.trim() !== '' ? channel.apiKeyEnv.trim() : KEY_REF[channel.provider] ?? ''
      if (channel.provider !== 'comfyui' && keyRef !== '' && channel.keyConfigured) {
        try { await props.credentials.set(keyRef, '') } catch { /* best-effort */ }
      }
      setChannels(next)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const addCloudChannel = (provider: Provider): void => {
    const id = `ch-${Date.now().toString(36)}`
    const draft: ChannelDraft = {
      id, provider,
      displayName: channelDisplayName(provider, t),
      baseURL: DEFAULT_BASE_URLS[provider],
      apiKeyEnv: KEY_REF[provider] ?? '',
      models: [], keyInput: '',
      keyConfigured: false, keyProbing: false,
    }
    setChannels(current => [...current, draft])
    setEditingId(id)
  }

  // ComfyUI workflows are stored in a single dedicated section of the snapshot.
  const [comfyBaseURL, setComfyBaseURL] = useState(DEFAULT_COMFYUI_BASE_URL)
  const [comfyWorkflows, setComfyWorkflows] = useState<ComfyUIWorkflowEntry[]>([])
  const [activeComfy, setActiveComfy] = useState('')
  const [timeoutSeconds, setTimeoutSeconds] = useState(DEFAULT_COMFYUI_TIMEOUT_MS / 1000)
  const [comfyEditing, setComfyEditing] = useState(false)
  useEffect(() => {
    const value = snapshot.value
    setComfyBaseURL(value?.comfyuiBaseURL ?? DEFAULT_COMFYUI_BASE_URL)
    setComfyWorkflows(resolveComfyUIWorkflows(value ?? {}))
    setActiveComfy(activeComfyUIWorkflow(value ?? {})?.name ?? '')
    setTimeoutSeconds(Math.max(1, Math.round((value?.comfyuiTimeoutMs ?? DEFAULT_COMFYUI_TIMEOUT_MS) / 1000)))
  }, [snapshot])

  const saveComfy = async (event?: ChangeEvent<HTMLFormElement>): Promise<void> => {
    event?.preventDefault()
    const entries = comfyWorkflows.map(entry => ({ name: entry.name.trim(), json: entry.json, presetPrompt: (entry.presetPrompt ?? '').trim() }))
    for (const entry of entries) {
      if (entry.name.length === 0) throw new Error(t('workflowNameRequired'))
      validateComfyUIWorkflowJson(entry.json)
    }
    if (new Set(entries.map(entry => entry.name)).size !== entries.length) throw new Error(t('workflowDuplicateName'))
    const active = entries.find(entry => entry.name === activeComfy) ?? entries[0]
    await props.scope.set('comfyuiBaseURL', comfyBaseURL)
    await props.scope.set('comfyuiWorkflows', entries)
    await props.scope.set('comfyuiActiveWorkflow', active === undefined ? '' : active.name)
    await props.scope.set('comfyuiWorkflowJson', active === undefined ? '' : active.json)
    await props.scope.set('comfyuiWorkflowName', active === undefined ? '' : active.name)
    await props.scope.set('comfyuiTimeoutMs', Math.max(1, Math.round(timeoutSeconds)) * 1000)
    setComfyEditing(false)
  }

  // Workspace section
  const [saveToWorkspace, setSaveToWorkspace] = useState(true)
  const [workspaceFolder, setWorkspaceFolder] = useState(DEFAULT_WORKSPACE_FOLDER)
  const [workspaceMessage, setWorkspaceMessage] = useState('')
  const [workspaceSaving, setWorkspaceSaving] = useState(false)
  useEffect(() => {
    setSaveToWorkspace(snapshot.value?.saveToWorkspace ?? true)
    setWorkspaceFolder(snapshot.value?.workspaceFolder ?? DEFAULT_WORKSPACE_FOLDER)
  }, [snapshot])

  const saveWorkspace = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setWorkspaceSaving(true)
    setWorkspaceMessage('')
    try {
      await props.scope.set('saveToWorkspace', saveToWorkspace)
      await props.scope.set('workspaceFolder', workspaceFolder.trim())
      setWorkspaceMessage(t('saved'))
    } catch (cause) {
      setWorkspaceMessage(t('failure', { message: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setWorkspaceSaving(false)
    }
  }

  const savedDraft = useMemo(
    () => savedId === null ? undefined : channels.find(channel => channel.id === savedId),
    [channels, savedId],
  )

  return (
    <div className="dsh-ig-section">
      {/* ---------------- Section 1: Channels & Models ---------------- */}
      <h2 className="dsh-ig-title">{t('title')}</h2>
      <p className="dsh-ig-intro">{t('intro')}</p>
      {savedDraft !== undefined ? (
        <p className="dsh-ig-savedNotice" role="status" aria-live="polite">
          {providerCopy(t('savedProvider'), savedDraft.provider, savedDraft.displayName)}
        </p>
      ) : null}
      <ul className="dsh-ig-rows">
        {channels.map(channel => (
          <ChannelRowCard
            key={channel.id}
            channel={channel}
            t={t}
            open={editingId === channel.id}
            onEdit={() => { setEditingId(channel.id) }}
            onRemove={() => { setDeleteTarget(channel) }}
            onClose={() => { setEditingId(null) }}
            onSaved={() => { void onChannelSaved(channel) }}
            onChange={updated => { setChannels(current => current.map(entry => entry.id === channel.id ? updated : entry)) }}
            persistChannels={persistChannels}
            persistKeys={persistKeys}
          />
        ))}
      </ul>
      <div className="dsh-ig-addBlock">
        <div className="dsh-ig-addActions">
          <ProviderAddDropdown t={t} disabled={!snapshot.writable} onPick={addCloudChannel} />
          <button
            type="button"
            className="dsh-ig-addButton"
            disabled={!snapshot.writable}
            onClick={() => { setComfyEditing(true) }}
          >
            <IconPlusOutline16 />
            {t('addWorkflow')}
          </button>
        </div>
      </div>

      {/* ---------------- Section 2: ComfyUI workflows ---------------- */}
      {comfyWorkflows.length > 0 || comfyEditing ? (
        <ComfyUIEditor
          t={t}
          baseURL={comfyBaseURL}
          onBaseURLChange={setComfyBaseURL}
          workflows={comfyWorkflows}
          onWorkflowsChange={setComfyWorkflows}
          activeName={activeComfy}
          onActiveChange={setActiveComfy}
          timeoutSeconds={timeoutSeconds}
          onTimeoutChange={setTimeoutSeconds}
          open={comfyEditing}
          onOpen={() => { setComfyEditing(true) }}
          onClose={() => { setComfyEditing(false) }}
          onSave={saveComfy}
        />
      ) : null}

      {/* ---------------- Section 3: Workspace ---------------- */}
      <WorkspaceSection
        t={t}
        saveToWorkspace={saveToWorkspace}
        onToggleSave={setSaveToWorkspace}
        workspaceFolder={workspaceFolder}
        onFolderChange={setWorkspaceFolder}
        onSubmit={saveWorkspace}
        saving={workspaceSaving}
        message={workspaceMessage}
        writable={snapshot.writable}
      />

      {/* ---------------- Delete confirmation ---------------- */}
      <Modal
        open={deleteTarget !== null}
        title={deleteTarget === null ? '' : providerCopy(t('deleteTitle'), deleteTarget.provider, deleteTarget.displayName)}
        description={deleteTarget === null
          ? ''
          : providerCopy(
            deleteTarget.provider === 'comfyui' || !deleteTarget.keyConfigured
              ? t('deleteDescription')
              : t('deleteDescriptionWithCredential'),
            deleteTarget.provider, deleteTarget.displayName,
          )}
        closeLabel={t('close')}
        onClose={() => { if (!deleting) setDeleteTarget(null) }}
        width={480}
        footer={(
          <>
            <button type="button" className="dsh-ig-modal-btn dsh-ig-modal-btn-cancel" disabled={deleting} onClick={() => { setDeleteTarget(null) }}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className="dsh-ig-modal-btn dsh-ig-modal-btn-danger"
              disabled={deleting}
              onClick={() => { void onChannelRemove(deleteTarget as ChannelDraft) }}
            >
              {deleteTarget === null ? '' : providerCopy(deleting ? t('deleting') : t('deleteConfirm'), deleteTarget.provider, deleteTarget.displayName)}
            </button>
          </>
        )}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Provider "Add" dropdown — picks one of the addable providers, opens the card.
// ---------------------------------------------------------------------------

function ProviderAddDropdown({ t, disabled, onPick }: { t: (k: DictKey) => string; disabled: boolean; onPick: (p: Provider) => void }): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div className="dsh-ig-addMenu">
      <button
        type="button"
        className="dsh-ig-addButton"
        disabled={disabled}
        onClick={() => { setOpen(value => !value) }}
      >
        <IconPlusOutline16 />
        {t('addChannel')}
      </button>
      {open ? (
        <>
          <div className="dsh-ig-addMenuBackdrop" onClick={() => { setOpen(false) }} />
          <div className="dsh-ig-addMenuList">
            {PROVIDER_ADDABLE.map(provider => (
              <button
                type="button"
                key={provider}
                className="dsh-ig-addMenuItem"
                onClick={() => { setOpen(false); onPick(provider) }}
              >
                <span>{channelDisplayName(provider, t)}</span>
                <span className="dsh-ig-addMenuRoute">{provider}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Channel row card (the "provider row" of the Models page).
// ---------------------------------------------------------------------------

interface ChannelRowCardProps {
  channel: ChannelDraft
  t: (k: DictKey, p?: Record<string, string>) => string
  open: boolean
  onEdit: () => void
  onRemove: () => void
  onClose: () => void
  onSaved: () => void
  onChange: (next: ChannelDraft) => void
  persistChannels: (channels: ChannelDraft[]) => Promise<void>
  persistKeys: (channels: ChannelDraft[]) => Promise<void>
}

function ChannelRowCard(props: ChannelRowCardProps): ReactNode {
  const { channel, t, open, onEdit, onRemove, onClose, onSaved, onChange, persistChannels, persistKeys } = props
  const label = channelDisplayName(channel.provider, t)
  const target = { provider: channel.provider, displayName: label }

  return (
    <li className="dsh-ig-rowCard">
      <div className="dsh-ig-rowHead">
        <span className="dsh-ig-rowIdentity">
          <span className="dsh-ig-rowName">{label}</span>
          {channel.provider !== 'comfyui'
            ? channel.keyConfigured
              ? <span className="dsh-ig-credentialDot dsh-ig-credentialDotConfigured" role="img" aria-label={t('credentialConfigured')} title={t('credentialConfigured')} />
              : <span className="dsh-ig-credentialDot dsh-ig-credentialDotMissing" role="img" aria-label={t('credentialMissing')} title={t('credentialMissing')} />
            : null}
        </span>
        <span className="dsh-ig-rowActions">
          <button
            type="button"
            className="dsh-ig-secondaryButton"
            aria-label={providerCopy(t('editProvider'), target.provider, target.displayName)}
            onClick={open ? onClose : onEdit}
          >
            {t('edit')}
          </button>
          <button
            type="button"
            className="dsh-ig-dangerButton"
            aria-label={providerCopy(t('removeProvider'), target.provider, target.displayName)}
            onClick={onRemove}
          >
            {t('remove')}
          </button>
        </span>
      </div>
      {open ? (
        <ChannelEditor
          channel={channel}
          t={t}
          onClose={onClose}
          onSaved={onSaved}
          onChange={onChange}
          persistChannels={persistChannels}
          persistKeys={persistKeys}
        />
      ) : null}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Channel editor: API key, "Customized settings" disclosure (Base URL + Models),
// and the editor footer (Cancel / Apply).
// ---------------------------------------------------------------------------

interface ChannelEditorProps {
  channel: ChannelDraft
  t: (k: DictKey, p?: Record<string, string>) => string
  onClose: () => void
  onSaved: () => void
  onChange: (next: ChannelDraft) => void
  persistChannels: (channels: ChannelDraft[]) => Promise<void>
  persistKeys: (channels: ChannelDraft[]) => Promise<void>
}

function ChannelEditor(props: ChannelEditorProps): ReactNode {
  const { channel, t, onClose, onSaved, onChange, persistChannels, persistKeys } = props
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [advanced, setAdvanced] = useState(true)

  const label = channelDisplayName(channel.provider, t)
  const target = { provider: channel.provider, displayName: label }

  const apply = async (): Promise<void> => {
    if (channel.keyInput.trim() !== '') {
      const ref = channel.apiKeyEnv.trim() !== '' ? channel.apiKeyEnv.trim() : KEY_REF[channel.provider] ?? ''
      if (ref === '') { setFailure(t('keyBlank')); return }
    }
    setBusy(true); setFailure(undefined)
    try {
      await persistChannels([channel])
      await persistKeys([channel])
      onSaved()
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dsh-ig-editor">
      <div className="dsh-ig-editorHeader">
        <span className="dsh-ig-editorTitle">{label}</span>
        {channel.provider !== label ? <span className="dsh-ig-editorRoute">{channel.provider}</span> : null}
      </div>
      <div className="dsh-ig-field">
        <span className="dsh-ig-fieldLabel">{t('keyInput')}</span>
        <input
          className="dsh-ig-input"
          type="password"
          autoComplete="off"
          value={channel.keyInput}
          placeholder={channel.keyConfigured ? t('keyStored') : t('keyPlaceholder')}
          aria-label={t('keyInput')}
          onChange={event => { onChange({ ...channel, keyInput: event.target.value }) }}
        />
        <span className="dsh-ig-advancedHint">{t('keyBlank')}</span>
      </div>
      <button type="button" className="dsh-ig-customizedSummary" onClick={() => { setAdvanced(value => !value) }} aria-expanded={advanced}>
        {t('customized')}
      </button>
      {advanced ? (
        <div className="dsh-ig-customizedBody">
          <div className="dsh-ig-field">
            <span className="dsh-ig-fieldLabel">{t('baseUrl')}</span>
            <div className="dsh-ig-endpointGroup">
              <input
                className="dsh-ig-input"
                type="url"
                value={channel.baseURL}
                onChange={event => { onChange({ ...channel, baseURL: event.target.value }) }}
                placeholder={DEFAULT_BASE_URLS[channel.provider]}
                aria-label={t('baseUrl')}
              />
              <button
                type="button"
                className="dsh-ig-secondaryButton dsh-ig-endpointReset"
                title={t('resetTitle')}
                onClick={() => { onChange({ ...channel, baseURL: DEFAULT_BASE_URLS[channel.provider] }) }}
              >
                {t('reset')}
              </button>
            </div>
          </div>
          <ModelCatalogEditor
            t={t}
            channel={channel}
            onChange={onChange}
          />
        </div>
      ) : null}
      {failure !== undefined ? <p className="dsh-ig-error">{failure}</p> : null}
      <div className="dsh-ig-editorActions">
        <button type="button" className="dsh-ig-secondaryButton" disabled={busy} onClick={onClose}>{t('cancel')}</button>
        <button type="button" className="dsh-ig-primaryButton" disabled={busy} onClick={() => { void apply() }}>
          {busy ? t('applying') : t('apply')}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Model catalog editor: the list of model ids + fetch dialog.
// ---------------------------------------------------------------------------

interface ModelCatalogEditorProps {
  t: (k: DictKey, p?: Record<string, string>) => string
  channel: ChannelDraft
  onChange: (next: ChannelDraft) => void
}

function ModelCatalogEditor({ t, channel, onChange }: ModelCatalogEditorProps): ReactNode {
  const [picker, setPicker] = useState<ModelPickerState | null>(null)

  const patchModels = (models: string[]): void => {
    onChange({ ...channel, models })
  }

  const fetchModels = async (): Promise<void> => {
    setPicker({
      channelId: channel.id, provider: channel.provider, baseURL: channel.baseURL,
      apiKey: channel.keyInput.trim(), loading: true, error: '',
      candidates: [], checked: new Set(), query: '',
    })
    try {
      const response = await fetch(MODELS_ROUTE, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: channel.provider, baseURL: channel.baseURL, apiKey: channel.keyInput.trim() }),
      })
      const body = await response.json() as { ok: boolean; models?: Array<{ id: string; image: boolean }>; error?: string }
      if (!body.ok || body.models === undefined) throw new Error(body.error ?? `HTTP ${String(response.status)}`)
      const sorted = [...body.models].sort((a, b) => (a.image === b.image ? a.id.localeCompare(b.id) : a.image ? -1 : 1))
      const known = new Set(channel.models)
      setPicker({
        channelId: channel.id, provider: channel.provider, baseURL: channel.baseURL,
        apiKey: channel.keyInput.trim(), loading: false, error: '',
        candidates: sorted, checked: new Set(sorted.filter(m => !known.has(m.id)).map(m => m.id)), query: '',
      })
    } catch (cause) {
      setPicker(previous => previous === null ? null : { ...previous, loading: false, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  const askable = channel.baseURL.trim() !== ''
  const togglePicker = (id: string): void => {
    setPicker(previous => {
      if (previous === null) return null
      const next = new Set(previous.checked)
      if (next.has(id)) next.delete(id); else next.add(id)
      return { ...previous, checked: next }
    })
  }

  const visibleCandidates = picker === null ? [] : (() => {
    const q = picker.query.trim().toLowerCase()
    if (q === '') return picker.candidates
    return picker.candidates.filter(c => c.id.toLowerCase().includes(q))
  })()
  const allVisiblePicked = visibleCandidates.length > 0 && visibleCandidates.every(c => picker?.checked.has(c.id) === true)

  const toggleVisibleAll = (): void => {
    setPicker(previous => {
      if (previous === null) return null
      const next = new Set(previous.checked)
      if (allVisiblePicked) {
        for (const c of visibleCandidates) next.delete(c.id)
      } else {
        for (const c of visibleCandidates) next.add(c.id)
      }
      return { ...previous, checked: next }
    })
  }

  const adoptPicked = (): void => {
    if (picker === null) return
    const picked = picker.candidates.filter(c => picker.checked.has(c.id))
    const merged = [...new Set([...channel.models, ...picked.map(c => c.id)])]
    patchModels(merged)
    setPicker(null)
  }

  return (
    <div className="dsh-ig-modelCatalog">
      <div className="dsh-ig-modelListHead">
        <div className="dsh-ig-modelCatalogHeading">
          <span className="dsh-ig-modelCatalogTitle">{t('models')}</span>
          <span className="dsh-ig-modelCatalogMeta">{channel.models.length}</span>
        </div>
        <button
          type="button"
          className="dsh-ig-linkButton"
          disabled={!askable || picker?.loading === true}
          title={askable ? undefined : t('fetchNeedsBaseUrl')}
          onClick={() => { void fetchModels() }}
        >
          {picker?.loading === true ? t('fetching') : t('fetchModels')}
        </button>
      </div>
      {channel.models.length === 0 ? <p className="dsh-ig-modelEmpty">{t('modelsEmpty')}</p> : null}
      {channel.models.map((id, index) => (
        <div key={`${String(index)}-${id}`} className="dsh-ig-modelEntry">
          <div className="dsh-ig-modelRow">
            <input
              className="dsh-ig-input"
              type="text"
              value={id}
              placeholder={t('modelId')}
              aria-label={`${t('modelId')} ${String(index + 1)}`}
              onChange={event => {
                const next = [...channel.models]
                next[index] = event.target.value
                patchModels(next)
              }}
            />
            <span className="dsh-ig-input dsh-ig-modelNameDisplay">{id}</span>
            <span />
            <button
              type="button"
              className="dsh-ig-iconButton dsh-ig-iconButtonDanger"
              aria-label={`${t('removeModel')} ${String(index + 1)}`}
              title={t('removeModel')}
              onClick={() => { patchModels(channel.models.filter((_, at) => at !== index)) }}
            >
              <IconTrash />
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="dsh-ig-addModelButton"
        onClick={() => { patchModels([...channel.models, '']) }}
      >
        {t('addModel')}
      </button>
      <Modal
        open={picker !== null}
        title={t('fetchTitle')}
        description={picker === null ? '' : t('fetchDescription', { provider: channelDisplayName(picker.provider, t) })}
        closeLabel={t('close')}
        onClose={() => { setPicker(null) }}
        width={520}
        footer={(
          <>
            <button type="button" className="dsh-ig-modal-btn dsh-ig-modal-btn-cancel" onClick={() => { setPicker(null) }}>{t('cancel')}</button>
            <button type="button" className="dsh-ig-modal-btn dsh-ig-modal-btn-primary" onClick={adoptPicked}>{t('fetchAdopt')}</button>
          </>
        )}
      >
        {picker?.error !== undefined && picker.error !== '' ? (
          <p className="dsh-ig-error">{picker.error}</p>
        ) : null}
        {picker !== null ? (
          <div className="dsh-ig-candidateToolbar">
            <input
              className="dsh-ig-input dsh-ig-candidateSearch"
              type="search"
              value={picker.query}
              placeholder={t('fetchSearch')}
              aria-label={t('fetchSearch')}
              onChange={event => { setPicker({ ...picker, query: event.target.value }) }}
            />
            <button
              type="button"
              className="dsh-ig-linkButton"
              disabled={visibleCandidates.length === 0}
              onClick={toggleVisibleAll}
            >
              {allVisiblePicked ? t('fetchDeselectAll') : t('fetchSelectAll')}
            </button>
          </div>
        ) : null}
        {picker !== null ? (
          visibleCandidates.length === 0
            ? <p className="dsh-ig-candidateEmpty" role="status">{t('fetchNoMatches')}</p>
            : (
              <ul className="dsh-ig-candidateList">
                {visibleCandidates.map(candidate => (
                  <li key={candidate.id} className="dsh-ig-candidate">
                    <label className="dsh-ig-candidateLabel" title={candidate.image ? undefined : t('modelsNotLikelyImage')}>
                      <input
                        type="checkbox"
                        checked={picker.checked.has(candidate.id)}
                        onChange={() => { togglePicker(candidate.id) }}
                      />
                      <span className="dsh-ig-candidateId">{candidate.id}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )
        ) : null}
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ComfyUI workflow editor (separate row card, same visual vocabulary).
// ---------------------------------------------------------------------------

interface ComfyUIEditorProps {
  t: (k: DictKey, p?: Record<string, string>) => string
  baseURL: string
  onBaseURLChange: (next: string) => void
  workflows: ComfyUIWorkflowEntry[]
  onWorkflowsChange: (next: ComfyUIWorkflowEntry[]) => void
  activeName: string
  onActiveChange: (next: string) => void
  timeoutSeconds: number
  onTimeoutChange: (next: number) => void
  open: boolean
  onOpen: () => void
  onClose: () => void
  onSave: () => Promise<void>
}

function ComfyUIEditor(props: ComfyUIEditorProps): ReactNode {
  const { t, baseURL, onBaseURLChange, workflows, onWorkflowsChange, activeName, onActiveChange, timeoutSeconds, onTimeoutChange, open, onOpen, onClose, onSave } = props
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [comfyAdvanced, setComfyAdvanced] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const importWorkflow = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    setFailure(undefined)
    try {
      if (file.size > MAX_COMFYUI_WORKFLOW_BYTES) throw new Error(t('workflowTooLarge'))
      const json = await file.text()
      validateComfyUIWorkflowJson(json)
      const name = uniqueComfyUIWorkflowName(file.name, workflows.map(entry => entry.name))
      const next = [...workflows, { name, json }]
      onWorkflowsChange(next)
      if (activeName === '') onActiveChange(name)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const apply = async (): Promise<void> => {
    setBusy(true); setFailure(undefined)
    try {
      await onSave()
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <ul className="dsh-ig-rows">
        <li className="dsh-ig-rowCard">
          <div className="dsh-ig-rowHead">
            <span className="dsh-ig-rowIdentity">
              <span className="dsh-ig-rowName">{t('providerComfyUI')}</span>
              <span className="dsh-ig-rowTag">{workflows.length}</span>
            </span>
            <span className="dsh-ig-rowActions">
              <button type="button" className="dsh-ig-secondaryButton" onClick={onOpen}>{t('edit')}</button>
            </span>
          </div>
        </li>
      </ul>
    )
  }

  return (
    <ul className="dsh-ig-rows">
      <li className="dsh-ig-rowCard">
        <div className="dsh-ig-rowHead">
          <span className="dsh-ig-rowIdentity">
            <span className="dsh-ig-rowName">{t('providerComfyUI')}</span>
            <span className="dsh-ig-rowTag">{workflows.length}</span>
          </span>
          <span className="dsh-ig-rowActions">
            <button type="button" className="dsh-ig-secondaryButton" onClick={onClose}>{t('cancel')}</button>
            <button type="button" className="dsh-ig-primaryButton" disabled={busy} onClick={() => { void apply() }}>
              {busy ? t('applying') : t('apply')}
            </button>
          </span>
        </div>
        <div className="dsh-ig-editor">
          <div className="dsh-ig-field">
            <span className="dsh-ig-fieldLabel">{t('baseUrl')}</span>
            <div className="dsh-ig-endpointGroup">
              <input className="dsh-ig-input" type="url" value={baseURL} onChange={event => { onBaseURLChange(event.target.value) }} aria-label={t('baseUrl')} />
              <button type="button" className="dsh-ig-secondaryButton dsh-ig-endpointReset" title={t('resetTitle')} onClick={() => { onBaseURLChange(DEFAULT_COMFYUI_BASE_URL) }}>{t('reset')}</button>
            </div>
            <span className="dsh-ig-advancedHint">{t('endpointHintComfyUI')}</span>
          </div>
          <div className="dsh-ig-field">
            <span className="dsh-ig-fieldLabel">{t('workflow')}</span>
            <div className="dsh-ig-fileRow">
              <button type="button" className="dsh-ig-secondaryButton" onClick={() => { fileInputRef.current?.click() }}>{t('workflowImport')}</button>
              <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={event => { void importWorkflow(event) }} />
              {workflows.length === 0 ? <span className="dsh-ig-fileName">{t('workflowMissing')}</span> : null}
            </div>
            {workflows.length > 0 ? (
              <ul className="dsh-ig-workflowList">
                {workflows.map((entry, index) => (
                  <li key={`${String(index)}-${entry.name}`} className="dsh-ig-workflowRow">
                    <label className="dsh-ig-workflowActive" title={t('workflowActiveTitle')}>
                      <input
                        type="radio"
                        name="dsh-ig-active-workflow"
                        aria-label={t('workflowActiveTitle')}
                        checked={entry.name === activeName}
                        onChange={() => { onActiveChange(entry.name) }}
                      />
                    </label>
                    <input
                      className="dsh-ig-input"
                      value={entry.name}
                      onChange={event => {
                        const next = [...workflows]
                        next[index] = { ...entry, name: event.target.value }
                        onWorkflowsChange(next)
                        if (entry.name === activeName) onActiveChange(event.target.value)
                      }}
                    />
                    <button
                      type="button"
                      className="dsh-ig-iconButton dsh-ig-iconButtonDanger"
                      aria-label={t('workflowRemove')}
                      title={t('workflowRemove')}
                      onClick={() => {
                        const next = workflows.filter((_, at) => at !== index)
                        onWorkflowsChange(next)
                        if (entry.name === activeName) onActiveChange(next[0]?.name ?? '')
                      }}
                    >
                      <IconTrash />
                    </button>
                    <input
                      className="dsh-ig-input dsh-ig-workflowPreset"
                      value={entry.presetPrompt ?? ''}
                      placeholder={t('workflowPresetPlaceholder')}
                      title={t('workflowPresetTitle')}
                      onChange={event => {
                        const next = [...workflows]
                        next[index] = { ...entry, presetPrompt: event.target.value }
                        onWorkflowsChange(next)
                      }}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            <span className="dsh-ig-advancedHint">{t('workflowHint')}</span>
          </div>
          <button type="button" className="dsh-ig-customizedSummary" onClick={() => { setComfyAdvanced(value => !value) }} aria-expanded={comfyAdvanced}>
            {t('customized')}
          </button>
          {comfyAdvanced ? (
            <div className="dsh-ig-customizedBody">
              <div className="dsh-ig-field">
                <span className="dsh-ig-fieldLabel">{t('timeout')}</span>
                <input
                  className="dsh-ig-input"
                  type="number"
                  min={1}
                  max={3600}
                  step={1}
                  value={timeoutSeconds}
                  onChange={event => { onTimeoutChange(Number(event.target.value)) }}
                  aria-label={t('timeout')}
                />
                <span className="dsh-ig-advancedHint">{t('timeoutHint')}</span>
              </div>
            </div>
          ) : null}
          {failure !== undefined ? <p className="dsh-ig-error">{failure}</p> : null}
        </div>
      </li>
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Workspace section.
// ---------------------------------------------------------------------------

interface WorkspaceSectionProps {
  t: (k: DictKey, p?: Record<string, string>) => string
  saveToWorkspace: boolean
  onToggleSave: (next: boolean) => void
  workspaceFolder: string
  onFolderChange: (next: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  saving: boolean
  message: string
  writable: boolean
}

function WorkspaceSection(props: WorkspaceSectionProps): ReactNode {
  const { t, saveToWorkspace, onToggleSave, workspaceFolder, onFolderChange, onSubmit, saving, message, writable } = props
  return (
    <form className="dsh-ig-workspace" onSubmit={onSubmit}>
      <h2 className="dsh-ig-title">{t('workspaceTitle')}</h2>
      <p className="dsh-ig-intro">{t('workspaceIntro')}</p>
      <div className="dsh-ig-workspaceBody">
        <label className="dsh-ig-checkRow">
          <input
            type="checkbox"
            checked={saveToWorkspace}
            onChange={event => { onToggleSave(event.target.checked) }}
          />
          <span className="dsh-ig-fieldLabel">{t('saveToWorkspace')}</span>
        </label>
        <span className="dsh-ig-advancedHint">{t('saveToWorkspaceHint')}</span>
        {saveToWorkspace ? (
          <div className="dsh-ig-field">
            <span className="dsh-ig-fieldLabel">{t('folder')}</span>
            <input
              className="dsh-ig-input"
              value={workspaceFolder}
              onChange={event => { onFolderChange(event.target.value) }}
              placeholder={DEFAULT_WORKSPACE_FOLDER}
            />
            <span className="dsh-ig-advancedHint">{t('folderHint')}</span>
          </div>
        ) : null}
        <div className="dsh-ig-workspaceActions">
          <p className={`dsh-ig-workspaceMessage${message.startsWith(t('failure').slice(0, 4)) ? ' dsh-ig-error' : ''}`} role="status">{message}</p>
          <button type="submit" className="dsh-ig-primaryButton" disabled={saving || !writable}>
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Conversation-header image-model picker (the only entry for setting the
// default channel + model — the settings card intentionally omits it).
// Writes through `scope.set('defaultChannelId' | 'defaultModel')`.
// ---------------------------------------------------------------------------

export interface ImageModelPickerProps {
  scope: SettingsScope<ImageSettings>
  locale?: LocaleService | undefined
}

export function ImageModelPicker(props: ImageModelPickerProps): ReactNode {
  const [snapshot, setSnapshot] = useState<SettingsScopeSnapshot<ImageSettings>>(() => props.scope.getSnapshot())
  const [open, setOpen] = useState(false)
  useEffect(() => props.scope.subscribe(() => { setSnapshot(props.scope.getSnapshot()) }), [props.scope])
  const lang: 'zh' | 'en' = props.locale?.getSnapshot?.()?.active?.startsWith('en') ? 'en' : 'zh'
  const dict = lang === 'en' ? DICT.en : DICT.zh

  const drafts = channelsFromSettings(snapshot.value).filter(channel => channel.models.length > 0)
  if (drafts.length === 0) return null

  const recordedChannel = snapshot.value?.defaultChannelId ?? ''
  const recordedModel = snapshot.value?.defaultModel ?? ''
  const firstChannel = drafts[0]
  if (firstChannel === undefined) return null
  const activeChannel = drafts.find(channel => channel.id === recordedChannel) ?? firstChannel
  const firstModel = activeChannel.models[0]
  if (firstModel === undefined) return null
  const activeModel = activeChannel.models.includes(recordedModel) ? recordedModel : firstModel

  return (
    <div className="dsh-ig-hmodel">
      <button type="button" className="dsh-ig-hmodel-trigger" title={dict.hmodelTitle} onClick={() => { setOpen(value => !value) }}>
        <span className="dsh-ig-hmodel-triggerLabel">{dict.hmodelLabel}: {activeModel}</span>
        <svg className={`dsh-ig-hmodel-chevron${open ? ' dsh-ig-hmodel-chevronOpen' : ''}`} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4"/></svg>
      </button>
      {open ? (
        <>
          <div className="dsh-ig-hmodel-backdrop" onClick={() => { setOpen(false) }} />
          <div className="dsh-ig-hmodel-menu">
            <div className="dsh-ig-hmodel-groups">
              {drafts.map(channel => (
                <div className="dsh-ig-hmodel-group" key={channel.id}>
                  <div className="dsh-ig-hmodel-groupTitle">{channelDisplayName(channel.provider, (k) => (dict[k] ?? DICT.zh[k] ?? k) as string)}</div>
                  {channel.models.map(model => {
                    const active = channel.id === activeChannel.id && model === activeModel
                    return (
                      <button type="button" key={model} className={`dsh-ig-hmodel-option${active ? ' dsh-ig-hmodel-option-active' : ''}`} onClick={() => {
                        void props.scope.set('defaultChannelId', channel.id)
                        void props.scope.set('defaultModel', model)
                        setOpen(false)
                      }}>
                        <span className="dsh-ig-hmodel-optionCopy"><span className="dsh-ig-hmodel-modelName">{model}</span></span>
                        <span className="dsh-ig-hmodel-check">{active ? '✓' : ''}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
