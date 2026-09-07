import { useEffect, useState, useRef, type ChangeEvent, type FormEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
export interface SettingsScopeSnapshot<T> {
  value: T | undefined
  writable: boolean
}
export interface SettingsScope<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
}
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import {
  CLOUD_IMAGE_PROVIDERS,
  DEFAULT_BASE_URLS,
  DEFAULT_COMFYUI_TIMEOUT_MS,
  DEFAULT_COMFYUI_BASE_URL,
  DEFAULT_MODELS,
  IMAGE_GENERATION_NAMESPACE,
  IMAGE_PROVIDERS,
  IMAGE_ROUTE,
  MAX_COMFYUI_WORKFLOW_BYTES,
  MODELS_ROUTE,
  STUDIO_ROUTE,
  activeComfyUIWorkflow,
  resolveComfyUIWorkflows,
  uniqueComfyUIWorkflowName,
  type ComfyUIWorkflowEntry,
  type ImageProvider,
  type StudioGenerateResponse,
} from '../shared.js'
import { validateComfyUIWorkflowJson } from '../comfyui-workflow.js'
import { saveGalleryItem } from './gallery-store.js'
import { GalleryViewTab, copyImageBlob, type LocaleService } from './gallery-view.js'
import { fetchAttachmentBlob } from './image-cache.js'
import { imageRef, type ToolCallBlock } from './image-ref.js'
import { STUDIO_STYLE } from './studio-style.js'
import { INSPIRATION_STYLE } from './inspiration-style.js'
import {
  IMAGE_RESULT_NODE_KIND,
  createImageResultDefinition,
  type ImageResultPresentation,
} from './image-result-node.js'
import {
  appendConversationImageRevision,
  loadConversationImageRevisionChain,
  selectConversationImageRevision,
  type ConversationImageRevision,
  type ConversationImageRevisionChain,
} from './conversation-image-revisions.js'
import { conversationRegenerateRequest } from './conversation-regenerate.js'

