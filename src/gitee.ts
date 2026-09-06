/**
 * Gitee AI (ai.gitee.com) open-platform image adapter.
 *
 * OpenAI-shaped endpoints with two Gitee-specific twists: size may travel as
 * a preset `size` string OR as raw `width`/`height` fields (which the server
 * resolves before the size enum), and the platform-wide preset registry in
 * vocab.ts applies to every model family on the channel — z-image, Flux,
 * Kolors, CogView, SD and friends. Response shape is the OpenAI images
 * shape, parsed by the shared tolerant parser.
 */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { parseImageResponse } from './openai-compatible.js'
import type { SizePlan } from './vocab.js'

export interface GeneratedGiteeImage {
  data: Uint8Array
  mediaType: ImageMediaType
}

export interface GiteeReferenceImage {
  data: Uint8Array
  mediaType: ImageMediaType
}

/** Turn a validated SizePlan into Gitee request fields, never both channels at once. */
function planFields(plan: SizePlan): Record<string, string | number> {
  if (plan.kind === 'size' && plan.size !== undefined && plan.size.length > 0) return { size: plan.size }
  if (plan.kind === 'width_height' && plan.width !== undefined && plan.height !== undefined) {
    return { width: Math.round(plan.width), height: Math.round(plan.height) }
  }
  return {}
}

export async function generateGiteeImage(input: {
  apiKey: string
  baseURL: string
  model: string
  prompt: string
  plan: SizePlan
  maxBytes: number
  signal: AbortSignal
  negativePrompt?: string | undefined
  steps?: number | undefined
  guidanceScale?: number | undefined
  seed?: number | undefined
  numImages?: number | undefined
}): Promise<GeneratedGiteeImage> {
  const response = await fetch(giteeEndpoint(input.baseURL, 'generations'), {
    method: 'POST', redirect: 'error', signal: input.signal,
    headers: giteeHeaders(input),
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      ...planFields(input.plan),
      ...(input.negativePrompt !== undefined && input.negativePrompt.trim() !== '' ? { negative_prompt: input.negativePrompt.trim() } : {}),
      ...(input.steps !== undefined ? { num_inference_steps: input.steps } : {}),
      ...(input.guidanceScale !== undefined ? { guidance_scale: input.guidanceScale } : {}),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      ...(input.numImages !== undefined && input.numImages > 1 ? { num_images_per_prompt: input.numImages } : {}),
    }),
  })
  return parseImageResponse(response, 'gitee', input)
}

export async function editGiteeImage(input: {
  apiKey: string
  baseURL: string
  model: string
  prompt: string
  sourceImages: GiteeReferenceImage[]
  plan: SizePlan
  maxBytes: number
  signal: AbortSignal
  negativePrompt?: string | undefined
  seed?: number | undefined
}): Promise<GeneratedGiteeImage> {
  const form = new FormData()
  const imageField = input.sourceImages.length > 1 ? 'image[]' : 'image'
  input.sourceImages.forEach((sourceImage, index) => {
    const uploadBytes = new Uint8Array(sourceImage.data)
    const blob = new Blob([uploadBytes], { type: sourceImage.mediaType })
    const filename = `reference-${index + 1}.${extensionOf(sourceImage.mediaType)}`
    form.append(imageField, blob, filename)
  })
  form.append('prompt', input.prompt)
  form.append('model', input.model)
  for (const [key, value] of Object.entries(planFields(input.plan))) {
    form.append(key, String(value))
  }
  if (input.negativePrompt !== undefined && input.negativePrompt.trim() !== '') form.append('negative_prompt', input.negativePrompt.trim())
  if (input.seed !== undefined) form.append('seed', String(input.seed))

  const response = await fetch(giteeEndpoint(input.baseURL, 'edits'), {
    method: 'POST', redirect: 'error', signal: input.signal,
    headers: { authorization: `Bearer ${input.apiKey.trim()}` },
    body: form,
  })
  return parseImageResponse(response, 'gitee', input)
}

function giteeHeaders(input: { apiKey: string }): Record<string, string> {
  return {
    authorization: `Bearer ${input.apiKey.trim()}`,
    'content-type': 'application/json',
  }
}

function giteeEndpoint(baseURL: string, operation: 'generations' | 'edits'): string {
  try { return new URL(`images/${operation}`, baseURL.endsWith('/') ? baseURL : `${baseURL}/`).toString() } catch { throw new Error('Gitee AI endpoint must be an absolute URL') }
}

function extensionOf(mediaType: ImageMediaType): string {
  switch (mediaType) {
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
    case 'image/png': return 'png'
  }
}
