import {
  CLOUD_IMAGE_PROVIDERS,
  type CloudImageProvider,
  type StudioGenerateRequest,
} from '../shared.js'
import { giteeRatioOf } from '../vocab.js'

export interface RegeneratableImage {
  provider: string
  model: string
  output?: string | undefined
}

/** Build the workbench request that reproduces a conversation image with an edited prompt. */
export function conversationRegenerateRequest(
  image: RegeneratableImage,
  prompt: string,
  remembered?: { ratio: string; quality: string } | undefined,
): StudioGenerateRequest {
  if (!(CLOUD_IMAGE_PROVIDERS as readonly string[]).includes(image.provider)) {
    throw new Error('当前图片使用的 Provider 暂不支持重新生成')
  }
  const provider = image.provider as CloudImageProvider
  const settings = remembered ?? outputSettings(provider, image.output)
  return {
    mode: 'generate',
    provider,
    model: image.model,
    prompt: prompt.trim(),
    ratio: settings.ratio,
    quality: settings.quality,
  }
}

function outputSettings(provider: CloudImageProvider, output?: string | undefined): { ratio: string; quality: string } {
  const normalized = (output ?? '').trim()
  if (provider === 'google') {
    const [rawRatio, rawQuality] = normalized.split(',').map(value => value.trim())
    return {
      ratio: isRatio(rawRatio) ? rawRatio : '1:1',
      quality: rawQuality === '1K' || rawQuality === '2K' || rawQuality === '4K' ? rawQuality : '1K',
    }
  }
  if (provider === 'seedream') {
    return { ratio: 'auto', quality: normalized === '1K' || normalized === '4K' ? normalized : '2K' }
  }
  if (provider === 'gitee' || provider === 'modelscope' || provider === 'antigravity') {
    // ModelScope and Antigravity share the preset vocabulary with Gitee (same "WxH" values);
    // free-form sizes reverse-map to the nearest shared ratio. Output may
    // carry translation notes after " — "; the size token comes first.
    const size = normalized.split(' — ')[0]?.trim() ?? ''
    const reversed = giteeRatioOf(size)
    return { ratio: reversed.ratio, quality: reversed.quality }
  }
  if (provider === 'openai') {
    return { ratio: ratioFromSize(normalized, 'x'), quality: 'standard' }
  }
  return { ratio: ratioFromSize(normalized, '*'), quality: 'standard' }
}

function ratioFromSize(size: string, separator: 'x' | '*'): string {
  const sizes: Record<string, string> = separator === 'x'
    ? {
        '1024x1024': '1:1', '2048x2048': '1:1',
        '1536x1024': '3:2', '1920x1280': '3:2',
        '1024x1536': '2:3', '1280x1920': '2:3',
        '1360x1024': '4:3', '1792x1344': '4:3',
        '1024x1360': '3:4', '1344x1792': '3:4',
        '1792x1024': '16:9', '1920x1088': '16:9',
        '1024x1792': '9:16', '1088x1920': '9:16',
      }
    : { '1024*1024': '1:1', '1536*1024': '3:2', '1024*1536': '2:3', '1664*928': '16:9', '928*1664': '9:16' }
  return sizes[size] ?? '1:1'
}

function isRatio(value: string | undefined): value is string {
  return value === '1:1' || value === '3:2' || value === '2:3' || value === '4:3' || value === '3:4' || value === '16:9' || value === '9:16'
}