type Provider = ImageProvider
interface ImageSettings {
  provider?: Provider
  channels?: Array<{ id?: unknown; provider?: unknown; baseURL?: unknown; apiKeyEnv?: unknown; models?: unknown }>
  googleModel?: string
  googleEndpoint?: string
  openaiBaseURL?: string
  openaiModel?: string
  seedreamBaseURL?: string
  seedreamModel?: string
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
  googleModels?: string[]
  openaiModels?: string[]
  seedreamModels?: string[]
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
type LegacyCredentialRpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message?: string } }
interface LegacyCredentialsApi {
  describe(request: { refs: string[] }): Promise<{
    result: LegacyCredentialRpcResult<{ credentials: Readonly<Record<string, CredentialInfo>> }>
  }>
  set(request: { ref: string; value: string }): Promise<{
    result: LegacyCredentialRpcResult<unknown>
  }>
}
interface SettingsFace { scope: SettingsScope<ImageSettings>; credentials: CredentialsRemote; locale?: LocaleService | undefined }
interface ImageCardFace { locale?: LocaleService | undefined; promoted: boolean }
type SettingsCardProps = PropsRuntime<'settings.section'> & InjectFace<SettingsFace>
type ImageCardProps = PropsRuntime<'tool.call.toolview'> & InjectFace<ImageCardFace>
interface ImageResultNodeProps {
  node: { data: { results: readonly ImageResultPresentation[] } }
  locale?: LocaleService | undefined
}
interface ModernUiConversation {
  events: { register(definition: ReturnType<typeof createImageResultDefinition>): () => void }
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

const DICT = {
  zh: {
    title: '图像生成',
    description: '选择厂商并配置生图模型。',
    provider: 'Provider',
    providerGoogle: 'Google Gemini',
    providerOpenAI: 'OpenAI / 中转站',
    providerSeedream: '字节 Seedream',
    providerDashScope: '阿里 DashScope (通义万相 / Qwen)',
    providerGitee: 'Gitee AI',
    providerModelScope: 'ModelScope (魔搭社区)',
    providerAntigravity: 'Antigravity (Gemini 反代)',
    providerComfyUI: '本地 ComfyUI',
    apiKeyLabel: '{provider} API Key',
    apiKeyPlaceholder: '留空即可保留已配置的 Key',
    apiKeyHint: '安全保存为 {key}；页面不会读回明文。',
    endpoint: '接口地址',
    reset: '重置',
    resetTitle: '重置为默认官方地址',
    endpointHintGoogle: 'Google 官方地址或反代端点（全路径）。',
    endpointHintOpenAI: '中转站请填其 OpenAI 兼容的 /v1 地址。',
    endpointHintSeedream: '火山方舟兼容的 /api/v3 地址。',
    endpointHintDashScope: '阿里云百炼 DashScope 官方接口地址。',
    endpointHintComfyUI: '正在运行且 DSH Host 可以访问的 ComfyUI 地址，默认使用本机 8188 端口。',
    model: '模型',
    modelsList: '模型列表（Agent 可选）',
    modelsFetch: '获取模型列表',
    modelsFetching: '获取中…',
    modelsCustomPlaceholder: '自定义模型 ID',
    modelsAdd: '添加',
    modelsListEmpty: '列表为空：该渠道将无法参与生图。',
    modelsListHint: '点击"获取模型列表"在弹窗中勾选并确认，或手动添加；单选钮选定默认模型——用户不指定时，生图固定走它。',
    modelsDefaultTitle: '设为默认模型（不指定渠道和模型时使用）',
    modelsPickerTitle: '选择模型',
    modelsPickerHint: '勾选要启用的模型，确认后加入列表；再次获取可调整。',
    confirm: '确认',
    addChannel: '添加渠道',
    channelDelete: '删除此渠道',
    channelModels: '{count} 个模型',
    channelNoEndpoint: '未填写接口地址',
    keyRefMissing: '该渠道缺少凭据引用名（apiKeyEnv）',
    modelsNotLikelyImage: '该模型 ID 不像图像模型（仍可勾选）',
    hmodelLabel: '图像',
    hmodelTitle: '图像模型：点击切换生图默认模型',
    workflow: 'API Workflow 工作流',
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
    saveToWorkspace: '保存到工作区',
    saveToWorkspaceHint: '每次生成后，把图片文件保存到当前会话工作区。',
    folder: '工作区文件夹',
    folderHint: '相对当前会话工作区的子目录；留空表示工作区根目录。',
    saving: '保存中…',
    save: '保存',
    saved: '已保存',
    savedToPath: '已保存到',
    checkingKey: '正在检查 API Key…',
    keyConfigured: '已配置 API Key',
    keyNotConfigured: '尚未配置 API Key',
    generating: '正在生成图片…',
    loading: '正在加载图片…',
    loadFailed: '图片读取失败 ({status})',
    generatedTitle: '已生成图片',
    resultShown: '图片结果已显示在对话中',
    copyImg: '复制图片',
    download: '下载图片',
    openNewTab: '新标签页打开',
    copiedImage: '已复制图片',
    copyFailed: '复制失败',
    regenerate: '重新生成',
    regenerateTitle: '重新生成图片',
    regenerateHint: '如有需要可微调提示词。生成的新图片将替代当前展示，原图依然可在版本中查看。',
    prompt: '提示词',
    cancel: '取消',
    confirmRegenerate: '确认生成',
    regenerating: '重新生成中…',
    regenerateFailed: '重新生成失败',
    versionPrevious: '上一版本',
    versionNext: '下一版本',
    versionLabel: '图片版本 {current}/{total}',
  },
  en: {
    title: 'Image Generation',
    description: 'Select provider and configure image generation models.',
    provider: 'Provider',
    providerGoogle: 'Google Gemini',
    providerOpenAI: 'OpenAI / Relay',
    providerSeedream: 'ByteDance Seedream',
    providerDashScope: 'Aliyun DashScope (Wanx / Qwen)',
    providerGitee: 'Gitee AI',
    providerModelScope: 'ModelScope',
    providerAntigravity: 'Antigravity (Gemini proxy)',
    providerComfyUI: 'Local ComfyUI',
    apiKeyLabel: '{provider} API Key',
    apiKeyPlaceholder: 'Leave empty to keep configured key',
    apiKeyHint: 'Securely saved as {key}; never read back in plaintext.',
    endpoint: 'Endpoint / Base URL',
    reset: 'Reset',
    resetTitle: 'Reset to official default URL',
    endpointHintGoogle: 'Official Google endpoint or reverse proxy (full path).',
    endpointHintOpenAI: 'OpenAI-compatible /v1 base URL for relays.',
    endpointHintSeedream: 'Volcengine Ark compatible /api/v3 base URL.',
    endpointHintDashScope: 'Official Aliyun DashScope endpoint.',
    endpointHintComfyUI: 'A running ComfyUI server reachable by the DSH Host; the default points to port 8188 on this computer.',
    model: 'Model',
    modelsList: 'Model list (agent-selectable)',
    modelsFetch: 'Fetch models',
    modelsFetching: 'Fetching…',
    modelsCustomPlaceholder: 'Custom model id',
    modelsAdd: 'Add',
    modelsListEmpty: 'Empty: this channel cannot serve generation.',
    modelsListHint: 'Click "Fetch models", check entries in the dialog and confirm — or add custom ids by hand. The radio picks the default model: unnamed requests always use it.',
    modelsDefaultTitle: 'Set as the default model (used when the request names none)',
    modelsPickerTitle: 'Select models',
    modelsPickerHint: 'Check the models to enable and confirm; fetch again to adjust.',
    confirm: 'Confirm',
    addChannel: 'Add channel',
    channelDelete: 'Delete channel',
    channelModels: '{count} models',
    channelNoEndpoint: 'No endpoint set',
    keyRefMissing: 'This channel has no credential reference (apiKeyEnv)',
    modelsNotLikelyImage: 'This id does not look like an image model (you can still check it)',
    hmodelLabel: 'Image',
    hmodelTitle: 'Image model: click to switch the generation default',
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
    saveToWorkspace: 'Save to workspace',
    saveToWorkspaceHint: 'Write each generated image as a file into the session workspace.',
    folder: 'Workspace folder',
    folderHint: 'Subdirectory of the session workspace; empty means the workspace root.',
    saving: 'Saving…',
    save: 'Save',
    saved: 'Saved',
    savedToPath: 'Saved to',
    checkingKey: 'Checking API Key…',
    keyConfigured: 'API Key configured',
    keyNotConfigured: 'API Key not configured',
    generating: 'Generating image…',
    loading: 'Loading image…',
    loadFailed: 'Failed to load image ({status})',
    generatedTitle: 'Generated image',
    resultShown: 'Image result is shown in the conversation',
    copyImg: 'Copy Image',
    download: 'Download Image',
    openNewTab: 'Open in new tab',
    copiedImage: 'Image copied',
    copyFailed: 'Copy failed',
    regenerate: 'Regenerate',
    regenerateTitle: 'Regenerate image',
    regenerateHint: 'Edit the prompt if needed. The new image replaces this view while the original remains available.',
    prompt: 'Prompt',
    cancel: 'Cancel',
    confirmRegenerate: 'Regenerate',
    regenerating: 'Regenerating…',
    regenerateFailed: 'Regeneration failed',
    versionPrevious: 'Previous version',
    versionNext: 'Next version',
    versionLabel: 'Image version {current}/{total}',
  },
} as const

type DictKey = keyof typeof DICT.zh

const STYLE = `
.dsh-ig-card{list-style:none;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);transition:border-color .16s,background .16s;overflow:hidden}
.dsh-ig-card:hover{border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-ig-card-open{background:var(--dsw-alias-bg-layer-2,#fff);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-ig-head{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-radius:12px}
.dsh-ig-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:-2px}
.dsh-ig-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-ig-title{display:block;font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,inherit)}
.dsh-ig-desc{display:block;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#7b818b)}
.dsh-ig-chevron{flex:none;color:var(--dsw-alias-label-tertiary,#7b818b);transition:transform .16s;display:inline-flex;align-items:center}
.dsh-ig-chevron-open{transform:rotate(180deg)}
.dsh-ig-body{border-top:1px solid var(--dsw-alias-border-l2,#eee);padding:0 16px 16px}
.dsh-ig-field{display:grid;gap:6px;margin-top:14px}
.dsh-ig-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,inherit)}
.dsh-ig-input{box-sizing:border-box;width:100%;padding:8px 12px;font-size:13px;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:8px;background:var(--dsw-alias-bg-layer-3,transparent);color:inherit;outline:none;transition:border-color .15s}
.dsh-ig-input:focus{border-color:var(--dsw-alias-brand-primary,#4c78ff)}
.dsh-ig-input-group{display:flex;gap:8px;align-items:center}
.dsh-ig-file-row{display:flex;align-items:center;gap:10px;min-width:0}
.dsh-ig-file-input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;clip-path:inset(50%)}
.dsh-ig-file-button{appearance:none;flex:none;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:8px;padding:7px 12px;background:var(--dsw-alias-bg-layer-3,#f9fafb);color:var(--dsw-alias-label-secondary,inherit);font-size:13px;cursor:pointer;transition:background .15s,border-color .15s}
.dsh-ig-file-button:hover{background:var(--dsw-alias-bg-layer-2,#edf0f3);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-ig-file-button:focus-within{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:2px}
.dsh-ig-file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,inherit);font-size:12px}
.dsh-ig-workflow-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.dsh-ig-workflow-row{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--dsw-alias-border-l2,#eee);border-radius:8px}
.dsh-ig-workflow-main{display:flex;align-items:center;gap:8px}
.dsh-ig-workflow-active{display:inline-flex;align-items:center;cursor:pointer;flex:none}
.dsh-ig-workflow-active input[type=radio]{width:15px;height:15px;accent-color:var(--dsw-alias-brand-primary,#4c78ff);margin:0;cursor:pointer}
.dsh-ig-workflow-name{flex:1;min-width:0}
.dsh-ig-btn-reset{appearance:none;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:8px;padding:7px 12px;background:var(--dsw-alias-bg-layer-3,#f9fafb);color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s}
.dsh-ig-btn-reset:hover{background:var(--dsw-alias-bg-layer-2,#edf0f3);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-ig-hint,.dsh-ig-status{margin:0;color:var(--dsw-alias-label-tertiary,#7b818b);font-size:12px;line-height:1.4}
.dsh-ig-status-error{color:var(--dsw-alias-label-error,#d33);font-weight:500}
.dsh-ig-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2,#eee)}
.dsh-ig-check-row{display:flex;align-items:center;gap:8px;cursor:pointer}
.dsh-ig-check-row input[type=checkbox]{width:15px;height:15px;accent-color:var(--dsw-alias-brand-primary,#4c78ff);margin:0}
.dsh-ig-savedto{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#7b818b);word-break:break-all}
.dsh-ig-save{appearance:none;border:0;border-radius:8px;padding:6px 16px;background:var(--dsw-alias-label-primary,#111827);color:var(--dsw-alias-bg-layer-3,#fff);font:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:opacity .15s}
.dsh-ig-save:disabled{opacity:.4;cursor:default}

.dsh-ig-result{display:grid;gap:10px;max-width:520px}
.dsh-ig-promoted-results{display:grid;gap:16px}
.dsh-ig-result-title{font-size:14px;font-weight:600}
.dsh-ig-container{position:relative;display:inline-block;width:fit-content;max-width:100%;justify-self:start;border-radius:12px;overflow:hidden;line-height:0;isolation:isolate}
.dsh-ig-container:hover .dsh-ig-toolbar,.dsh-ig-container:focus-within .dsh-ig-toolbar{opacity:1;pointer-events:auto}
.dsh-ig-toolbar{position:absolute;top:8px;left:8px;display:flex;align-items:center;gap:5px;padding:3px 5px;border-radius:8px;background:rgba(0,0,0,0.65);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:2;line-height:1}
.dsh-ig-tool-btn{appearance:none;border:0;background:transparent;color:#fff;padding:5px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .15s,color .15s}
.dsh-ig-tool-btn:hover{background:rgba(255,255,255,0.25)}
.dsh-ig-tool-btn-danger:hover{background:rgba(239,68,68,0.75)!important;color:#fff!important}
.dsh-ig-toast{position:absolute;top:100%;left:0;margin-top:5px;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,0.85);color:#fff;font-size:11px;white-space:nowrap;pointer-events:none;z-index:4}
.dsh-ig-image{display:block;max-width:100%;max-height:520px;border-radius:12px;background:#f2f3f5;cursor:pointer}
.dsh-ig-version-nav{position:absolute;right:8px;bottom:8px;display:flex;align-items:center;gap:2px;padding:3px;border-radius:999px;background:rgba(15,23,42,.72);color:#fff;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font-size:11px;line-height:1;z-index:2}
.dsh-ig-version-nav button{appearance:none;border:0;background:transparent;color:inherit;width:25px;height:25px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:17px;line-height:1}
.dsh-ig-version-nav button:hover:not(:disabled){background:rgba(255,255,255,.2)}
.dsh-ig-version-nav button:disabled{opacity:.3;cursor:default}
.dsh-ig-version-count{min-width:34px;text-align:center;font-variant-numeric:tabular-nums}
.dsh-ig-regenerate-overlay{position:absolute;inset:0;background:rgba(15,23,42,0.52);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#fff;z-index:3;animation:dsh-ig-fade .18s ease-out;line-height:1.4;border-radius:12px}
.dsh-ig-regenerate-spinner{width:28px;height:28px;border:3px solid rgba(255,255,255,0.25);border-top-color:#fff;border-radius:50%;animation:dsh-ig-spin .8s linear infinite}
.dsh-ig-regenerate-overlay-text{font-size:12.5px;font-weight:550;color:#fff;letter-spacing:0.2px;text-shadow:0 1px 2px rgba(0,0,0,0.4)}
.dsh-ig-regenerate-overlay-cancel{appearance:none;border:1px solid rgba(255,255,255,0.4);border-radius:6px;background:rgba(255,255,255,0.15);color:#fff;padding:3px 12px;font-size:11.5px;cursor:pointer;transition:background .15s}
.dsh-ig-regenerate-overlay-cancel:hover{background:rgba(255,255,255,0.3)}
@keyframes dsh-ig-spin{to{transform:rotate(360deg)}}
.dsh-ig-regenerate-backdrop{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(11,17,29,.6);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);animation:dsh-ig-fade .15s ease-out}
.dsh-ig-regenerate-dialog{width:min(520px,100%);border:1px solid var(--dsw-alias-border-l2,#dfe3ea);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#172033);box-shadow:0 24px 72px rgba(11,17,29,.28);padding:20px;box-sizing:border-box;line-height:1.4}
.dsh-ig-regenerate-dialog h3{margin:0;font-size:16px;font-weight:650}
.dsh-ig-regenerate-dialog p{margin:7px 0 16px;color:var(--dsw-alias-label-tertiary,#737d8f);font-size:12.5px;line-height:1.55}
.dsh-ig-regenerate-dialog label{display:grid;gap:7px;font-size:12.5px;font-weight:600}
.dsh-ig-regenerate-dialog textarea{box-sizing:border-box;width:100%;min-height:132px;resize:vertical;border:1px solid var(--dsw-alias-border-l2,#d7dce5);border-radius:9px;padding:11px 12px;background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;font:inherit;font-size:13px;line-height:1.55;outline:none}
.dsh-ig-regenerate-dialog textarea:focus{border-color:var(--dsw-alias-brand-primary,#4c78ff);box-shadow:0 0 0 3px rgba(76,120,255,.12)}
.dsh-ig-regenerate-error{margin-top:10px!important;color:var(--dsw-alias-label-error,#d33)!important}
.dsh-ig-regenerate-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:16px}
.dsh-ig-regenerate-actions button{height:35px;padding:0 14px;border-radius:7px;font:inherit;font-size:13px;font-weight:550;cursor:pointer}
.dsh-ig-regenerate-cancel{border:1px solid var(--dsw-alias-border-l2,#d7dce5);background:transparent;color:inherit}
.dsh-ig-regenerate-confirm{border:1px solid var(--dsw-alias-brand-primary,#3569ed);background:var(--dsw-alias-brand-primary,#3569ed);color:#fff}
.dsh-ig-regenerate-actions button:disabled{opacity:.5;cursor:default}
@media(hover:none){.dsh-ig-container .dsh-ig-toolbar{opacity:1;pointer-events:auto}}
@keyframes dsh-ig-fade{from{opacity:0}to{opacity:1}}
.dsh-ig-page{display:grid;gap:10px}
.dsh-ig-channel{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#fff);overflow:hidden}
.dsh-ig-channel-open{border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-ig-channel-head{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:10px;padding:10px 12px}
.dsh-ig-channel-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:-2px}
.dsh-ig-channel-title{font-size:13.5px;font-weight:600;flex:none}
.dsh-ig-channel-meta{flex:1;min-width:0;text-align:right;font-size:12px;color:var(--dsw-alias-label-tertiary,#7b818b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ig-channel-body{border-top:1px solid var(--dsw-alias-border-l2,#eee);padding:12px;display:grid;gap:10px}
.dsh-ig-picker-list{list-style:none;margin:0 0 4px;padding:0;max-height:300px;overflow:auto;display:grid;gap:2px}
.dsh-ig-picker-list label{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;font-size:13px;font-weight:400;cursor:pointer}
.dsh-ig-picker-list label:hover{background:var(--dsw-alias-bg-layer-3,#f3f4f6)}
.dsh-ig-picker-list span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ig-hmodel{position:relative;min-width:0}
.dsh-ig-hmodel-trigger{min-width:0;max-width:min(360px,100vw - 32px);height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:24px;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:flex}
.dsh-ig-hmodel-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ig-hmodel-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dsh-ig-hmodel-triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.dsh-ig-hmodel-chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}
.dsh-ig-hmodel-chevronOpen{transform:rotate(180deg)}
.dsh-ig-hmodel-menu{z-index:20;background:var(--dsw-specific-menu);width:max-content;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);border:0;border-radius:20px;flex-direction:column;padding:4px;display:flex;position:absolute;bottom:calc(100% + 8px);right:0;overflow:hidden}
.dsh-ig-hmodel-groups{min-height:0;overflow-y:auto}
.dsh-ig-hmodel-group+.dsh-ig-hmodel-group{margin-top:4px}
.dsh-ig-hmodel-groupTitle{position:sticky;top:0;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-tertiary);padding:5px 8px 3px;font-size:12px;font-weight:500;line-height:18px}
.dsh-ig-hmodel-option{box-sizing:border-box;min-width:100%;min-height:38px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:10px;outline:none;align-items:center;gap:8px;padding:6px 8px;display:flex}
.dsh-ig-hmodel-option:hover,.dsh-ig-hmodel-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ig-hmodel-optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}
.dsh-ig-hmodel-modelName{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}
.dsh-ig-hmodel-check{color:var(--dsw-alias-label-primary);flex:0 0 18px;display:grid;place-items:center}
.dsh-ig-hmodel-backdrop{position:fixed;inset:0;z-index:19}
.dsh-ig-error{color:var(--dsw-alias-label-error,#d33);font-size:13px}
.dsh-ig-loading{color:var(--dsw-alias-label-tertiary,#7b818b);font-size:13px}

/* Native Workspace Gallery & Studio View (Renders seamlessly inside DSH Session View) */
.dsh-ig-gallery-page{width:100%;height:100%;background:var(--dsw-alias-bg-layer-1,#ffffff);display:flex;flex-direction:column;overflow:hidden;flex:1}

/* 1. Top Navigation Tab Bar */
.dsh-ig-studio-tabs-bar{display:flex;align-items:center;gap:6px;padding:6px 24px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#ffffff);flex-shrink:0}
.dsh-ig-studio-tab-btn{appearance:none;-webkit-appearance:none;border:0;background:transparent;display:inline-flex;align-items:center;gap:7px;padding:7px 14px;font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary,#64748b);cursor:pointer;border-radius:6px;transition:color .15s ease,background-color .15s ease}
.dsh-ig-studio-tab-btn:hover{color:var(--dsw-alias-label-primary,#0f172a);background:var(--dsw-alias-bg-layer-2,#f1f5f9)}
.dsh-ig-studio-tab-btn.is-active{color:var(--dsw-alias-brand-primary,#2563eb);font-weight:600;background:rgba(37,99,235,0.08)}

/* 2. Secondary Filter & Search Toolbar */
.dsh-ig-studio-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 24px;background:var(--dsw-alias-bg-layer-1,#ffffff);border-bottom:1px solid var(--dsw-alias-border-l2,#f1f5f9);flex-shrink:0;flex-wrap:wrap}
.dsh-ig-studio-toolbar-left{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:1;min-width:0}
.dsh-ig-studio-toolbar-right{display:flex;align-items:center;gap:10px;flex-shrink:0}

/* Modern Custom Select (Removes OS default arrows & ugly borders) */
.dsh-ig-studio-select{appearance:none;-webkit-appearance:none;-moz-appearance:none;height:32px;line-height:30px;padding:0 28px 0 12px;font-size:12.5px;color:var(--dsw-alias-label-primary,#334155);background-color:var(--dsw-alias-bg-layer-2,#ffffff);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 9px center;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:6px;outline:none;cursor:pointer;box-sizing:border-box;transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease}
.dsh-ig-studio-select:hover{border-color:var(--dsw-alias-border-l1,#cbd5e1);background-color:var(--dsw-alias-bg-layer-1,#f8fafc)}
.dsh-ig-studio-select:focus{border-color:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:0 0 0 2px rgba(59,130,246,0.15)}
.dsh-ig-studio-select-sort{font-weight:500}

/* Unified Search Input */
.dsh-ig-studio-search-wrap{position:relative;display:flex;align-items:center;min-width:190px;max-width:320px;flex:1}
.dsh-ig-studio-search-icon{position:absolute;left:10px;color:var(--dsw-alias-label-tertiary,#94a3b8);pointer-events:none}
.dsh-ig-studio-search-input{width:100%;height:32px;line-height:30px;padding:0 12px 0 32px;font-size:12.5px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:6px;background-color:var(--dsw-alias-bg-layer-2,#ffffff);color:inherit;outline:none;box-sizing:border-box;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-ig-studio-search-input:hover{border-color:var(--dsw-alias-border-l1,#cbd5e1)}
.dsh-ig-studio-search-input:focus{border-color:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:0 0 0 2px rgba(59,130,246,0.15)}
.dsh-ig-studio-search-input::placeholder{color:var(--dsw-alias-label-tertiary,#94a3b8)}

/* 3. Grid & Responsive Cards */
.dsh-ig-gallery-page-body{flex:1;overflow-y:auto;padding:20px 24px}
.dsh-ig-gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px}
.dsh-ig-gallery-card{background:var(--dsw-alias-bg-layer-2,#ffffff);border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.dsh-ig-gallery-card:hover{transform:translateY(-2px);box-shadow:0 10px 20px -5px rgba(0,0,0,0.06),0 4px 6px -2px rgba(0,0,0,0.03);border-color:var(--dsw-alias-border-l1,#cbd5e1)}
.dsh-ig-gallery-card-media{position:relative;width:100%;aspect-ratio:1/1;background:#f1f5f9;overflow:hidden;display:flex;align-items:center;justify-content:center}
.dsh-ig-gallery-card-img{width:100%;height:100%;object-fit:cover;transition:transform .2s ease}
.dsh-ig-gallery-card:hover .dsh-ig-gallery-card-img{transform:scale(1.03)}
.dsh-ig-gallery-card-loading{font-size:12px;color:#94a3b8}
.dsh-ig-gallery-card-error{font-size:12px;color:#ef4444;padding:8px;text-align:center}

/* Floating Action Toolbar on Card Hover */
.dsh-ig-gallery-card:hover .dsh-ig-card-toolbar{opacity:1;pointer-events:auto}
.dsh-ig-card-toolbar{position:absolute;top:6px;left:6px;display:flex;align-items:center;gap:3px;padding:3px 5px;border-radius:6px;background:rgba(15,23,42,0.72);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:10;line-height:1}

/* Card Bottom Metadata */
.dsh-ig-gallery-card-meta{padding:10px 12px;display:flex;flex-direction:column;gap:5px;background:var(--dsw-alias-bg-layer-2,#ffffff);flex:1}
.dsh-ig-card-badge-row{display:flex;align-items:center}
.dsh-ig-card-badge{display:inline-block;padding:2px 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-3,#f1f5f9);color:var(--dsw-alias-label-secondary,#475569);font-size:11px;font-weight:500;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ig-gallery-card-prompt-line{font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-primary,#1e293b);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ig-card-footer-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px}
.dsh-ig-card-meta-text{font-size:11px;color:var(--dsw-alias-label-tertiary,#94a3b8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-ig-card-fav-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#94a3b8);padding:2px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:color .15s,transform .15s;flex-shrink:0}
.dsh-ig-card-fav-btn:hover{color:#ef4444;transform:scale(1.15)}
.dsh-ig-card-fav-btn.is-favorited{color:#ef4444}

/* Placeholders for Upcoming Routes */
.dsh-ig-placeholder-view{display:flex;align-items:center;justify-content:center;min-height:360px;height:100%;padding:24px}
.dsh-ig-placeholder-card{max-width:500px;width:100%;text-align:center;padding:36px 28px;background:var(--dsw-alias-bg-layer-2,#ffffff);border:1px dashed var(--dsw-alias-border-l2,#e2e8f0);border-radius:14px;display:flex;flex-direction:column;align-items:center;gap:12px}
.dsh-ig-placeholder-icon{font-size:40px;line-height:1}
.dsh-ig-placeholder-header{display:flex;align-items:center;gap:8px;justify-content:center}
.dsh-ig-placeholder-title{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary,inherit);margin:0}
.dsh-ig-placeholder-badge{font-size:11px;font-weight:500;background:rgba(37,99,235,0.1);color:#2563eb;padding:2px 8px;border-radius:12px}
.dsh-ig-placeholder-desc{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary,#64748b);margin:0}
.dsh-ig-placeholder-tip{margin-top:6px;padding:8px 12px;font-size:12px;background:var(--dsw-alias-bg-layer-3,#f8fafc);border-radius:8px;color:var(--dsw-alias-label-tertiary,#64748b);text-align:left}

/* Empty State */
.dsh-ig-gallery-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:360px;text-align:center;color:var(--dsw-alias-label-tertiary,#94a3b8)}
.dsh-ig-gallery-empty-icon{font-size:44px;margin-bottom:10px}
.dsh-ig-gallery-empty-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,inherit);margin-bottom:4px}
.dsh-ig-gallery-empty-desc{font-size:13px;max-width:360px;line-height:1.5}

/* Pure Centered Lightbox */
.dsh-ig-lightbox-backdrop{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.88);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;cursor:zoom-out;animation:dsh-ig-fade .15s ease-out}
.dsh-ig-lightbox-topbar{position:absolute;top:20px;left:24px;right:24px;display:flex;align-items:center;justify-content:space-between;z-index:10;pointer-events:none}
.dsh-ig-lightbox-meta{display:flex;align-items:center;gap:8px;pointer-events:auto}
.dsh-ig-tag{display:inline-block;padding:2px 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-3,#edf0f3);color:var(--dsw-alias-label-secondary,inherit);font-weight:500;text-transform:uppercase;font-size:10px}
.dsh-ig-tag-model{background:rgba(76,120,255,0.1);color:#4c78ff}
.dsh-ig-lightbox-close-btn{appearance:none;border:0;background:rgba(255,255,255,0.15);color:#fff;border-radius:50%;width:34px;height:34px;font-size:16px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .15s;pointer-events:auto}
.dsh-ig-lightbox-close-btn:hover{background:rgba(255,255,255,0.3)}
.dsh-ig-lightbox-img-wrap{max-width:86vw;max-height:78vh;display:flex;align-items:center;justify-content:center;cursor:default}
.dsh-ig-lightbox-img{max-width:100%;max-height:78vh;object-fit:contain;border-radius:8px;box-shadow:0 24px 60px rgba(0,0,0,0.7);user-select:none}
.dsh-ig-lightbox-bottombar{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);max-width:min(90vw,640px);background:rgba(20,22,26,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.15);border-radius:14px;padding:10px 16px;display:flex;flex-direction:column;gap:8px;color:#fff;box-shadow:0 16px 40px rgba(0,0,0,0.5);cursor:default}
.dsh-ig-lightbox-prompt-text{font-size:13px;line-height:1.4;color:rgba(255,255,255,0.92);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.dsh-ig-lightbox-counter{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,0.15);color:#fff;font-size:11.5px;font-weight:500;font-variant-numeric:tabular-nums}
.dsh-ig-lightbox-nav-btn{position:fixed;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.12);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:100;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:background-color .15s ease,transform .15s ease,opacity .15s ease;outline:none}
.dsh-ig-lightbox-nav-btn:hover:not(:disabled){background:rgba(255,255,255,0.28);transform:translateY(-50%) scale(1.08)}
.dsh-ig-lightbox-nav-btn:disabled{opacity:0.2;cursor:not-allowed;pointer-events:none}
.dsh-ig-lightbox-nav-prev{left:24px}
.dsh-ig-lightbox-nav-next{right:24px}
.dsh-ig-lightbox-loading{display:flex;align-items:center;justify-content:center;min-width:180px;min-height:180px}
.dsh-ig-lightbox-spinner{width:36px;height:36px;border:3px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:dsh-ig-spin .8s linear infinite}
@keyframes dsh-ig-spin{to{transform:rotate(360deg)}}
.dsh-ig-lightbox-btn{appearance:none;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#fff;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:background .15s,border-color .15s,color .15s}
.dsh-ig-lightbox-btn:hover{background:rgba(255,255,255,0.22)}
.dsh-ig-lightbox-btn-danger{border-color:rgba(239,68,68,0.4);color:#fca5a5}
.dsh-ig-lightbox-btn-danger:hover{background:rgba(239,68,68,0.35)!important;color:#fff!important;border-color:rgba(239,68,68,0.7)!important}
.dsh-ig-gallery-page-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:6px 14px;border-radius:8px;font-size:13px;z-index:99999;animation:dsh-ig-fade .15s}

/* Card selection and checkbox */
.dsh-ig-gallery-card.is-selected{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,#2563eb);border-color:transparent}
.dsh-ig-card-checkbox{position:absolute;top:8px;left:8px;width:22px;height:22px;border-radius:50%;border:1.5px solid rgba(255,255,255,0.7);background:rgba(0,0,0,0.35);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;z-index:5;opacity:0;transition:opacity .15s ease,background-color .15s ease,border-color .15s ease;padding:0;outline:none}
.dsh-ig-gallery-card:hover .dsh-ig-card-checkbox,.dsh-ig-gallery-card.is-manage-mode .dsh-ig-card-checkbox,.dsh-ig-card-checkbox.is-checked{opacity:1}
.dsh-ig-card-checkbox.is-checked{background:var(--dsw-alias-brand-primary,#2563eb);border-color:var(--dsw-alias-brand-primary,#2563eb)}

/* Studio button in toolbar */
.dsh-ig-studio-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;box-sizing:border-box;border-radius:6px;border:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,0.12));background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,inherit);font-size:12.5px;font-weight:500;cursor:pointer;transition:border-color .15s,background .15s,color .15s}
.dsh-ig-studio-btn:hover{background:var(--dsw-alias-bg-layer-3,#f3f4f6);border-color:var(--dsw-alias-border-default,rgba(0,0,0,0.2))}
.dsh-ig-studio-btn.is-active{background:var(--dsw-alias-brand-primary,#2563eb);border-color:var(--dsw-alias-brand-primary,#2563eb);color:#fff}
.dsh-ig-studio-btn-danger{color:#ef4444;border-color:rgba(239,68,68,0.35);background:rgba(239,68,68,0.06)}
.dsh-ig-studio-btn-danger:hover{background:rgba(239,68,68,0.14);border-color:rgba(239,68,68,0.6);color:#dc2626}
.dsh-ig-studio-btn-danger.is-active{background:#dc2626;border-color:#dc2626;color:#fff}

/* Floating Batch Action Bar */
.dsh-ig-batch-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:16px;background:rgba(20,24,32,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.18);border-radius:40px;padding:8px 16px;box-shadow:0 16px 40px rgba(0,0,0,0.5);z-index:99990;animation:dsh-ig-slide-up .2s cubic-bezier(0.16,1,0.3,1);color:#fff}
@keyframes dsh-ig-slide-up{from{transform:translate(-50%,20px);opacity:0}to{transform:translate(-50%,0);opacity:1}}
.dsh-ig-batch-bar-left{display:flex;align-items:center;gap:10px}
.dsh-ig-batch-bar-right{display:flex;align-items:center;gap:8px;border-left:1px solid rgba(255,255,255,0.15);padding-left:12px}
.dsh-ig-batch-counter{font-size:13px;font-weight:600;color:rgba(255,255,255,0.95);margin-right:4px}
.dsh-ig-batch-btn{appearance:none;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);color:#fff;border-radius:20px;padding:5px 12px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:background .15s,border-color .15s,color .15s}
.dsh-ig-batch-btn:hover:not(:disabled){background:rgba(255,255,255,0.2)}
.dsh-ig-batch-btn:disabled{opacity:0.4;cursor:not-allowed}
.dsh-ig-batch-btn-danger{background:rgba(239,68,68,0.2);border-color:rgba(239,68,68,0.5);color:#fca5a5}
.dsh-ig-batch-btn-danger:hover:not(:disabled){background:rgba(239,68,68,0.4)!important;border-color:rgba(239,68,68,0.8)!important;color:#fff!important}
.dsh-ig-batch-btn-exit{border-color:transparent;background:transparent;color:rgba(255,255,255,0.7)}
.dsh-ig-batch-btn-exit:hover{background:rgba(255,255,255,0.1);color:#fff}

/* Batch Delete Confirmation Modal */
.dsh-ig-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:100005;display:flex;align-items:center;justify-content:center;padding:16px;animation:dsh-ig-fade .15s ease-out}
.dsh-ig-modal-box{width:100%;max-width:440px;background:var(--dsw-alias-bg-layer-1,#1c1e24);border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,0.12));border-radius:12px;padding:22px;box-sizing:border-box;box-shadow:0 20px 50px rgba(0,0,0,0.45);color:var(--dsw-alias-label-primary,#fff);animation:dsh-ig-scale-up .15s ease-out}
@keyframes dsh-ig-scale-up{from{transform:scale(0.95);opacity:0}to{transform:scale(1);opacity:1}}
.dsh-ig-modal-header{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}
.dsh-ig-modal-icon-danger{width:36px;height:36px;border-radius:50%;background:rgba(239,68,68,0.12);color:#ef4444;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.dsh-ig-modal-title{font-size:16px;font-weight:600;line-height:1.4}
.dsh-ig-modal-body{margin-bottom:20px;padding-left:48px}
.dsh-ig-modal-desc{font-size:13.5px;color:var(--dsw-alias-label-secondary,rgba(255,255,255,0.7));margin:0 0 14px 0;line-height:1.5}
.dsh-ig-modal-checkbox-label{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-primary,inherit);cursor:pointer;user-select:none}
.dsh-ig-modal-checkbox-label input{margin:0;cursor:pointer;width:15px;height:15px}
.dsh-ig-modal-footer{display:flex;align-items:center;justify-content:flex-end;gap:10px}
.dsh-ig-modal-btn{height:34px;padding:0 14px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s,color .15s;outline:none}
.dsh-ig-modal-btn-cancel{background:transparent;border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,0.2));color:var(--dsw-alias-label-primary,inherit)}
.dsh-ig-modal-btn-cancel:hover{background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,0.08))}
.dsh-ig-modal-btn-danger{background:#dc2626;border:1px solid #dc2626;color:#fff}
.dsh-ig-modal-btn-danger:hover{background:#b91c1c;border-color:#b91c1c}
.dsh-ig-modal-btn-primary{background:linear-gradient(135deg,#3b82f6,#2563eb);border:1px solid #2563eb;color:#fff;display:inline-flex;align-items:center;gap:6px}
.dsh-ig-modal-btn-primary:hover:not(:disabled){background:linear-gradient(135deg,#2563eb,#1d4ed8)}
.dsh-ig-modal-btn-primary:disabled{opacity:0.5;cursor:not-allowed}
.dsh-ig-regenerate-modal-box{max-width:520px}
.dsh-ig-regenerate-modal-icon{width:36px;height:36px;border-radius:50%;background:rgba(59,130,246,0.15);color:#3b82f6;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.dsh-ig-regenerate-modal-title-wrap{display:flex;flex-direction:column;gap:4px}
.dsh-ig-regenerate-modal-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsh-ig-regenerate-modal-textarea{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,0.25));border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,0.15));border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#fff);resize:vertical;font-family:inherit;outline:none;transition:border-color .15s,box-shadow .15s}
.dsh-ig-regenerate-modal-textarea:focus{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,0.2)}
.dsh-ig-lightbox-btn-regenerate:hover{color:#60a5fa!important;border-color:rgba(96,165,250,0.5)!important;background:rgba(96,165,250,0.12)!important}
.dsh-ig-lightbox-generating-indicator{display:inline-flex;align-items:center;gap:8px;padding:4px 12px;background:rgba(37,99,235,0.2);border:1px solid rgba(59,130,246,0.5);border-radius:20px;font-size:12px;color:#93c5fd;animation:dsh-ig-fade .15s ease-out}
.dsh-ig-lightbox-spinner-sm{width:12px;height:12px;border:2px solid rgba(147,197,253,0.3);border-top-color:#93c5fd;border-radius:50%;animation:dsh-ig-spin .8s linear infinite;flex-shrink:0}
.dsh-ig-lightbox-abort-btn{appearance:none;background:transparent;border:0;color:#fca5a5;font-size:11.5px;cursor:pointer;padding:0 4px;margin-left:4px;text-decoration:underline;text-underline-offset:2px}
.dsh-ig-lightbox-abort-btn:hover{color:#ef4444}

/* Hide floating chat composer and width handles when gallery page is active */
[data-conversation-scroll]:has(.dsh-ig-gallery-page) [data-composer-seat]{display:none!important}
:has(> [data-conversation-scroll]:has(.dsh-ig-gallery-page)) > [class*="widthHandle"],
:has(.dsh-ig-gallery-page) [class*="widthHandle"],
.root:has(.dsh-ig-gallery-page) [class*="widthHandle"]{display:none!important}
`



/** Required browser services. */
export const inject = ['slots', 'connection', 'remote', 'settingsScope', 'locale']

/** Mount the settings card, generated-image card, and native conversation gallery view. */
export function apply(ctx: Context): void {
  const scope = ctx.settingsScope.bind<ImageSettings>({ namespace: IMAGE_GENERATION_NAMESPACE as never })
  // Host-owned chat transcript preference ("ui-chat" transcriptView). Unknown,
  // unavailable, or not-yet-loaded reads fall back to Compact-safe anchoring.
  const chatScope = ctx.settingsScope.bind<{ transcriptView?: string }>({ namespace: 'ui-chat' as never })
  const isCompactTranscript = (): boolean => chatScope.getSnapshot().value?.transcriptView !== 'normal'
  const locale = ctx.get('locale') as LocaleService | undefined
  const promotion = { enabled: false }

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-image-gen'
    style.textContent = `${STYLE}\n${STUDIO_STYLE}\n${INSPIRATION_STYLE}`
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, 'dsh-image-gen: styles')

