/** Channel-aware orchestration for the browser image workbench. */
import type { ImageAttachmentRef, ImageMediaType, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import {
  ANTIGRAVITY_API_KEY_ENV,
  DASHSCOPE_API_KEY_ENV,
  GITEE_API_KEY_ENV,
  GOOGLE_API_KEY_ENV,
  MODELSCOPE_API_KEY_ENV,
  OPENAI_API_KEY_ENV,
  SEEDREAM_API_KEY_ENV,
  channelProfile,
  resolveProvider,
  type AspectRatio,
  type Config,
  type ImageSize,
} from './config.js'
import { editDashScopeImage, generateDashScopeImage } from './dashscope.js'
import { generateGiteeImage, editGiteeImage } from './gitee.js'
import { generateModelScopeImage } from './modelscope.js'
import { editGoogleImage, generateGoogleImage } from './google.js'
import { editOpenAICompatibleImage, generateOpenAICompatibleImage } from './openai-compatible.js'
import { editSeedreamImage } from './seedream.js'
import { resolveActiveChannelId, resolveStudioChannel, studioChannels, studioProfileFromChannel } from './studio-profile.js'
import {
  type CloudImageProvider,
  type StudioConfigResponse,
  type StudioGenerateRequest,
  type StudioGenerateResponse,
  type StudioGeneratedItem,
  type StudioProviderProfile,
  type StudioReference,
} from './shared.js'
import { normalizeQuality, normalizeRatio, planLabel, translateAntigravitySize, translateGiteeSize, translateModelScopeSize } from './vocab.js'

const CREDENTIALS: Record<CloudImageProvider, string> = {
  google: GOOGLE_API_KEY_ENV,
  openai: OPENAI_API_KEY_ENV,
  seedream: SEEDREAM_API_KEY_ENV,
  dashscope: DASHSCOPE_API_KEY_ENV,
  gitee: GITEE_API_KEY_ENV,
  modelscope: MODELSCOPE_API_KEY_ENV,
  antigravity: ANTIGRAVITY_API_KEY_ENV,
}

/** Return only browser-safe capability data, keyed by channel instance. */
export async function describeStudio(ctx: Context, config: Config): Promise<StudioConfigResponse> {
  const profiles = await Promise.all(studioChannels(config).map(async channel => {
    const credentialEnv = channel.apiKeyEnv !== undefined && channel.apiKeyEnv.trim() !== ''
      ? channel.apiKeyEnv.trim()
      : CREDENTIALS[channel.provider]
    const credential = await ctx.credentials.resolve(credentialRef(credentialEnv))
    const hasModels = (channel.models ?? []).some(model => typeof model === 'string' && model.trim() !== '')
    const configured = hasModels && credential !== undefined && credential.value.trim().length > 0
    return studioProfileFromChannel(config, channel, configured)
  }))
  return { providers: profiles, activeChannelId: resolveActiveChannelId(config, profiles) }
}

/** Execute one validated browser workbench request using the existing provider adapters. */
export async function generateFromStudio(
  ctx: Context,
  config: Config,
  input: StudioGenerateRequest,
  signal: AbortSignal,
  fallbackWorkspaceRoot?: string | undefined,
): Promise<StudioGenerateResponse> {
  const channel = resolveStudioChannel(config, input.channelId)
  const profile = studioProfileFromChannel(config, channel, true)
  assertAllowed(profile, input)
  const active = resolveProvider(channelProfile(config, channel, input.model))
  // The string comparison covers malformed cast inputs; the typed check lets TS narrow.
  if (active.provider === 'comfyui' || (active.provider as string) !== (channel.provider as string)) throw new Error('Invalid cloud channel profile')
  const credentialEnv = channel.apiKeyEnv !== undefined && channel.apiKeyEnv.trim() !== ''
    ? channel.apiKeyEnv.trim()
    : active.apiKeyEnv
  const credential = await ctx.credentials.resolve(credentialRef(credentialEnv))
  if (credential === undefined || credential.value.trim().length === 0) {
    throw new Error(`${channel.label} 尚未配置 API Key，请先到设置中配置`)
  }

  const rawRefs = input.references ?? (input.reference ? [input.reference] : [])
  if (input.mode === 'edit' && rawRefs.length === 0) {
    throw new Error('图生图需要至少一张参考图')
  }
  const sourceImages = input.mode === 'edit'
    ? await Promise.all(rawRefs.map(ref => readStudioReference(ctx, ref, signal)))
    : []
  const startedAt = Date.now()
  const count = input.count ?? 1

  const generateSingle = async (index: number): Promise<StudioGeneratedItem> => {
    let generated: { data: Uint8Array; mediaType: ImageMediaType }
    let output: string

    if (active.provider === 'google') {
      const aspectRatio = input.ratio as AspectRatio
      const imageSize = input.quality as ImageSize
      generated = input.mode === 'edit'
        ? await editGoogleImage({ apiKey: credential.value, endpoint: active.endpoint, model: active.model, prompt: input.prompt, sourceImages, aspectRatio, imageSize, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal })
        : await generateGoogleImage({ apiKey: credential.value, endpoint: active.endpoint, model: active.model, prompt: input.prompt, aspectRatio, imageSize, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal })
      output = `${aspectRatio}, ${imageSize}`
    } else if (active.provider === 'openai') {
      const size = openAISize(input.ratio)
      generated = input.mode === 'edit'
        ? await editOpenAICompatibleImage({ apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: input.prompt, sourceImages, size, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal })
        : await generateOpenAICompatibleImage({ provider: 'openai', apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: input.prompt, size, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal })
      output = size
    } else if (active.provider === 'gitee') {
      const plan = translateGiteeSize(active.model, normalizeRatio(input.ratio), normalizeQuality(input.quality), undefined)
      generated = input.mode === 'edit'
        ? await editGiteeImage({ apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: input.prompt, sourceImages, plan, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal })
        : await generateGiteeImage({ apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: input.prompt, plan, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal })
      output = planLabel(plan)
    } else if (active.provider === 'modelscope') {
      if (input.mode === 'edit') throw new Error('ModelScope 渠道暂不支持图生图（编辑协议尚未验证）')
      const plan = translateModelScopeSize(active.model, normalizeRatio(input.ratio), normalizeQuality(input.quality), undefined)
      generated = await generateModelScopeImage({ apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: input.prompt, plan, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal })
      output = planLabel(plan)
    } else if (active.provider === 'antigravity') {
      const plan = translateAntigravitySize(normalizeRatio(input.ratio), undefined)
      // Antigravity's quality vocabulary is standard / medium / hd (1K/2K/4K);
      // the Studio profile offers exactly those words.
      const qualityWord = input.quality === 'hd' ? 'hd' : input.quality === 'medium' ? 'medium' : 'standard'
      generated = input.mode === 'edit'
        ? await editOpenAICompatibleImage({ apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: input.prompt, sourceImages, size: plan.size, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal })
        : await generateOpenAICompatibleImage({ provider: 'antigravity', apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: input.prompt, size: plan.size, quality: qualityWord, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal })
      output = planLabel(plan)
    } else if (active.provider === 'seedream') {
      const size = input.quality
      generated = input.mode === 'edit'
        ? await editSeedreamImage({ apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: input.prompt, sourceImages, size, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal })
        : await generateOpenAICompatibleImage({ provider: 'seedream', apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: input.prompt, size, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal })
      output = size
    } else {
      if (input.mode === 'edit' && sourceImages.length > 3) {
        throw new Error('DashScope (通义万相) 图生图目前最多支持 3 张参考图，请精简后重试')
      }
      const size = dashScopeSize(input.ratio)
      generated = input.mode === 'edit'
        ? await editDashScopeImage({ apiKey: credential.value, endpoint: active.endpoint, model: active.model, prompt: input.prompt, sourceImages, size, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal })
        : await generateDashScopeImage({ apiKey: credential.value, endpoint: active.endpoint, model: active.model, prompt: input.prompt, size, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal })
      output = size
    }

    if (!ctx.attachments.imageLimits.mediaTypes.includes(generated.mediaType)) {
      throw new Error(`当前 DSH 不支持保存 ${generated.mediaType} 图片`)
    }
    const attachment = await ctx.attachments.saveImage({
      data: generated.data,
      mediaType: generated.mediaType,
      name: count > 1 ? `studio-image-${index + 1}` : 'studio-image',
    })
    // Studio generation is temporary on canvas; workspace file persistence occurs when user collects to gallery.
    return {
      attachment,
      output,
    }
  }

  if (count === 1) {
    const single = await generateSingle(0)
    return {
      attachment: single.attachment,
      output: single.output,
      channelId: channel.id,
      provider: channel.provider as CloudImageProvider,
      model: input.model,
      prompt: input.prompt,
      createdAt: Date.now(),
      elapsedMs: Date.now() - startedAt,
      requestedCount: 1,
      failedCount: 0,
      items: [single],
      ...(single.savedTo ? { savedTo: single.savedTo } : {}),
    }
  }

  const tasks = Array.from({ length: count }, (_, i) => () => generateSingle(i))
  const poolResults = await runPool(tasks, 2)
  const successes: StudioGeneratedItem[] = []
  const errors: Array<{ index: number; message: string }> = []

  for (let i = 0; i < poolResults.length; i++) {
    const r = poolResults[i]!
    if (r.status === 'fulfilled') {
      successes.push(r.value)
    } else {
      errors.push({
        index: i,
        message: r.reason instanceof Error ? r.reason.message : String(r.reason),
      })
    }
  }

  if (successes.length === 0) {
    const firstReason = poolResults[0] && poolResults[0].status === 'rejected' ? poolResults[0].reason : new Error('批量生图全部失败')
    throw firstReason instanceof Error ? firstReason : new Error(String(firstReason))
  }

  const first = successes[0]!
  return {
    attachment: first.attachment,
    output: first.output,
    channelId: channel.id,
    provider: channel.provider as CloudImageProvider,
    model: input.model,
    prompt: input.prompt,
    createdAt: Date.now(),
    elapsedMs: Date.now() - startedAt,
    requestedCount: count,
    failedCount: errors.length,
    items: successes,
    ...(errors.length > 0 ? { errors } : {}),
    ...(first.savedTo ? { savedTo: first.savedTo } : {}),
  }
}

export async function runPool<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = 2,
): Promise<PromiseSettledResult<T>[]> {
  const results = new Array<PromiseSettledResult<T>>(tasks.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex++
      const task = tasks[currentIndex]!
      try {
        const val = await task()
        results[currentIndex] = { status: 'fulfilled', value: val }
      } catch (err) {
        results[currentIndex] = { status: 'rejected', reason: err }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

function assertAllowed(profile: StudioProviderProfile, input: StudioGenerateRequest): void {
  if (profile.models.length === 0) throw new Error('该渠道尚未配置模型，请到设置中添加后再试')
  if (!profile.models.includes(input.model)) throw new Error('模型配置已变化，请刷新工作台后重试')
  if (!profile.ratioOptions.some(option => option.value === input.ratio)) throw new Error('该渠道不支持所选比例')
  if (!profile.qualityOptions.some(option => option.value === input.quality)) throw new Error('该渠道不支持所选清晰度')
  if (input.mode === 'edit' && !profile.supportsEditing) throw new Error('该渠道暂不支持图生图')
}

async function readStudioReference(
  ctx: Context,
  reference: StudioReference | undefined,
  signal: AbortSignal,
): Promise<{ data: Uint8Array; mediaType: ImageMediaType }> {
  if (reference === undefined) throw new Error('图生图需要至少一张参考图')
  if ('attachment' in reference) {
    const stored: StoredImageAttachment = await ctx.attachments.readImage(reference.attachment, signal)
    return { data: stored.data, mediaType: stored.ref.mediaType }
  }
  const data = decodeCanonicalBase64(reference.data)
  if (data.byteLength > ctx.attachments.imageLimits.maxImageBytes) throw new Error('参考图超过当前 DSH 的大小限制')
  await ctx.attachments.validateImage({ data, mediaType: reference.mediaType, ...(reference.name === undefined ? {} : { name: reference.name }) })
  return { data, mediaType: reference.mediaType }
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error('参考图编码无效')
  const data = Buffer.from(value, 'base64')
  if (data.byteLength === 0 || data.toString('base64') !== value) throw new Error('参考图编码无效')
  return new Uint8Array(data)
}

function openAISize(ratio: string): string {
  if (ratio === '3:2') return '1536x1024'
  if (ratio === '2:3') return '1024x1536'
  return '1024x1024'
}

function dashScopeSize(ratio: string): string {
  const sizes: Record<string, string> = {
    '1:1': '1024*1024',
    '3:2': '1536*1024',
    '2:3': '1024*1536',
    '16:9': '1664*928',
    '9:16': '928*1664',
  }
  return sizes[ratio] ?? '1024*1024'
}
