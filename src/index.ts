/** Multi-provider image-generation Bundle for DeepSeek Harness. */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import * as dshSettings from '@deepseek-ai/dsh-settings'
import { defineTool, type ToolResult } from '@deepseek-ai/dsh-tools'
import { Config, channelProfile, resolveAgentSelection, resolveProvider, selectComfyUIWorkflow, withProviderModel, type ImageProvider } from './config.js'
import { editComfyUIImage, generateComfyUIImage } from './comfyui.js'
import { editDashScopeImage, generateDashScopeImage } from './dashscope.js'
import { editGiteeImage, generateGiteeImage } from './gitee.js'
import { generateModelScopeImage } from './modelscope.js'
import { editGoogleImage, generateGoogleImage } from './google.js'
import { IMAGE_ROUTE, DELETE_ROUTE, SAVE_WORKSPACE_ROUTE, imageAttachmentFromMeta, serveImage, serveDelete, serveSaveWorkspace } from './image-route.js'
import { MODELS_ROUTE, serveModels } from './models-route.js'
import { editOpenAICompatibleImage, generateOpenAICompatibleImage } from './openai-compatible.js'
import { resolveReferenceImages } from './reference-image.js'
import { editSeedreamImage } from './seedream.js'
import { IMAGE_GENERATION_NAMESPACE, INSPIRATION_ROUTE, STUDIO_ROUTE, mergeComfyUIPrompt } from './shared.js'
import { createInspirationRoute } from './inspiration-route.js'
import { generateFromStudio, describeStudio } from './studio.js'
import { serveStudio } from './studio-route.js'
import { toPng } from './png.js'
import { deleteImageFromWorkspace, getDshWorkspaceRoots, getDshWorkspacesFull, saveImageToWorkspace } from './workspace-save.js'
import { antigravityQuality, googleAspect, googleSize, normalizeQuality, normalizeRatio, parseResolution, planLabel, seedreamTier, translateAntigravitySize, translateDashScopeSize, translateGiteeSize, translateModelScopeSize, translateOpenAICompatibleSize } from './vocab.js'

export { Config } from './config.js'
export { IMAGE_ROUTE, DELETE_ROUTE, SAVE_WORKSPACE_ROUTE, imageAttachmentFromMeta } from './image-route.js'
export { STUDIO_ROUTE } from './shared.js'
export { INSPIRATION_ROUTE } from './shared.js'

export const name = 'dsh-image-gen'
export const inject = ['tools', 'attachments', 'credentials', 'webServer']

interface GeneratedValue {
  attachment: ImageAttachmentRef
  provider: ImageProvider
  model: string
  output: string
  /** Channel instance that produced the image; provenance for faithful regeneration. */
  channelId?: string
  /** Size adjustments the translation layer made (clamps, nearest mappings). */
  notes?: string
  savedTo?: string
  saveError?: string
  /** Concrete workflow seed, exposed by the ComfyUI provider for provenance. */
  seed?: number
}