  const register = ctx.slots.register.bind(ctx.slots) as unknown as (options: object, component: unknown) => () => void

  ;(ctx.inject as unknown as (services: string[], callback: (owner: Context) => void) => void)(
    ['uiConversation'],
    (owner) => {
      const uiConversation = asModernUiConversation(owner.get('uiConversation'))
      if (uiConversation === undefined) {
        throw new Error('dsh-image-gen: uiConversation has an incompatible interface')
      }
      promotion.enabled = true
      const ownerRegister = owner.slots.register.bind(owner.slots) as unknown as (options: object, component: unknown) => () => void
      owner.effect(
      () => uiConversation.events.register(createImageResultDefinition({ isCompactTranscript })),
      'dsh-image-gen: promoted image result node',
      )
      ;(owner.slots.inject as any)('conversation.chat.node', () => ownerRegister({
        name: 'conversation.chat.node',
        key: IMAGE_RESULT_NODE_KIND,
        inject: () => ({ locale }),
      }, PromotedImageResultNode))
    },
  )

  // 1. Top-level settings section: a sibling page of General / Models /
  // Plugins. The legacy `settings.plugin.item` card is intentionally not
  // registered — a served namespace no card claims renders nothing, so the
  // Plugins tab stays clean with this page as the single settings surface.
  const injectSettingsSection = (credentials: CredentialsRemote): void => {
    ;(ctx.slots.inject as any)('settings.section', () => register({
      name: 'settings.section',
      id: IMAGE_GENERATION_NAMESPACE,
      order: 600,
      label: () => {
        const active = locale?.getSnapshot?.()?.active
        return active?.startsWith('en') ? 'Image generation' : '图像生成'
      },
      inject: (): SettingsFace => ({ scope, credentials, locale }),
    }, ImageGenerationSettingsCard))
  }
  const remoteCredentials = asCredentialsRemote(ctx.get('remote.credentials'))
  const legacyCredentials = credentialsFromLegacyConnection(ctx.get('connection'))
  if (remoteCredentials !== undefined) {
    injectSettingsSection(remoteCredentials)
  } else if (legacyCredentials !== undefined) {
    injectSettingsSection(legacyCredentials)
  } else {
    ctx.inject(['remote.credentials'], (remoteCtx) => {
      const credentials = asCredentialsRemote(remoteCtx.get('remote.credentials'))
      if (credentials === undefined) throw new Error('dsh-image-gen: remote.credentials has an incompatible interface')
      injectSettingsSection(credentials)
    })
  }

  // Image-model picker in the composer tool row (left of the row that hosts
  // the conversation model selector): a pure client shortcut that rewrites
  // the global default channel + model. Mirrors the registration shape of
  // dsh-client-ui-model-selection, the official contributor to these seats.
  ;(ctx.slots.inject as any)('conversation.input.left', () => {
    return register({
      name: 'conversation.input.left',
      id: 'dsh-image-gen-image-model-picker',
      inject: (sessionId: unknown) => ({ scope, locale }),
    }, ImageModelPicker)
  }, 'dsh-image-gen: image-model picker')

  // 2. Tool result view card in chat stream
  ctx.slots.inject('tool.call.toolview', () => register({
    name: 'tool.call.toolview',
    key: 'generate_image',
    inject: (): ImageCardFace => ({ locale, promoted: promotion.enabled }),
  }, GeneratedImageCard))
  ctx.slots.inject('tool.call.toolview', () => register({
    name: 'tool.call.toolview',
    key: 'edit_image',
    inject: (): ImageCardFace => ({ locale, promoted: promotion.enabled }),
  }, GeneratedImageCard))

  // 3. Native conversation view tab (DSH official slot: 'conversation.view')
  ;(ctx.slots.inject as any)('conversation.view', () => register({
    name: 'conversation.view',
    id: 'gallery',
    order: 20,
    label: () => {
      const active = locale?.getSnapshot?.()?.active
      return active?.startsWith('en') ? 'Gallery' : '画廊'
    },
    inject: () => ({ locale }),
  }, GalleryViewTab))
}