export function apply(ctx: Context, config: Config = {}): void {
  let current: () => Config = () => config
  const knownWorkspaceRoots = new Set<string>()

  installImageSettings(ctx, config, {
    setSource: source => { current = source }, onChange: () => {},
  })
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: IMAGE_ROUTE,
    handler: (req, res) => serveImage(req, res, { readImage: ref => ctx.attachments.readImage(ref) }),
  }), 'dsh-image-gen: image route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: DELETE_ROUTE,
    handler: (req, res) => serveDelete(req, res, {
      deleteWorkspaceImage: async filePath => {
        const discovered = await getDshWorkspaceRoots().catch(() => [])
        return deleteImageFromWorkspace(filePath, new Set([...knownWorkspaceRoots, ...discovered, process.cwd()]))
      },
    }),
  }), 'dsh-image-gen: delete route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: SAVE_WORKSPACE_ROUTE,
    handler: (req, res) => serveSaveWorkspace(req, res, {
      readImage: ref => ctx.attachments.readImage(ref),
      saveToWorkspace: options => {
        if (options.workspaceRoot) {
          knownWorkspaceRoots.add(options.workspaceRoot)
        }
        return saveImageToWorkspace({
          workspaceRoot: options.workspaceRoot,
          folder: current().workspaceFolder,
          attachmentId: options.attachmentId,
          mediaType: options.mediaType,
          data: options.data,
        })
      },
      getActiveWorkspaceRoot: () => Array.from(knownWorkspaceRoots)[0] || process.cwd(),
      getAllowedWorkspaceRoots: async () => {
        const discovered = await getDshWorkspaceRoots().catch(() => [])
        return new Set([...knownWorkspaceRoots, ...discovered, process.cwd()])
      },
      isSaveEnabled: () => current().saveToWorkspace !== false,
    }),
  }), 'dsh-image-gen: save workspace route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: STUDIO_ROUTE,
    handler: (req, res) => serveStudio(req, res, {
      describe: async () => {
        const base = await describeStudio(ctx, current())
        const workspaces = await getDshWorkspacesFull().catch(() => [])
        const activeRoot = Array.from(knownWorkspaceRoots)[0] || workspaces[0]?.path || process.cwd()
        return {
          ...base,
          workspaceRoot: activeRoot,
          workspaces,
        }
      },
      generate: (input, signal) => {
        const fallbackRoot = Array.from(knownWorkspaceRoots)[0] || process.cwd()
        return generateFromStudio(ctx, current(), input, signal, fallbackRoot)
      },
      maxBodyBytes: Math.ceil(ctx.attachments.imageLimits.maxImageBytes * 1.4 * 5) + 256 * 1024,
    }),
  }), 'dsh-image-gen: studio route')
  const serveInspiration = createInspirationRoute()
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: INSPIRATION_ROUTE,
    handler: (req, res) => {
      const originalUrl = req.url ?? '/'
      req.url = originalUrl.startsWith(INSPIRATION_ROUTE) ? originalUrl.slice(INSPIRATION_ROUTE.length) || '/' : originalUrl
      return serveInspiration(req, res)
    },
  }), 'dsh-image-gen: inspiration route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: MODELS_ROUTE,
    handler: (req, res) => serveModels(req, res, {
      resolveCredential: async credentialEnv => ctx.credentials.resolve(credentialRef(credentialEnv)),
    }),
  }), 'dsh-image-gen: models route')

  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate a new image with the configured image channels (Google Gemini, OpenAI, Seedream, DashScope, Gitee AI, ModelScope, or a local ComfyUI workflow). Use when the user asks to create or draw a new image; use edit_image instead when they want to change an existing image. Speak only aspect_ratio and quality — the plugin translates them into channel-legal parameters; pass resolution only when the user demands exact pixels. Omit channel and model to use the configured default; pass model (and channel when needed) only when the user names a specific one — unknown names fail with the closest option list. Give a complete visual prompt including subject, composition, style, lighting, and any exact text that should appear. A successful image is attached directly to the conversation and may also be saved under the session workspace. Do not call read, glob, or other tools to locate or verify the image.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Complete description of the image to generate.' },
      channel: { type: 'string', description: 'Optional image channel: google, openai, seedream, dashscope, gitee, or comfyui. Omit when only one channel is configured; ambiguous calls fail with the full option list.' },
      model: { type: 'string', description: 'Optional model on the chosen channel (for comfyui this is the workflow name). Omit when only one model is configured; ambiguous calls fail with the full option list.' },
      aspect_ratio: { type: 'string', enum: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'], description: 'Output aspect ratio. Map the user request to the nearest standard value; use auto only when they expressed none.' },
      quality: { type: 'string', enum: ['auto', '1K', '2K', '4K'], description: 'Quality tier: 1K, 2K, 4K, or auto when the user expressed none.' },
      resolution: { type: 'string', description: 'Optional exact pixel resolution "WxH" (for example 864x1152) when the user demands specific dimensions; each channel converts it into a legal request. Prefer aspect_ratio otherwise.' },
      workflow: { type: 'string', description: 'Legacy alias of model for the ComfyUI channel; omit to use the active workflow from settings.' },
    },
    output: imageOutput('Generated'),
    async execute(args, exec): Promise<GeneratedValue> {
      const config = current()
      const selection = resolveAgentSelection(config, args.channel, args.model)
      const channel = selection.channel
      if (channel.provider === 'comfyui') {
        const comfy = resolveProvider(channelProfile(config, channel))
        if (comfy.provider !== 'comfyui') throw new Error('ComfyUI channel could not be resolved')
        const workflow = selectComfyUIWorkflow(comfy, firstNonEmptyString(args.model, args.workflow))
        const generated = await generateComfyUIImage({
          baseURL: comfy.baseURL,
          workflowJson: workflow.json,
          prompt: mergeComfyUIPrompt(workflow.presetPrompt, args.prompt),
          timeoutMs: comfy.timeoutMs,
          maxBytes: ctx.attachments.imageLimits.maxImageBytes,
          signal: exec.signal,
        })
        return saveGenerated(ctx, generated, 'comfyui', workflow.name, 'API workflow', config, exec, knownWorkspaceRoots, undefined, channel.id)
      }
      const model = selection.model
      const active = resolveProvider(channelProfile(config, channel, model))
      if (active.provider === 'comfyui') throw new Error('ComfyUI channel could not be resolved')
      const credentialEnv = channel.apiKeyEnv !== undefined && channel.apiKeyEnv.trim() !== '' ? channel.apiKeyEnv.trim() : active.apiKeyEnv
      const credential = await ctx.credentials.resolve(credentialRef(credentialEnv))
      if (credential === undefined || credential.value.length === 0) {
        throw new Error(`${channel.label} (channel ${channel.id}) requires the ${credentialEnv} credential; configure it in Settings > Image generation.`)
      }
      const ratio = normalizeRatio(args.aspect_ratio)
      const quality = normalizeQuality(args.quality)
      const resolution = parseResolution(args.resolution)
      if (active.provider === 'google') {
        const aspectRatio = googleAspect(ratio)
        const imageSize = googleSize(quality)
        const generated = await generateGoogleImage({ apiKey: credential.value, endpoint: active.endpoint, model: active.model, prompt: args.prompt, aspectRatio, imageSize, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, 'google', active.model, `${aspectRatio}, ${imageSize}`, config, exec, knownWorkspaceRoots, undefined, channel.id)
      }
      if (active.provider === 'gitee') {
        const plan = translateGiteeSize(active.model, ratio, quality, resolution)
        const generated = await generateGiteeImage({ apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: args.prompt, plan, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, 'gitee', active.model, planLabel(plan), config, exec, knownWorkspaceRoots, plan.notes, channel.id)
      }
      if (active.provider === 'modelscope') {
        const plan = translateModelScopeSize(active.model, ratio, quality, resolution)
        const generated = await generateModelScopeImage({ apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: args.prompt, plan, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, 'modelscope', active.model, planLabel(plan), config, exec, knownWorkspaceRoots, plan.notes, channel.id)
      }
      if (active.provider === 'antigravity') {
        const plan = translateAntigravitySize(ratio, resolution)
        const generated = await generateOpenAICompatibleImage({ provider: 'antigravity', apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: args.prompt, size: plan.size, quality: antigravityQuality(quality), maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, 'antigravity', active.model, planLabel(plan), config, exec, knownWorkspaceRoots, plan.notes, channel.id)
      }
      if (active.provider === 'dashscope') {
        const plan = translateDashScopeSize(ratio, resolution)
        const size = plan.size ?? '1024*1024'
        const generated = await generateDashScopeImage({ apiKey: credential.value, endpoint: active.endpoint, model: active.model, prompt: args.prompt, size, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, 'dashscope', active.model, size, config, exec, knownWorkspaceRoots, plan.notes, channel.id)
      }
      if (active.provider === 'seedream') {
        const tier = seedreamTier(quality)
        const generated = await generateOpenAICompatibleImage({ provider: 'seedream', apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: args.prompt, size: tier, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, 'seedream', active.model, tier, config, exec, knownWorkspaceRoots, undefined, channel.id)
      }
      if (active.provider === 'openai') {
        const plan = translateOpenAICompatibleSize(active.model, ratio, quality, resolution)
        const generated = await generateOpenAICompatibleImage({ provider: 'openai', apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: args.prompt, size: plan.size, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, 'openai', active.model, planLabel(plan), config, exec, knownWorkspaceRoots, plan.notes, channel.id)
      }
      throw new Error('Image channel could not be resolved')
    },
    presentResult: (_args, result) => imagePresentation(result),
  }))

  ctx.tools.register(defineTool({
    name: 'edit_image',
    description: 'Edit, combine, or restyle existing images with the configured image channels (Google Gemini, OpenAI, Seedream, DashScope, Gitee AI, or a local ComfyUI workflow). Images attached inline to the latest human message are already readable DSH attachments even when no workspace file exists. In that case, call edit_image immediately with prompt only; NEVER call read_image, glob, or shell to locate them, and NEVER invent @ paths. All inline images will be used in upload order. For specific older conversation images use source_attachment_id or source_attachment_ids; both canonical sha256: IDs and full bare SHA-256 digests are accepted. For files the user explicitly names in the workspace use source_path or source_paths. Provide exactly one selector field. Without a selector, images from the latest human message take priority; only when that message has no images does editing fall back to the newest conversation image. Speak only aspect_ratio and quality; pass resolution only when the user demands exact pixels. Omit channel and model to use the configured default; pass model (and channel when needed) only when the user names a specific one.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Describe the changes to make while preserving everything else that should remain.' },
      source_attachment_id: { type: 'string', description: 'Optional attachment id of a specific image already present in the current conversation.' },
      source_attachment_ids: { type: 'array', items: { type: 'string' }, description: 'Optional ordered attachment ids of multiple images already present in the current conversation. Prompt references such as image 1 and image 2 follow this order.' },
      source_path: { type: 'string', description: 'Optional absolute or workspace-relative path of a specific image file inside the active session workspace. Prefer this when the user names a saved file.' },
      source_paths: { type: 'array', items: { type: 'string' }, description: 'Optional ordered absolute or workspace-relative paths of multiple image files inside the active session workspace.' },
      channel: { type: 'string', description: 'Optional image channel: google, openai, seedream, dashscope, gitee, or comfyui. Omit when only one channel is configured; ambiguous calls fail with the full option list.' },
      model: { type: 'string', description: 'Optional model on the chosen channel (for comfyui this is the workflow name). Omit when only one model is configured; ambiguous calls fail with the full option list.' },
      aspect_ratio: { type: 'string', enum: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'], description: 'Output aspect ratio. Map the user request to the nearest standard value; use auto only when they expressed none.' },
      quality: { type: 'string', enum: ['auto', '1K', '2K', '4K'], description: 'Quality tier: 1K, 2K, 4K, or auto when the user expressed none.' },
      resolution: { type: 'string', description: 'Optional exact pixel resolution "WxH" when the user demands specific dimensions; each channel converts it into a legal request. Prefer aspect_ratio otherwise.' },
      workflow: { type: 'string', description: 'Legacy alias of model for the ComfyUI channel; omit to use the active workflow from settings.' },
    },
    output: imageOutput('Edited'),
    async execute(args, exec): Promise<GeneratedValue> {
      const config = current()
      const selection = resolveAgentSelection(config, args.channel, args.model)
      const channel = selection.channel
      const sourceImages = await resolveReferenceImages({
        ...(exec.agent === undefined ? {} : { agent: exec.agent }),
        attachments: ctx.attachments,
        ...(typeof args.source_attachment_id === 'string' ? { sourceAttachmentId: args.source_attachment_id } : {}),
        ...(Array.isArray(args.source_attachment_ids) ? { sourceAttachmentIds: args.source_attachment_ids } : {}),
        ...(typeof args.source_path === 'string' ? { sourcePath: args.source_path } : {}),
        ...(Array.isArray(args.source_paths) ? { sourcePaths: args.source_paths } : {}),
        maxBytes: ctx.attachments.imageLimits.maxImageBytes,
        signal: exec.signal,
      })

      if (channel.provider === 'comfyui') {
        if (sourceImages.length > 1) {
          throw new Error(`ComfyUI edit_image supports exactly one source image per call; this call resolved ${String(sourceImages.length)} images. Call edit_image again with source_attachment_id set to the single attachment ID of the image to edit.`)
        }
        const sourceImage = sourceImages[0]
        if (sourceImage === undefined) throw new Error('edit_image requires a reference image')
        const comfy = resolveProvider(channelProfile(config, channel))
        if (comfy.provider !== 'comfyui') throw new Error('ComfyUI channel could not be resolved')
        const workflow = selectComfyUIWorkflow(comfy, firstNonEmptyString(args.model, args.workflow))
        const generated = await editComfyUIImage({
          baseURL: comfy.baseURL,
          workflowJson: workflow.json,
          prompt: mergeComfyUIPrompt(workflow.presetPrompt, args.prompt),
          sourceImage: { data: sourceImage.data, mediaType: sourceImage.mediaType },
          timeoutMs: comfy.timeoutMs,
          maxBytes: ctx.attachments.imageLimits.maxImageBytes,
          signal: exec.signal,
        })
        return saveGenerated(ctx, generated, 'comfyui', workflow.name, 'API workflow', config, exec, knownWorkspaceRoots, undefined, channel.id)
      }

      const model = selection.model
      const active = resolveProvider(channelProfile(config, channel, model))
      if (active.provider === 'comfyui') throw new Error('ComfyUI channel could not be resolved')
      const credentialEnv = channel.apiKeyEnv !== undefined && channel.apiKeyEnv.trim() !== '' ? channel.apiKeyEnv.trim() : active.apiKeyEnv
      const credential = await ctx.credentials.resolve(credentialRef(credentialEnv))
      if (credential === undefined || credential.value.length === 0) {
        throw new Error(`${channel.label} (channel ${channel.id}) requires the ${credentialEnv} credential; configure it in Settings > Image generation.`)
      }
      const ratio = normalizeRatio(args.aspect_ratio)
      const quality = normalizeQuality(args.quality)
      const resolution = parseResolution(args.resolution)
      if (active.provider === 'google') {
        const aspectRatio = googleAspect(ratio)
        const imageSize = googleSize(quality)
        const generated = await editGoogleImage({ apiKey: credential.value, endpoint: active.endpoint, model: active.model, prompt: args.prompt, sourceImages, aspectRatio, imageSize, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, 'google', active.model, `${aspectRatio}, ${imageSize}`, config, exec, knownWorkspaceRoots, undefined, channel.id)
      }
      if (active.provider === 'gitee') {
        const plan = translateGiteeSize(active.model, ratio, quality, resolution)
        const generated = await editGiteeImage({ apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: args.prompt, sourceImages, plan, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, 'gitee', active.model, planLabel(plan), config, exec, knownWorkspaceRoots, plan.notes, channel.id)
      }
      if (active.provider === 'modelscope') {
        throw new Error('ModelScope 渠道暂不支持图生图（编辑协议尚未验证）；请换一个支持编辑的渠道，或反馈让我补充验证。')
      }
      if (active.provider === 'dashscope') {
        const plan = translateDashScopeSize(ratio, resolution)
        const size = plan.size ?? '1024*1024'
        const generated = await editDashScopeImage({ apiKey: credential.value, endpoint: active.endpoint, model: active.model, prompt: args.prompt, sourceImages, size, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, 'dashscope', active.model, size, config, exec, knownWorkspaceRoots, plan.notes, channel.id)
      }
      if (active.provider === 'seedream') {
        const tier = seedreamTier(quality)
        const generated = await editSeedreamImage({ apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: args.prompt, sourceImages, size: tier, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, 'seedream', active.model, tier, config, exec, knownWorkspaceRoots, undefined, channel.id)
      }
      if (active.provider === 'antigravity') {
        const plan = translateAntigravitySize(ratio, resolution)
        const generated = await editOpenAICompatibleImage({ apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: args.prompt, sourceImages, ...(plan.size !== undefined ? { size: plan.size } : {}), maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, 'antigravity', active.model, planLabel(plan), config, exec, knownWorkspaceRoots, plan.notes, channel.id)
      }
      if (active.provider === 'openai') {
        const plan = translateOpenAICompatibleSize(active.model, ratio, quality, resolution)
        const generated = await editOpenAICompatibleImage({ apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: args.prompt, sourceImages, ...(plan.size !== undefined ? { size: plan.size } : {}), maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, 'openai', active.model, planLabel(plan), config, exec, knownWorkspaceRoots, plan.notes, channel.id)
      }
      throw new Error('Image channel could not be resolved')
    },
    presentResult: (_args, result) => imagePresentation(result),
  }))
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

function imageOutput(verb: 'Generated' | 'Edited') {
  return {
    schema: {
      type: 'object', additionalProperties: false, properties: {
        attachment: { type: 'object', required: true, additionalProperties: false, properties: {
          attachmentId: { type: 'string', required: true }, mediaType: { type: 'string', required: true }, bytes: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, name: { type: 'string' }, originalDimensions: { type: 'object', additionalProperties: false, properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } } },
        } },
        provider: { type: 'string', required: true }, model: { type: 'string', required: true }, output: { type: 'string', required: true }, channelId: { type: 'string' }, notes: { type: 'string' }, savedTo: { type: 'string' }, saveError: { type: 'string' }, seed: { type: 'integer' },
      },
    },
    render: (_args: unknown, value: GeneratedValue) => {
      const saved = typeof value.savedTo === 'string' ? ` It was also saved to the workspace as ${value.savedTo}.` : typeof value.saveError === 'string' ? ` Saving it to the workspace failed: ${value.saveError}.` : ' It has no local file path.'
      const notes = typeof value.notes === 'string' && value.notes.length > 0 ? ` Size adjustments: ${value.notes}.` : ''
      const action = verb === 'Generated' ? 'It is already attached to the conversation.' : 'The edited image is attached to the conversation.'
      return [
        { type: 'text' as const, text: `${verb} one image with ${value.provider}/${value.model} (${value.output}).${notes} Attachment ID: ${String(value.attachment.attachmentId)}. ${action}${saved} Respond to the user without reading or searching for the image.` },
        { type: 'image' as const, attachment: value.attachment },
      ]
    },
    presentationMeta: (args: unknown, value: GeneratedValue) => ({
      kind: 'dsh-image-gen', attachment: attachmentMeta(value.attachment), provider: value.provider, model: value.model, output: value.output,
      ...(typeof value.channelId === 'string' ? { channelId: value.channelId } : {}),
      ...(verb === 'Edited' ? { operation: 'edit' } : {}),
      ...(typeof value.savedTo === 'string' ? { savedTo: value.savedTo } : {}),
      ...(typeof value.seed === 'number' ? { seed: value.seed } : {}),
      prompt: (args as { prompt: string }).prompt,
    }),
  } as const
}

function attachmentMeta(ref: ImageAttachmentRef) {
  return {
    attachmentId: String(ref.attachmentId), mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height,
    ...(ref.name === undefined ? {} : { name: ref.name }),
    ...(ref.originalDimensions === undefined ? {} : { originalDimensions: { width: ref.originalDimensions.width, height: ref.originalDimensions.height } }),
  }
}

async function saveGenerated(
  ctx: Context,
  generated: { data: Uint8Array; mediaType: ImageAttachmentRef['mediaType']; seed?: number },
  provider: ImageProvider,
  model: string,
  output: string,
  config: Config,
  exec: { agent?: { session: { header: { cwd?: string } } }; signal: AbortSignal },
  knownRoots?: Set<string>,
  notes?: string[],
  channelId?: string,
): Promise<GeneratedValue> {
  // Persist every channel's output as a uniform PNG so downstream files match
  // (JPEG/WebP returned by some proxies are re-encoded to PNG here).
  const png = await toPng(generated.data, generated.mediaType)
  const data = png.data
  const mediaType = png.mediaType
  if (!ctx.attachments.imageLimits.mediaTypes.includes(mediaType)) throw new Error(`This DSH deployment does not accept ${mediaType} generated images`)
  const attachment = await ctx.attachments.saveImage({ data, mediaType, name: 'generated-image' })
  const value: GeneratedValue = {
    attachment, provider, model, output,
    ...(notes !== undefined && notes.length > 0 ? { notes: notes.join('; ') } : {}),
    ...(typeof channelId === 'string' ? { channelId } : {}),
    ...(typeof generated.seed === 'number' ? { seed: generated.seed } : {}),
  }
  if (config.saveToWorkspace === false) return value
  const workspaceRoot = exec.agent?.session.header.cwd
  if (workspaceRoot === undefined) return value
  knownRoots?.add(workspaceRoot)
  try {
    value.savedTo = await saveImageToWorkspace({ workspaceRoot, folder: config.workspaceFolder, attachmentId: attachment.attachmentId, mediaType, data, signal: exec.signal })
  } catch (error) {
    exec.signal.throwIfAborted()
    ctx.logger.warn(`dsh-image-gen: failed to save image to workspace: ${error instanceof Error ? error.message : String(error)}`)
    value.saveError = error instanceof Error ? error.message : String(error)
  }
  return value
}

function imagePresentation(result: ToolResult) {
  const attachment = imageAttachmentFromMeta(result.meta)
  return attachment === undefined ? undefined : { card: 'generic' as const, title: 'Generated image', content: [{ type: 'image' as const, attachment }] }
}

/** Settings hooks shape shared by both dsh-settings API generations. */
interface SettingsHooks {
  setSource: (source: () => Config) => void
  onChange: () => void
}

/** Top-level relay functions exported by dsh-settings <= 0.1.1-rc.2. */
interface LegacySettingsApi {
  installSettingsSection?: {
    (ctx: Context, ns: unknown, schema: unknown, entry: unknown, hooks: SettingsHooks): void
  }
  settingsNamespace?: (value: string) => unknown
}

/**
 * Wire the settings namespace across both dsh-settings API generations.
 * A namespace import keeps module loading safe on either version; the branch
 * picks the service method (0.1.2+) or the legacy top-level relay (<= rc.2),
 * and falls back to the composition entry with a warning when neither exists
 * so an incompatible host degrades the settings UI instead of failing boot.
 */
function installImageSettings(ctx: Context, config: Config, hooks: SettingsHooks): void {
  const namespace = dshSettings as typeof dshSettings & LegacySettingsApi
  // Runtime probe, not compile-time presence: the host decides which API
  // generation is live, whichever dsh-settings this bundle was typed against.
  const modern = namespace.SettingsProvider?.prototype?.installSection
  if (typeof modern === 'function') {
    // The injected context is typed by the current dsh-settings, whose module
    // extension already declares the `settings` service on Context.
    ctx.inject(['settings'], (settingsCtx: Context) => {
      settingsCtx.settings.installSection(ctx, IMAGE_GENERATION_NAMESPACE, Config, config, hooks)
    })
    return
  }
  const legacyInstall = namespace.installSettingsSection
  const legacyNamespace = namespace.settingsNamespace
  if (typeof legacyInstall === 'function' && typeof legacyNamespace === 'function') {
    legacyInstall(ctx, legacyNamespace(IMAGE_GENERATION_NAMESPACE), Config, config, hooks)
    return
  }
  ctx.logger.warn('dsh-image-gen: this DSH exposes neither settings API generation; settings UI stays on the composition entry')
}