function asModernUiConversation(value: unknown): ModernUiConversation | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const events = (value as { events?: unknown }).events
  if (events === null || typeof events !== 'object') return undefined
  return typeof (events as { register?: unknown }).register === 'function'
    ? value as ModernUiConversation
    : undefined
}

function asCredentialsRemote(value: unknown): CredentialsRemote | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Partial<CredentialsRemote>
  return typeof candidate.describe === 'function' && typeof candidate.set === 'function'
    ? candidate as CredentialsRemote
    : undefined
}

function credentialsFromLegacyConnection(value: unknown): CredentialsRemote | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const credentials = (value as { api?: { credentials?: Partial<LegacyCredentialsApi> } }).api?.credentials
  if (credentials === undefined || typeof credentials.describe !== 'function' || typeof credentials.set !== 'function') return undefined
  const legacy = credentials as LegacyCredentialsApi
  return {
    async describe(refs) {
      const response = await legacy.describe({ refs })
      return response.result.ok
        ? { ok: true, value: response.result.value.credentials }
        : { ok: false }
    },
    async set(ref, credentialValue) {
      const response = await legacy.set({ ref, value: credentialValue })
      return response.result.ok
        ? { ok: true }
        : { ok: false, error: response.result.error }
    },
  }
}

/** Edit provider settings and its write-only API credential. */
export function ImageGenerationSettingsCard(props: SettingsCardProps) {
  const [snapshot, setSnapshot] = useState(() => props.scope.getSnapshot())
  const [lang, setLang] = useState(() => (props.locale?.getSnapshot?.()?.active?.startsWith('en') ? 'en' : 'zh'))
  const [channels, setChannels] = useState<ChannelDraft[]>([])
  const [defaultChannelId, setDefaultChannelId] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [customByChannel, setCustomByChannel] = useState<Record<string, string>>({})
  const [picker, setPicker] = useState<ModelPickerState | null>(null)
  const [comfyBaseURL, setComfyBaseURL] = useState(DEFAULT_COMFYUI_BASE_URL)
  const [workflows, setWorkflows] = useState<ComfyUIWorkflowEntry[]>([])
  const [activeWorkflow, setActiveWorkflow] = useState('')
  const [timeoutSeconds, setTimeoutSeconds] = useState(DEFAULT_COMFYUI_TIMEOUT_MS / 1000)
  const [saveToWorkspace, setSaveToWorkspace] = useState(true)
  const [workspaceFolder, setWorkspaceFolder] = useState('dsh-image-gen')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageIsError, setMessageIsError] = useState(false)
  const reportMessage = (text: string): void => { setMessage(text); setMessageIsError(false) }
  const reportError = (text: string): void => { setMessage(text); setMessageIsError(true) }

  useEffect(() => props.scope.subscribe(() => { setSnapshot(props.scope.getSnapshot()) }), [props.scope])
  useEffect(() => {
    return props.locale?.subscribe?.(() => {
      setLang(props.locale?.getSnapshot?.()?.active?.startsWith('en') ? 'en' : 'zh')
    })
  }, [props.locale])

  const t = (keyName: DictKey, params?: Record<string, string>): string => {
    const dict = lang === 'en' ? DICT.en : DICT.zh
    let text: string = dict[keyName] || DICT.zh[keyName] || keyName
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, v)
      }
    }
    return text
  }

  const providerLabels: Record<Provider, string> = {
    google: t('providerGoogle'),
    openai: t('providerOpenAI'),
    seedream: t('providerSeedream'),
    dashscope: t('providerDashScope'),
    gitee: t('providerGitee'),
    modelscope: t('providerModelScope'),
    antigravity: t('providerAntigravity'),
    comfyui: t('providerComfyUI'),
  }

  useEffect(() => {
    const value = snapshot.value
    setChannels(channelsFromSettings(value))
    setDefaultChannelId(value?.defaultChannelId ?? '')
    setDefaultModel(value?.defaultModel ?? '')
    setCustomByChannel({})
    setPicker(null)
    setComfyBaseURL(value?.comfyuiBaseURL ?? DEFAULT_COMFYUI_BASE_URL)
    setWorkflows(resolveComfyUIWorkflows(value ?? {}))
    setActiveWorkflow(activeComfyUIWorkflow(value ?? {})?.name ?? '')
    setTimeoutSeconds(Math.max(1, Math.round((value?.comfyuiTimeoutMs ?? DEFAULT_COMFYUI_TIMEOUT_MS) / 1000)))
    setSaveToWorkspace(value?.saveToWorkspace ?? true)
    setWorkspaceFolder(value?.workspaceFolder ?? 'dsh-image-gen')
  }, [snapshot])

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setSaving(true); setMessage('')
    try {
      // Channel instances are the agent's whole channel universe. There is
      // deliberately no default model: ambiguous tool calls are refused and
      // the agent asks the user instead.
      const stored = channels.map(channel => ({
        id: channel.id,
        provider: channel.provider,
        baseURL: channel.baseURL.trim(),
        apiKeyEnv: channel.apiKeyEnv.trim(),
        models: [...new Set(channel.models)],
      }))
      await props.scope.set('channels', stored)
      // Default model: the radio pick must point at a live channel/model pair;
      // drift (deleted entries) falls back to the first available.
      let fixedChannelId = defaultChannelId
      let fixedModel = defaultModel
      const defaultDraft = channels.find(channel => channel.id === defaultChannelId)
      if (defaultDraft === undefined) {
        fixedChannelId = channels[0]?.id ?? ''
        fixedModel = channels[0]?.models[0] ?? ''
      } else if (!defaultDraft.models.includes(defaultModel)) {
        fixedModel = defaultDraft.models[0] ?? ''
      }
      if (fixedChannelId !== defaultChannelId) setDefaultChannelId(fixedChannelId)
      if (fixedModel !== defaultModel) setDefaultModel(fixedModel)
      await props.scope.set('defaultChannelId', fixedChannelId)
      await props.scope.set('defaultModel', fixedModel)
      if (stored.length > 0 && stored[0] !== undefined) {
        const defaultProvider = channels.find(channel => channel.id === fixedChannelId)?.provider ?? stored[0].provider
        await props.scope.set('provider', defaultProvider)
      }
      // Legacy per-provider mirror keeps the Studio workbench functional.
      const perProvider = new Map<Provider, ChannelDraft[]>()
      for (const channel of channels) {
        const list = perProvider.get(channel.provider) ?? []
        list.push(channel)
        perProvider.set(channel.provider, list)
      }
      for (const [providerKey, list] of perProvider) {
        const first = list[0]
        if (first === undefined) continue
        const endpointKey = providerKey === 'google' ? 'googleEndpoint' : providerKey === 'openai' ? 'openaiBaseURL' : providerKey === 'seedream' ? 'seedreamBaseURL' : providerKey === 'gitee' ? 'giteeBaseURL' : providerKey === 'modelscope' ? 'modelscopeBaseURL' : providerKey === 'antigravity' ? 'antigravityBaseURL' : 'dashscopeEndpoint'
        const modelKey = providerKey === 'google' ? 'googleModel' : providerKey === 'openai' ? 'openaiModel' : providerKey === 'seedream' ? 'seedreamModel' : providerKey === 'gitee' ? 'giteeModel' : providerKey === 'modelscope' ? 'modelscopeModel' : providerKey === 'antigravity' ? 'antigravityModel' : 'dashscopeModel'
        const models = [...new Set(list.flatMap(channel => channel.models))]
        if (first.baseURL.trim() !== '') await props.scope.set(endpointKey, first.baseURL.trim())
        // The default model mirrors into the provider's primary field when it
        // lives on this provider; otherwise the first model stands in (Studio).
        const defaultProvider = channels.find(channel => channel.id === fixedChannelId)?.provider
        const mirrorModel = defaultProvider === providerKey && fixedModel !== '' && models.includes(fixedModel) ? fixedModel : models[0]
        if (mirrorModel !== undefined && mirrorModel !== '') await props.scope.set(modelKey, mirrorModel)
        await props.scope.set(modelsKeyOf(providerKey), models)
      }
      // Freshly typed keys travel through credentials/set under the channel's ref.
      for (const channel of channels) {
        if (channel.keyInput.trim() === '') continue
        const keyRef = channel.apiKeyEnv.trim() !== '' ? channel.apiKeyEnv.trim() : KEY_REF[channel.provider]
        if (keyRef === undefined || keyRef === '') throw new Error(t('keyRefMissing'))
        const response = await props.credentials.set(keyRef, channel.keyInput.trim())
        if (!response.ok) throw new Error(response.error?.message ?? 'Failed to save API key')
      }
      setChannels(current => current.map(channel => ({ ...channel, keyInput: '' })))
      // ComfyUI (workflow channel) — same semantics as before.
      const entries = workflows.map(entry => ({ name: entry.name.trim(), json: entry.json, presetPrompt: (entry.presetPrompt ?? '').trim() }))
      for (const entry of entries) {
        if (entry.name.length === 0) throw new Error(t('workflowNameRequired'))
        validateComfyUIWorkflowJson(entry.json)
      }
      if (new Set(entries.map(entry => entry.name)).size !== entries.length) throw new Error(t('workflowDuplicateName'))
      const activeEntry = entries.find(entry => entry.name === activeWorkflow) ?? entries[0]
      await props.scope.set('comfyuiBaseURL', comfyBaseURL)
      await props.scope.set('comfyuiWorkflows', entries)
      await props.scope.set('comfyuiActiveWorkflow', activeEntry === undefined ? '' : activeEntry.name)
      await props.scope.set('comfyuiWorkflowJson', activeEntry === undefined ? '' : activeEntry.json)
      await props.scope.set('comfyuiWorkflowName', activeEntry === undefined ? '' : activeEntry.name)
      await props.scope.set('comfyuiTimeoutMs', Math.max(1, Math.round(timeoutSeconds)) * 1000)
      await props.scope.set('saveToWorkspace', saveToWorkspace)
      await props.scope.set('workspaceFolder', workspaceFolder.trim())
      reportMessage(t('saved'))
    } catch (cause) { reportError(cause instanceof Error ? cause.message : String(cause)) } finally { setSaving(false) }
  }

  const workflowStatus = activeWorkflow.length > 0 ? t('workflowImported', { name: activeWorkflow }) : t('workflowMissing')

  const updateChannel = (id: string, patch: Partial<ChannelDraft>): void => {
    setChannels(current => current.map(channel => channel.id === id ? { ...channel, ...patch } : channel))
  }

  const addChannel = (): void => {
    const id = `ch-${Date.now().toString(36)}`
    setChannels(current => [...current, { id, provider: 'gitee', baseURL: DEFAULT_BASE_URLS.gitee, apiKeyEnv: '', models: [], keyInput: '', open: true }])
  }

  const removeChannel = (id: string): void => {
    setChannels(current => current.filter(channel => channel.id !== id))
  }

  const addCustomModel = (channelId: string): void => {
    const id = (customByChannel[channelId] ?? '').trim()
    if (id === '') return
    setChannels(current => current.map(channel => channel.id === channelId && !channel.models.includes(id) ? { ...channel, models: [...channel.models, id] } : channel))
    setCustomByChannel(current => ({ ...current, [channelId]: '' }))
  }

  /** Open the picker modal: fetch the endpoint's models through the host proxy (uses the stored credential, or the key typed in the card). */
  const openPicker = async (channel: ChannelDraft): Promise<void> => {
    setPicker({ channelId: channel.id, provider: channel.provider, baseURL: channel.baseURL, apiKey: channel.keyInput.trim(), loading: true, error: '', models: [], checked: [...channel.models] })
    try {
      const response = await fetch(MODELS_ROUTE, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: channel.provider, baseURL: channel.baseURL, apiKey: channel.keyInput.trim() }),
      })
      const body = await response.json() as { ok: boolean; models?: Array<{ id: string; image: boolean }>; error?: string }
      if (!body.ok || body.models === undefined) throw new Error(body.error ?? `HTTP ${String(response.status)}`)
      const sorted = [...body.models].sort((a, b) => (a.image === b.image ? a.id.localeCompare(b.id) : a.image ? -1 : 1))
      setPicker(current => current === null || current.channelId !== channel.id ? current : { ...current, loading: false, models: sorted })
    } catch (cause) {
      setPicker(current => current === null || current.channelId !== channel.id ? current : { ...current, loading: false, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  const pickerToggle = (id: string): void => {
    setPicker(current => current === null ? current : { ...current, checked: current.checked.includes(id) ? current.checked.filter(entry => entry !== id) : [...current.checked, id] })
  }

  /** Confirm the picker: the checked set becomes the channel list; custom ids outside the fetched set survive. */
  const pickerConfirm = (): void => {
    if (picker === null) return
    const fetched = new Set(picker.models.map(entry => entry.id))
    setChannels(current => current.map(channel => channel.id === picker.channelId ? { ...channel, models: [...new Set([...picker.checked, ...channel.models.filter(id => !fetched.has(id))])] } : channel))
    setPicker(null)
  }

  const importWorkflow = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    reportMessage('')
    try {
      if (file.size > MAX_COMFYUI_WORKFLOW_BYTES) throw new Error(t('workflowTooLarge'))
      const json = await file.text()
      validateComfyUIWorkflowJson(json)
      const name = uniqueComfyUIWorkflowName(file.name, workflows.map(entry => entry.name))
      setWorkflows(current => [...current, { name, json }])
      setActiveWorkflow(current => current.length > 0 ? current : name)
      reportMessage(t('workflowImported', { name }))
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  /** Renaming the active entry keeps the active selection following its new name. */
  const renameWorkflow = (index: number, name: string): void => {
    const previous = workflows[index]
    setWorkflows(current => current.map((entry, position) => position === index ? { ...entry, name } : entry))
    if (previous !== undefined && previous.name === activeWorkflow) setActiveWorkflow(name)
  }

  /** Removing the active entry moves the selection to the first remaining workflow. */
  const removeWorkflow = (index: number): void => {
    const previous = workflows[index]
    const next = workflows.filter((_entry, position) => position !== index)
    setWorkflows(next)
    if (previous !== undefined && previous.name === activeWorkflow) setActiveWorkflow(next[0]?.name ?? '')
  }

  /** Editing one entry's preset leaves the rest of the entry untouched. */
  const setWorkflowPreset = (index: number, presetPrompt: string): void => {
    setWorkflows(current => current.map((entry, position) => position === index ? { ...entry, presetPrompt } : entry))
  }

  const content = (
    <>
      <form className="dsh-ig-body" onSubmit={(event) => { void save(event) }}>
          <div className="dsh-ig-channel dsh-ig-channel-open">
            <div className="dsh-ig-channel-body">
              <label className="dsh-ig-check-row">
                <input type="checkbox" checked={saveToWorkspace} onChange={event => { setSaveToWorkspace(event.target.checked) }} />
                <span className="dsh-ig-label">{t('saveToWorkspace')}</span>
              </label>
              {saveToWorkspace ? (
                <label className="dsh-ig-field">
                  <span className="dsh-ig-label">{t('folder')}</span>
                  <input className="dsh-ig-input" value={workspaceFolder} onChange={event => { setWorkspaceFolder(event.target.value) }} placeholder="dsh-image-gen" />
                  <span className="dsh-ig-hint">{t('folderHint')}</span>
                </label>
              ) : null}
              <div className="dsh-ig-actions">
                <p className={`dsh-ig-status${messageIsError ? ' dsh-ig-status-error' : ''}`} role="status">{message}</p>
                <button className="dsh-ig-save" type="submit" disabled={saving || !snapshot.writable}>{saving ? t('saving') : t('save')}</button>
              </div>
            </div>
          </div>
          {channels.map(channel => (
            <div className={`dsh-ig-channel${channel.open ? ' dsh-ig-channel-open' : ''}`} key={channel.id}>
              <button type="button" className="dsh-ig-channel-head" onClick={() => { updateChannel(channel.id, { open: !channel.open }) }}>
                <span className="dsh-ig-channel-title">{providerLabels[channel.provider]}</span>
                <span className="dsh-ig-channel-meta">{channel.baseURL !== '' ? channel.baseURL : t('channelNoEndpoint')} · {t('channelModels', { count: String(channel.models.length) })}</span>
                <span className={`dsh-ig-chevron ${channel.open ? 'dsh-ig-chevron-open' : ''}`} aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4"/></svg>
                </span>
              </button>
              {channel.open ? (
                <div className="dsh-ig-channel-body">
                  <label className="dsh-ig-field">
                    <span className="dsh-ig-label">{t('provider')}</span>
                    <select className="dsh-ig-input" value={channel.provider} onChange={event => { const next = event.target.value as Provider; updateChannel(channel.id, { provider: next, baseURL: next === 'comfyui' ? DEFAULT_COMFYUI_BASE_URL : DEFAULT_BASE_URLS[next], models: [], keyInput: '' }) }}>
                      <option value="google">{t('providerGoogle')}</option>
                      <option value="openai">{t('providerOpenAI')}</option>
                      <option value="seedream">{t('providerSeedream')}</option>
                      <option value="dashscope">{t('providerDashScope')}</option>
                      <option value="gitee">{t('providerGitee')}</option>
                      <option value="modelscope">{t('providerModelScope')}</option>
                      <option value="antigravity">{t('providerAntigravity')}</option>
                      <option value="comfyui">{t('providerComfyUI')}</option>
                    </select>
                  </label>
                  {channel.provider === 'comfyui' ? (
                    <>
                      <label className="dsh-ig-field">
                        <span className="dsh-ig-label">{t('endpoint')}</span>
                        <div className="dsh-ig-input-group">
                          <input className="dsh-ig-input" type="url" value={channel.baseURL} onChange={event => { updateChannel(channel.id, { baseURL: event.target.value }) }} required />
                          <button type="button" className="dsh-ig-btn-reset" title={t('resetTitle')} onClick={() => { updateChannel(channel.id, { baseURL: DEFAULT_COMFYUI_BASE_URL }) }}>{t('reset')}</button>
                        </div>
                        <span className="dsh-ig-hint">{t('endpointHintComfyUI')}</span>
                      </label>
                      <div className="dsh-ig-field">
                        <span className="dsh-ig-label">{t('workflow')}</span>
                        <div className="dsh-ig-file-row">
                          <label className="dsh-ig-file-button">
                            <input className="dsh-ig-file-input" type="file" accept=".json,application/json" onChange={event => { void importWorkflow(event) }} />
                            {t('workflowImport')}
                          </label>
                          {workflows.length === 0 ? <span className="dsh-ig-file-name">{t('workflowMissing')}</span> : null}
                        </div>
                        {workflows.length > 0 ? (
                          <ul className="dsh-ig-workflow-list">
                            {workflows.map((entry, index) => (
                              <li className="dsh-ig-workflow-row" key={String(index)}>
                                <div className="dsh-ig-workflow-main">
                                  <label className="dsh-ig-workflow-active" title={t('workflowActiveTitle')}>
                                    <input
                                      type="radio"
                                      name="dsh-ig-active-workflow"
                                      aria-label={t('workflowActiveTitle')}
                                      checked={entry.name === activeWorkflow}
                                      onChange={() => { setActiveWorkflow(entry.name) }}
                                    />
                                  </label>
                                  <input
                                    className="dsh-ig-input dsh-ig-workflow-name"
                                    value={entry.name}
                                    title={entry.name}
                                    onChange={event => { renameWorkflow(index, event.target.value) }}
                                  />
                                  <button type="button" className="dsh-ig-btn-reset" onClick={() => { removeWorkflow(index) }}>{t('workflowRemove')}</button>
                                </div>
                                <input
                                  className="dsh-ig-input dsh-ig-workflow-preset"
                                  value={entry.presetPrompt ?? ''}
                                  placeholder={t('workflowPresetPlaceholder')}
                                  title={t('workflowPresetTitle')}
                                  onChange={event => { setWorkflowPreset(index, event.target.value) }}
                                />
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <span className="dsh-ig-hint">{t('workflowHint')}</span>
                      </div>
                      <label className="dsh-ig-field">
                        <span className="dsh-ig-label">{t('timeout')}</span>
                        <input className="dsh-ig-input" type="number" min="1" max="3600" step="1" value={timeoutSeconds} onChange={event => { setTimeoutSeconds(Number(event.target.value)) }} required />
                        <span className="dsh-ig-hint">{t('timeoutHint')}</span>
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="dsh-ig-field">
                        <span className="dsh-ig-label">{t('apiKeyLabel', { provider: providerLabels[channel.provider] })}</span>
                        <input className="dsh-ig-input" type="password" autoComplete="off" value={channel.keyInput} onChange={event => { updateChannel(channel.id, { keyInput: event.target.value }) }} placeholder={t('apiKeyPlaceholder')} />
                        <span className="dsh-ig-hint">{t('apiKeyHint', { key: channel.apiKeyEnv.trim() !== '' ? channel.apiKeyEnv : KEY_REF[channel.provider] ?? '' })}</span>
                      </label>
                      <label className="dsh-ig-field">
                        <span className="dsh-ig-label">{t('endpoint')}</span>
                        <div className="dsh-ig-input-group">
                          <input className="dsh-ig-input" type="url" value={channel.baseURL} onChange={event => { updateChannel(channel.id, { baseURL: event.target.value }) }} required />
                          <button type="button" className="dsh-ig-btn-reset" title={t('resetTitle')} onClick={() => { updateChannel(channel.id, { baseURL: DEFAULT_BASE_URLS[channel.provider] }) }}>{t('reset')}</button>
                        </div>
                      </label>
                      <div className="dsh-ig-field">
                        <span className="dsh-ig-label">{t('modelsList')}</span>
                        <div className="dsh-ig-input-group">
                          <button type="button" className="dsh-ig-file-button" onClick={() => { void openPicker(channel) }}>{t('modelsFetch')}</button>
                          <input className="dsh-ig-input" value={customByChannel[channel.id] ?? ''} placeholder={t('modelsCustomPlaceholder')} onChange={event => { setCustomByChannel(current => ({ ...current, [channel.id]: event.target.value })) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCustomModel(channel.id) } }} />
                          <button type="button" className="dsh-ig-btn-reset" onClick={() => { addCustomModel(channel.id) }}>{t('modelsAdd')}</button>
                        </div>
                        {channel.models.length === 0 ? <span className="dsh-ig-hint">{t('modelsListEmpty')}</span> : (
                          <ul className="dsh-ig-workflow-list">
                            {channel.models.map(id => (
                              <li className="dsh-ig-workflow-row" key={id}>
                                <label className="dsh-ig-workflow-main">
                                  <input
                                    type="radio"
                                    name="dsh-ig-default-model"
                                    title={t('modelsDefaultTitle')}
                                    checked={defaultChannelId === channel.id && defaultModel === id}
                                    onChange={() => { setDefaultChannelId(channel.id); setDefaultModel(id) }}
                                  />
                                  <span className="dsh-ig-file-name" title={id}>{id}</span>
                                </label>
                                <button type="button" className="dsh-ig-btn-reset" onClick={() => { updateChannel(channel.id, { models: channel.models.filter(entry => entry !== id) }) }}>{t('workflowRemove')}</button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <span className="dsh-ig-hint">{t('modelsListHint', { provider: providerLabels[channel.provider] })}</span>
                      </div>
                    </>
                  )}
                  <button type="button" className="dsh-ig-btn-reset" onClick={() => { removeChannel(channel.id) }}>{t('channelDelete')}</button>
                </div>
              ) : null}
            </div>
          ))}
          <button type="button" className="dsh-ig-file-button" onClick={addChannel}>{t('addChannel')}</button>
        </form>
      {picker !== null ? (
        <div className="dsh-ig-regenerate-backdrop" onClick={() => { setPicker(null) }}>
          <div className="dsh-ig-regenerate-dialog dsh-ig-picker" onClick={event => { event.stopPropagation() }}>
            <h3>{t('modelsPickerTitle')}</h3>
            {picker.loading ? <p>{t('modelsFetching')}</p> : picker.error !== '' ? <p className="dsh-ig-regenerate-error">{picker.error}</p> : (
              <>
                <p>{t('modelsPickerHint')}</p>
                <ul className="dsh-ig-picker-list">
                  {picker.models.map(entry => (
                    <li key={entry.id}>
                      <label title={entry.image ? undefined : t('modelsNotLikelyImage')}>
                        <input type="checkbox" checked={picker.checked.includes(entry.id)} onChange={() => { pickerToggle(entry.id) }} />
                        <span>{entry.id}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="dsh-ig-regenerate-actions">
              <button type="button" className="dsh-ig-regenerate-cancel" onClick={() => { setPicker(null) }}>{t('cancel')}</button>
              <button type="button" className="dsh-ig-regenerate-confirm" disabled={picker.loading} onClick={pickerConfirm}>{t('confirm')}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
  return <div className="dsh-ig-page">{content}</div>
}

/** Keep the legacy Tool row for old DSH and hand modern results to the independent Chat node. */
export function GeneratedImageCard(props: ImageCardProps) {
  const result = imageResultFromBlock(props.block)
  if (props.promoted && result !== undefined) return <PromotedResultNotice locale={props.locale} />
  return <ImageResultCard result={result} locale={props.locale} sessionId={(props as any).sessionId} />
}

/** Render modern image artifacts as final conversation output instead of Tool process content. */
export function PromotedImageResultNode(props: ImageResultNodeProps) {
  return <div className="dsh-ig-promoted-results">
    {props.node.data.results.map(result =>
      <ImageResultCard key={result.attachment.attachmentId} result={result} locale={props.locale} sessionId={(props as any).sessionId} />)}
  </div>
}

function PromotedResultNotice({ locale }: { locale?: LocaleService | undefined }) {
  const lang = usePluginLanguage(locale)
  return <div className="dsh-ig-loading">{DICT[lang].resultShown}</div>
}

function ImageResultCard({
  result,
  locale,
  sessionId,
}: {
  result?: ImageResultPresentation | undefined
  locale?: LocaleService | undefined
  sessionId?: string | undefined
}) {
  const attachment = result?.attachment
  const originId = attachment?.attachmentId
  const [revisionChain, setRevisionChain] = useState<ConversationImageRevisionChain>(() =>
    loadConversationImageRevisionChain(String(originId ?? ''))
  )
  const selectedRevision = revisionChain.revisions[revisionChain.currentIndex - 1]
  const activeAttachment = selectedRevision?.attachment ?? attachment
  const activeResult = selectedRevision !== undefined ? {
    prompt: selectedRevision.prompt,
    provider: selectedRevision.provider,
    model: selectedRevision.model,
    output: selectedRevision.output,
    createdAt: selectedRevision.createdAt,
  } : result
  const savedTo = result?.savedTo
  const [url, setUrl] = useState<string>()
  const [blob, setBlob] = useState<Blob>()
  const [error, setError] = useState<string>()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [toast, setToast] = useState<string>()
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [regeneratePrompt, setRegeneratePrompt] = useState('')
  const [regenerateError, setRegenerateError] = useState<string>()
  const [isRegenerating, setIsRegenerating] = useState(false)
  const regenerateControllerRef = useRef<AbortController>()
  const regenerateTextareaRef = useRef<HTMLTextAreaElement>(null)
  const lang = usePluginLanguage(locale)

  const t = (keyName: DictKey, params?: Record<string, string>): string => {
    const dict = lang === 'en' ? DICT.en : DICT.zh
    let text: string = dict[keyName] || DICT.zh[keyName] || keyName
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, v)
      }
    }
    return text
  }

  // Auto-collect into gallery IndexedDB
  useEffect(() => {
    if (result === undefined) return

    void saveGalleryItem({
      id: result.attachment.attachmentId,
      attachment: result.attachment,
      prompt: result.prompt,
      provider: result.provider as ImageProvider,
      model: result.model,
      output: result.output,
      ...(result.savedTo ? { savedTo: result.savedTo } : {}),
      ...(result.seed !== undefined ? { seed: result.seed } : {}),
      ...(sessionId ? { sessionId } : {}),
    })
  }, [result?.attachment.attachmentId])

  useEffect(() => {
    if (!originId) return
    regenerateControllerRef.current?.abort()
    regenerateControllerRef.current = undefined
    setIsRegenerating(false)
    setRegenerateOpen(false)
    setRevisionChain(loadConversationImageRevisionChain(String(originId)))
  }, [originId])

  useEffect(() => () => { regenerateControllerRef.current?.abort() }, [])

  useEffect(() => {
    if (!regenerateOpen || isRegenerating) return
    const frame = requestAnimationFrame(() => {
      regenerateTextareaRef.current?.focus()
      regenerateTextareaRef.current?.select()
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRegenerateOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [regenerateOpen, isRegenerating])

  useEffect(() => {
    if (!previewOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [previewOpen])

  const currentUrlRef = useRef<string | undefined>()

  useEffect(() => {
    return () => {
      if (currentUrlRef.current !== undefined) {
        URL.revokeObjectURL(currentUrlRef.current)
        currentUrlRef.current = undefined
      }
    }
  }, [])

  useEffect(() => {
    if (activeAttachment === undefined) return
    let canceled = false
    void fetchAttachmentBlob(activeAttachment).then(resBlob => {
      if (canceled) return
      setBlob(resBlob)
      setError(undefined)
      const nextUrl = URL.createObjectURL(resBlob)
      if (currentUrlRef.current !== undefined) {
        URL.revokeObjectURL(currentUrlRef.current)
      }
      currentUrlRef.current = nextUrl
      setUrl(nextUrl)
    }).catch(cause => {
      if (canceled) return
      setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => {
      canceled = true
    }
  }, [activeAttachment?.attachmentId])

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!blob) return
    const ok = await copyImageBlob(blob)
    setToast(ok ? t('copiedImage') : t('copyFailed'))
    setTimeout(() => { setToast(undefined) }, 2000)
  }

  const download = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = activeAttachment?.name || `dsh-image-${Date.now()}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const openNewTab = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const openRegenerate = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (activeResult === undefined || isRegenerating) return
    setRegeneratePrompt(activeResult.prompt)
    setRegenerateError(undefined)
    setRegenerateOpen(true)
  }

  const cancelRegenerate = () => {
    regenerateControllerRef.current?.abort()
    regenerateControllerRef.current = undefined
    setIsRegenerating(false)
    setRegenerateOpen(false)
    setRegenerateError(undefined)
  }

  const regenerate = async () => {
    if (activeResult === undefined || !originId || isRegenerating || regeneratePrompt.trim().length === 0) return
    setIsRegenerating(true)
    setRegenerateError(undefined)
    // Non-blocking: close dialog immediately so user can continue chatting/scrolling!
    setRegenerateOpen(false)
    const controller = new AbortController()
    regenerateControllerRef.current = controller
    try {
      const request = conversationRegenerateRequest(
        activeResult,
        regeneratePrompt,
        selectedRevision === undefined ? undefined : { ratio: selectedRevision.ratio, quality: selectedRevision.quality },
      )
      const response = await fetch(STUDIO_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
      const payload = await response.json().catch(() => null) as StudioGenerateResponse | { error?: string } | null
      if (!response.ok || payload === null || !('attachment' in payload)) {
        throw new Error(payload && 'error' in payload && payload.error ? payload.error : t('regenerateFailed'))
      }
      const revision: ConversationImageRevision = {
        attachment: payload.attachment,
        prompt: payload.prompt,
        provider: payload.provider,
        model: payload.model,
        output: payload.output,
        createdAt: payload.createdAt,
        ratio: request.ratio,
        quality: request.quality,
      }
      await saveGalleryItem({
        id: String(revision.attachment.attachmentId),
        attachment: revision.attachment,
        prompt: revision.prompt,
        provider: revision.provider,
        model: revision.model,
        createdAt: revision.createdAt,
        aspectRatio: revision.ratio,
        imageSize: revision.quality,
        output: revision.output,
        ...(savedTo ? { savedTo } : {}),
        ...(sessionId ? { sessionId } : {}),
      })
      const next = appendConversationImageRevision(String(originId), revision)
      setRevisionChain(next)
      setToast(t('regenerate'))
      setTimeout(() => { setToast(undefined) }, 2000)
    } catch (cause) {
      if (!controller.signal.aborted) {
        const errMsg = cause instanceof Error ? cause.message : String(cause)
        setError(errMsg)
        setToast(errMsg)
        setTimeout(() => { setToast(undefined) }, 3500)
      }
    } finally {
      if (regenerateControllerRef.current === controller) {
        regenerateControllerRef.current = undefined
        setIsRegenerating(false)
      }
    }
  }

  const selectVersion = (index: number) => {
    if (!originId || isRegenerating) return
    setRevisionChain(selectConversationImageRevision(String(originId), index))
  }

  const canRegenerate = activeResult !== undefined
    && (CLOUD_IMAGE_PROVIDERS as readonly string[]).includes(activeResult.provider)
    && activeResult.model.trim().length > 0
  const versionTotal = revisionChain.revisions.length + 1
  const versionCurrent = revisionChain.currentIndex + 1

  if (attachment === undefined) return <div className="dsh-ig-loading">{t('generating')}</div>
  return <section className="dsh-ig-result" aria-label={t('generatedTitle')}>
    <div className="dsh-ig-result-title">{t('generatedTitle')}</div>
    {savedTo !== undefined ? <div className="dsh-ig-savedto">{t('savedToPath')}: {savedTo}</div> : null}
    {error !== undefined ? <div className="dsh-ig-error">{error}</div> : null}
    {url === undefined && error === undefined ? <div className="dsh-ig-loading">{t('loading')}</div> : null}
    {url !== undefined ? <div className="dsh-ig-container">
      <img
        className="dsh-ig-image"
        src={url}
        alt={activeAttachment?.name ?? 'Generated image'}
        onClick={() => { if (!isRegenerating) setPreviewOpen(true) }}
      />
      {isRegenerating ? (
        <div className="dsh-ig-regenerate-overlay">
          <div className="dsh-ig-regenerate-spinner" />
          <span className="dsh-ig-regenerate-overlay-text">{t('regenerating')}</span>
          <button type="button" className="dsh-ig-regenerate-overlay-cancel" onClick={cancelRegenerate}>
            {t('cancel')}
          </button>
        </div>
      ) : null}
      <div className="dsh-ig-toolbar">
        {canRegenerate ? <button type="button" className="dsh-ig-tool-btn" disabled={isRegenerating} title={isRegenerating ? t('regenerating') : t('regenerate')} onClick={openRegenerate}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/></svg>
        </button> : null}
        <button type="button" className="dsh-ig-tool-btn" title={t('copyImg')} onClick={(e) => { void copy(e) }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button type="button" className="dsh-ig-tool-btn" title={t('download')} onClick={download}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button type="button" className="dsh-ig-tool-btn" title={t('openNewTab')} onClick={openNewTab}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </button>
        {toast ? <div className="dsh-ig-toast">{toast}</div> : null}
      </div>
      {versionTotal > 1 ? <div className="dsh-ig-version-nav" aria-label={t('versionLabel', { current: String(versionCurrent), total: String(versionTotal) })}>
        <button type="button" title={t('versionPrevious')} disabled={revisionChain.currentIndex === 0 || isRegenerating} onClick={(event) => { event.stopPropagation(); selectVersion(revisionChain.currentIndex - 1) }}>‹</button>
        <span className="dsh-ig-version-count">{versionCurrent}/{versionTotal}</span>
        <button type="button" title={t('versionNext')} disabled={revisionChain.currentIndex >= revisionChain.revisions.length || isRegenerating} onClick={(event) => { event.stopPropagation(); selectVersion(revisionChain.currentIndex + 1) }}>›</button>
      </div> : null}
    </div> : null}

    {previewOpen && url !== undefined ? <div className="dsh-ig-lightbox-backdrop" onClick={() => { setPreviewOpen(false) }}>
      <div className="dsh-ig-lightbox-img-wrap" onClick={(e) => { e.stopPropagation() }}>
        <img
          className="dsh-ig-lightbox-img"
          src={url}
          alt={activeAttachment?.name ?? 'Generated image preview'}
        />
      </div>
    </div> : null}
    {regenerateOpen && activeResult !== undefined ? <div className="dsh-ig-regenerate-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isRegenerating) setRegenerateOpen(false)
    }}>
      <div className="dsh-ig-regenerate-dialog" role="dialog" aria-modal="true" aria-labelledby={`dsh-ig-regenerate-${String(originId)}`}>
        <h3 id={`dsh-ig-regenerate-${String(originId)}`}>{t('regenerateTitle')}</h3>
        <p>{t('regenerateHint')}</p>
        <label>
          <span>{t('prompt')}</span>
          <textarea
            ref={regenerateTextareaRef}
            value={regeneratePrompt}
            maxLength={2000}
            disabled={isRegenerating}
            onChange={(event) => setRegeneratePrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void regenerate()
              }
            }}
          />
        </label>
        {regenerateError ? <p className="dsh-ig-regenerate-error" role="alert">{regenerateError}</p> : null}
        <div className="dsh-ig-regenerate-actions">
          <button type="button" className="dsh-ig-regenerate-cancel" onClick={cancelRegenerate}>{t('cancel')}</button>
          <button type="button" className="dsh-ig-regenerate-confirm" disabled={isRegenerating || regeneratePrompt.trim().length === 0} onClick={() => { void regenerate() }}>
            {t('confirmRegenerate')}
          </button>
        </div>
      </div>
    </div> : null}
  </section>
}

function usePluginLanguage(locale: LocaleService | undefined): 'en' | 'zh' {
  const [lang, setLang] = useState<'en' | 'zh'>(() => locale?.getSnapshot?.()?.active?.startsWith('en') ? 'en' : 'zh')
  useEffect(() => locale?.subscribe?.(() => {
    setLang(locale?.getSnapshot?.()?.active?.startsWith('en') ? 'en' : 'zh')
  }), [locale])
  return lang
}

function imageResultFromBlock(block: ToolCallBlock): ImageResultPresentation | undefined {
  const attachment = imageRef(block)
  if (attachment === undefined) return undefined
  const blockValue = block as unknown as {
    meta?: Record<string, unknown>
    resultView?: { meta?: Record<string, unknown> }
    call?: { args?: { prompt?: string } }
  }
  const meta = blockValue.meta ?? blockValue.resultView?.meta
  return {
    attachment,
    prompt: typeof meta?.prompt === 'string' ? meta.prompt : blockValue.call?.args?.prompt ?? 'Generated Image',
    provider: typeof meta?.provider === 'string' ? meta.provider : 'google',
    model: typeof meta?.model === 'string' ? meta.model : '',
    output: typeof meta?.output === 'string' ? meta.output : '',
    ...(typeof meta?.savedTo === 'string' ? { savedTo: meta.savedTo } : {}),
    ...(typeof meta?.seed === 'number' ? { seed: meta.seed } : {}),
  }
}

/** One channel card as drafted in the settings form. */
interface ChannelDraft {
  id: string
  provider: Provider
  baseURL: string
  apiKeyEnv: string
  models: string[]
  /** Key typed but not yet stored; travels through credentials/set on save. */
  keyInput: string
  open: boolean
}

/** The fetch-and-confirm modal state. */
interface ModelPickerState {
  channelId: string
  provider: Provider
  baseURL: string
  apiKey: string
  loading: boolean
  error: string
  models: Array<{ id: string; image: boolean }>
  checked: string[]
}

/**
 * The conversation-header image-model picker (Plan B): a pure client shortcut
 * that rewrites the global default channel + model through the settings scope.
 * Session-scoped rendering means one picker per open conversation, but the
 * selection itself is global — no session id, no host round-trip.
 */
function ImageModelPicker(props: { scope: SettingsScope<ImageSettings>; locale?: LocaleService | undefined }) {
  const [snapshot, setSnapshot] = useState(() => props.scope.getSnapshot())
  const [open, setOpen] = useState(false)
  const lang = usePluginLanguage(props.locale)
  useEffect(() => props.scope.subscribe(() => { setSnapshot(props.scope.getSnapshot()) }), [props.scope])

  const dict = lang === 'en' ? DICT.en : DICT.zh
  const labels: Record<Provider, string> = {
    google: dict.providerGoogle,
    openai: dict.providerOpenAI,
    seedream: dict.providerSeedream,
    dashscope: dict.providerDashScope,
    gitee: dict.providerGitee,
    modelscope: dict.providerModelScope,
    antigravity: dict.providerAntigravity,
    comfyui: dict.providerComfyUI,
  }
  const drafts = channelsFromSettings(snapshot.value).filter(channel => channel.models.length > 0)
  if (drafts.length === 0) return null

  const recordedChannel = snapshot.value?.defaultChannelId ?? ''
  const recordedModel = snapshot.value?.defaultModel ?? ''
  const activeChannel = drafts.find(channel => channel.id === recordedChannel) ?? drafts[0]!
  const activeModel = activeChannel.models.includes(recordedModel) ? recordedModel : activeChannel.models[0]!

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
                  <div className="dsh-ig-hmodel-groupTitle">{labels[channel.provider]}</div>
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

/** Draft channels from settings: declared instances, else one synthesized draft from the legacy per-provider fields. */
function channelsFromSettings(value: ImageSettings | undefined): ChannelDraft[] {
  const declared = Array.isArray(value?.channels) ? value.channels : []
  const drafts: ChannelDraft[] = []
  for (const channel of declared) {
    if (channel === null || typeof channel !== 'object') continue
    if (typeof channel.id !== 'string' || channel.id.trim() === '') continue
    if (typeof channel.provider !== 'string' || !(IMAGE_PROVIDERS as readonly string[]).includes(channel.provider)) continue
    drafts.push({
      id: channel.id.trim(),
      provider: channel.provider as Provider,
      baseURL: typeof channel.baseURL === 'string' ? channel.baseURL : '',
      apiKeyEnv: typeof channel.apiKeyEnv === 'string' ? channel.apiKeyEnv : '',
      models: Array.isArray(channel.models) ? channel.models.filter((id): id is string => typeof id === 'string') : [],
      keyInput: '',
      open: false,
    })
  }
  if (drafts.length > 0) return drafts
  // ComfyUI counts as "added" once workflows exist for it; a fresh deployment
  // shows no ComfyUI card at all.
  const comfyWorkflows = resolveComfyUIWorkflows(value ?? {})
  if (comfyWorkflows.length > 0 || value?.provider === 'comfyui') {
    drafts.push({ id: 'comfyui', provider: 'comfyui', baseURL: value?.comfyuiBaseURL ?? DEFAULT_COMFYUI_BASE_URL, apiKeyEnv: '', models: comfyWorkflows.map(entry => entry.name), keyInput: '', open: false })
  }
  if (drafts.length > 0) return drafts
  // Legacy single-provider config: surface it as one visible draft so the
  // migration to channel cards is a review, not a rebuild.
  const provider = (value?.provider ?? 'google') as Provider
  if (provider === 'comfyui') return []
  return [{ id: provider, provider, baseURL: baseURLOf(provider, value), apiKeyEnv: '', models: modelsListOf(provider, value), keyInput: '', open: false }]
}

/** The settings key holding the agent-selectable model list for one provider. */
function modelsKeyOf(provider: Provider): 'googleModels' | 'openaiModels' | 'seedreamModels' | 'dashscopeModels' | 'giteeModels' | 'modelscopeModels' | 'antigravityModels' {
  switch (provider) {
    case 'google': return 'googleModels'
    case 'openai': return 'openaiModels'
    case 'seedream': return 'seedreamModels'
    case 'gitee': return 'giteeModels'
    case 'modelscope': return 'modelscopeModels'
    case 'antigravity': return 'antigravityModels'
    default: return 'dashscopeModels'
  }
}

/** The saved agent-selectable model list for one provider. */
function modelsListOf(provider: Provider, value: ImageSettings | undefined): string[] {
  const stored = value === undefined ? undefined : value[modelsKeyOf(provider)]
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []
}

function baseURLOf(provider: Provider, value: ImageSettings | undefined): string {
  const stored = provider === 'google' ? value?.googleEndpoint : provider === 'openai' ? value?.openaiBaseURL : provider === 'seedream' ? value?.seedreamBaseURL : provider === 'dashscope' ? value?.dashscopeEndpoint : provider === 'gitee' ? value?.giteeBaseURL : provider === 'modelscope' ? value?.modelscopeBaseURL : provider === 'antigravity' ? value?.antigravityBaseURL : value?.comfyuiBaseURL
  return typeof stored === 'string' && stored.length > 0 ? stored : DEFAULT_BASE_URLS[provider]
}
