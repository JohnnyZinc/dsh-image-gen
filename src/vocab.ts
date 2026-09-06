/**
 * Channel-neutral image vocabulary and its per-channel translations.
 *
 * The agent only speaks ratios (`aspect_ratio`), quality tiers (`quality`),
 * and — when the user demands exact pixels — a validated `resolution`. Every
 * channel adapter converts those into its own wire dialect through this
 * module, so no raw size string ever reaches an upstream blindly. Framework
 * free on purpose: host tools, the Studio workbench, regeneration, and tests
 * all share these tables.
 */

export const RATIOS = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'] as const
export const QUALITIES = ['auto', '1K', '2K', '4K'] as const
export type Ratio = (typeof RATIOS)[number]
export type Quality = (typeof QUALITIES)[number]

/** Normalize any incoming aspect-ratio value to one of RATIOS (unknown → auto). */
export function normalizeRatio(value: unknown): Ratio {
  if (typeof value !== 'string') return 'auto'
  const compact = value.trim().toLowerCase().replace(/\s+/g, '')
  if ((RATIOS as readonly string[]).includes(compact)) return compact as Ratio
  return 'auto'
}

/** Normalize any incoming quality tier to one of QUALITIES (unknown → auto). */
export function normalizeQuality(value: unknown): Quality {
  if (typeof value !== 'string') return 'auto'
  const compact = value.trim().toUpperCase().replace(/\s+/g, '')
  if ((QUALITIES as readonly string[]).includes(compact)) return compact as Quality
  return 'auto'
}

export interface PixelResolution { width: number; height: number }

const RESOLUTION_PATTERN = /^(\d{1,5})\s*[xX*×]\s*(\d{1,5})$/

/** Parse an exact "WxH" resolution expression; undefined when not one. */
export function parseResolution(value: unknown): PixelResolution | undefined {
  if (typeof value !== 'string') return undefined
  const match = RESOLUTION_PATTERN.exec(value.trim())
  if (match === null) return undefined
  const width = Number.parseInt(match[1]!, 10)
  const height = Number.parseInt(match[2]!, 10)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined
  if (width < 16 || height < 16 || width > 8192 || height > 8192) return undefined
  return { width, height }
}

/** One channel-legal size outcome plus honesty notes for the output string. */
export interface SizePlan {
  /** How the upstream call carries the size. */
  kind: 'omit' | 'size' | 'width_height'
  size?: string | undefined
  width?: number | undefined
  height?: number | undefined
  /** Human-readable adjustments (clamps, nearest-mapping) made on the way. */
  notes: string[]
}

function omitPlan(notes: string[]): SizePlan {
  return { kind: 'omit', notes }
}

function sizePlan(size: string, notes: string[]): SizePlan {
  return { kind: 'size', size, notes }
}

function widthHeightPlan(width: number, height: number, notes: string[]): SizePlan {
  return { kind: 'width_height', width, height, notes }
}

/** Merge two note lists without duplicates, preserving order. */
function withNotes(notes: string[], extra: string[]): string[] {
  return extra.length === 0 ? notes : [...notes, ...extra.filter(note => !notes.includes(note))]
}

const noteNoSecondTier = "4K is not available on this channel for this ratio; clamped to the 2K preset"
const noteQualityAuto = 'quality auto → 1K preset'
const noteRatioAuto = 'aspect ratio auto → channel default preset'

// ---------------------------------------------------------------------------
// Gitee AI (ai.gitee.com) — server-side preset registry for the z-image family
// and a width/height escape hatch for exact pixel requests.
// ---------------------------------------------------------------------------

/** The 13 size presets Gitee documents for the z-image family. */
export const GITEE_SIZE_PRESETS = [
  '512x512', '1024x1024', '2048x2048',
  '1152x896', '2048x1536',
  '768x1024', '1536x2048',
  '2048x1360', '1360x2048',
  '1024x576', '2048x1152',
  '576x1024', '1152x2048',
] as const

/** z-image family wire table: ratio → [1K preset, 2K preset]. */
const GITEE_Z_WIRE: Record<string, [string, string]> = {
  '1:1': ['1024x1024', '2048x2048'],
  '4:3': ['1152x896', '2048x1536'],
  '3:4': ['768x1024', '1536x2048'],
  '3:2': ['2048x1360', '2048x1360'],
  '2:3': ['1360x2048', '1360x2048'],
  '16:9': ['1024x576', '2048x1152'],
  '9:16': ['576x1024', '1152x2048'],
}

/** Gitee presets whose every dimension stays within 1024 (per-model ceilings). */
export const GITEE_SIZE_PRESETS_1024 = [
  '512x512', '1024x1024',
  '768x1024',
  '1024x576', '576x1024',
] as const

/** Per-model size ceilings observed on the Gitee channel. */
export interface GiteeModelLimits {
  min: number
  max: number
  presets: readonly string[]
}

/**
 * Size limits per Gitee model family. Proven so far: z-image accepts up to
 * 2048 (presets + width/height 512–2048); FLUX.2-dev rejects 1536x2048 and
 * reports its width/height range as 8–1024. Unknown families fall to the
 * conservative 1024 ceiling so unverified models never see an oversized
 * request.
 */
export function giteeModelLimits(model: string): GiteeModelLimits {
  const id = model.trim()
  if (/^z-image(?:[-_.]|$)/i.test(id)) return { min: 512, max: 2048, presets: GITEE_SIZE_PRESETS }
  if (/^flux/i.test(id)) return { min: 8, max: 1024, presets: GITEE_SIZE_PRESETS_1024 }
  return { min: 8, max: 1024, presets: GITEE_SIZE_PRESETS_1024 }
}

/** Reverse map: a Gitee wire size back to the ratio it serves. */
export function giteeRatioOf(size: string): { ratio: Ratio; quality: Quality } {
  for (const [ratio, [oneK, twoK]] of Object.entries(GITEE_Z_WIRE)) {
    if (size === oneK) return { ratio: ratio as Ratio, quality: '1K' }
    if (size === twoK) return { ratio: ratio as Ratio, quality: ratio === '3:2' || ratio === '2:3' ? '1K' : '2K' }
  }
  if ((GITEE_SIZE_PRESETS as readonly string[]).includes(size)) return { ratio: nearestGiteeRatio(size), quality: '1K' }
  return { ratio: '1:1', quality: '1K' }
}

function nearestGiteeRatio(size: string): Ratio {
  const parsed = parseResolution(size)
  if (parsed === undefined) return '1:1'
  return (nearestRatio(GITEE_SIZE_PRESETS, parsed.width / parsed.height) ?? '1:1') as Ratio
}

const GITEE_WIDTH_HEIGHT_MIN = 512
const GITEE_WIDTH_HEIGHT_MAX = 2048

/**
 * Gitee channel translation. The preset enum and the width/height override
 * are channel-wide, but the legal range is per model: z-image reaches 2048,
 * FLUX and (conservatively) every unverified family cap at 1024. Requests are
 * fitted into the model's range — presets first, then width/height with the
 * aspect ratio preserved — never forwarded blind.
 */
export function translateGiteeSize(model: string, ratio: Ratio, quality: Quality, resolution: PixelResolution | undefined): SizePlan {
  const limits = giteeModelLimits(model)
  if (resolution !== undefined) {
    const requested = `${resolution.width}x${resolution.height}`
    const withinMax = resolution.width <= limits.max && resolution.height <= limits.max
    if (withinMax && (limits.presets as readonly string[]).includes(requested)) {
      return sizePlan(requested, [`exact resolution ${requested} is a Gitee preset`])
    }
    // Fit the requested pixels into the model's range, aspect ratio preserved.
    const scale = Math.min(1, limits.max / resolution.width, limits.max / resolution.height)
    const width = Math.max(limits.min, Math.round(resolution.width * scale))
    const height = Math.max(limits.min, Math.round(resolution.height * scale))
    const notes: string[] = [`${resolution.width}x${resolution.height} sent as width/height fields`]
    if (width !== resolution.width || height !== resolution.height) {
      notes.push(`fitted into the ${model} range (${String(limits.min)}–${String(limits.max)}) with ratio preserved → ${width}x${height}`)
    }
    return widthHeightPlan(width, height, notes)
  }
  if (ratio === 'auto') return sizePlan('1024x1024', [noteRatioAuto])
  const wire = GITEE_Z_WIRE[ratio]
  if (wire === undefined) {
    return fallbackByWidthHeight(model, limits, ratioNumeric(ratio), quality, `ratio ${ratio} has no Gitee preset`)
  }
  const highTier = quality === '2K' || quality === '4K'
  const candidates = [wire[0]!, wire[1]!].filter(size => presetWithin(size, limits))
  const unique = [...new Set(candidates)]
  if (unique.length === 0) {
    return fallbackByWidthHeight(model, limits, ratioNumeric(ratio), quality, `all ${ratio} presets exceed the ${model} size ceiling`)
  }
  const chosen = highTier ? unique[unique.length - 1]! : unique[0]!
  const notes: string[] = []
  if (quality === 'auto') notes.push(noteQualityAuto)
  if (highTier && chosen !== wire[1]) notes.push(`${model} caps at ${String(limits.max)}px; ${wire[1]} is not available → ${chosen} used`)
  else if (quality === '4K') notes.push(noteNoSecondTier)
  return sizePlan(chosen, notes)
}

function fallbackByWidthHeight(model: string, limits: GiteeModelLimits, target: number | null, quality: Quality, reason: string): SizePlan {
  const ratio = target === null ? 1 : target
  let width = limits.max
  let height = Math.round(limits.max / ratio)
  if (height > limits.max) {
    height = limits.max
    width = Math.round(limits.max * ratio)
  }
  width = Math.max(limits.min, width)
  height = Math.max(limits.min, height)
  const notes = [`${reason}; sent as width/height within the ${model} range`]
  if (quality === 'auto') notes.push(noteQualityAuto)
  return widthHeightPlan(width, height, notes)
}

function presetWithin(size: string, limits: GiteeModelLimits): boolean {
  const parsed = parseResolution(size)
  if (parsed === undefined) return false
  return parsed.width <= limits.max && parsed.height <= limits.max
}

// ---------------------------------------------------------------------------
// ModelScope (api-inference.modelscope.cn) — free-form "WxH" size strings
// accepted per side in 512–2048, no preset enum; the shared preset vocabulary
// fits that range, so the same wire table serves both channels.
// ---------------------------------------------------------------------------

const MODELSCOPE_MIN = 512
const MODELSCOPE_MAX = 2048

/**
 * ModelScope channel translation. The endpoint takes `size: "WxH"` with each
 * side in 512–2048 (community-verified range), so every shared preset is legal
 * and exact resolutions pass through after a ratio-preserving fit.
 */
export function translateModelScopeSize(ratio: Ratio, quality: Quality, resolution: PixelResolution | undefined): SizePlan {
  if (resolution !== undefined) {
    const scale = Math.min(1, MODELSCOPE_MAX / resolution.width, MODELSCOPE_MAX / resolution.height)
    const width = Math.max(MODELSCOPE_MIN, Math.round(resolution.width * scale))
    const height = Math.max(MODELSCOPE_MIN, Math.round(resolution.height * scale))
    const requested = `${resolution.width}x${resolution.height}`
    const notes: string[] = [`${requested} sent as ModelScope size`]
    if (width !== resolution.width || height !== resolution.height) {
      notes.push(`fitted into ModelScope's 512–2048 range with ratio preserved → ${width}x${height}`)
    }
    return sizePlan(`${width}x${height}`, notes)
  }
  if (ratio === 'auto') return sizePlan('1024x1024', [noteRatioAuto])
  const wire = GITEE_Z_WIRE[ratio]
  if (wire === undefined) {
    // No preset for this ratio: derive free-form pixels inside the range.
    const target = ratioNumeric(ratio)
    if (target === null) return sizePlan('1024x1024', [`ratio ${ratio} could not be mapped; ModelScope default used`])
    let width = MODELSCOPE_MAX
    let height = Math.round(MODELSCOPE_MAX / target)
    if (height > MODELSCOPE_MAX) {
      height = MODELSCOPE_MAX
      width = Math.round(MODELSCOPE_MAX * target)
    }
    const notes = [`ratio ${ratio} sent as free-form ModelScope size ${width}x${height}`]
    if (quality === 'auto') notes.push(noteQualityAuto)
    return sizePlan(`${width}x${height}`, notes)
  }
  const highTier = quality === '2K' || quality === '4K'
  const chosen = highTier ? wire[1] : wire[0]
  const notes: string[] = []
  if (quality === 'auto') notes.push(noteQualityAuto)
  if (quality === '4K') notes.push(noteNoSecondTier)
  return sizePlan(chosen, notes)
}

// ---------------------------------------------------------------------------
// OpenAI images API and OpenAI-compatible relays.
// ---------------------------------------------------------------------------

/** Sizes every OpenAI-compatible relay accepts. */
export const OPENAI_ENUM_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const

/** gpt-image-2 rule-based sizes (multiples of 16; ratio 1:3..3:1; ≤3840x2160). */
const OPENAI_GPT2_WIRE: Record<string, [string, string]> = {
  '1:1': ['1024x1024', '2048x2048'],
  '3:2': ['1536x1024', '1920x1280'],
  '2:3': ['1024x1536', '1280x1920'],
  '4:3': ['1360x1024', '1792x1344'],
  '3:4': ['1024x1360', '1344x1792'],
  '16:9': ['1792x1024', '1920x1088'],
  '9:16': ['1024x1792', '1088x1920'],
}

const DALLE3_SIZES = ['1024x1024', '1792x1024', '1024x1792'] as const

function isGptImage2(model: string): boolean {
  return /^gpt-image-2(?:[-_.]|$)/i.test(model.trim())
}

function isGptImage(model: string): boolean {
  return /^gpt-image(?:[-_.]|$)/i.test(model.trim())
}

function isDallE3(model: string): boolean {
  return /^dall-e-3(?:[-_.]|$)/i.test(model.trim())
}

function isDallE2(model: string): boolean {
  return /^dall-e-2(?:[-_.]|$)/i.test(model.trim())
}

function isMultipleOf16(value: number): boolean {
  return value % 16 === 0
}

/** OpenAI-family translation: model-aware tables, rule validation for gpt-image-2, conservative enum for relays. */
export function translateOpenAICompatibleSize(model: string, ratio: Ratio, quality: Quality, resolution: PixelResolution | undefined): SizePlan {
  if (resolution !== undefined && isGptImage2(model)) {
    const ruleLegal = isMultipleOf16(resolution.width)
      && isMultipleOf16(resolution.height)
      && resolution.width / resolution.height <= 3 && resolution.height / resolution.width <= 3
      && resolution.width <= 3840 && resolution.height <= 2160
    const requested = `${resolution.width}x${resolution.height}`
    if (ruleLegal) return sizePlan(requested, [`exact resolution ${requested} passed gpt-image-2 rules`])
    const nearest = nearestRatio(OPENAI_ENUM_SIZES, resolution.width / resolution.height)
    return sizePlan(nearest ?? '1024x1024', [`${requested} is not gpt-image-2 legal; nearest preset ${nearest}`])
  }
  if (resolution !== undefined) {
    const nearest = nearestRatio(OPENAI_ENUM_SIZES, resolution.width / resolution.height)
    return sizePlan(nearest ?? '1024x1024', [`${resolution.width}x${resolution.height} mapped to the nearest relay-legal size ${nearest}`])
  }
  if (ratio === 'auto') {
    return sizePlan('1024x1024', [noteRatioAuto])
  }
  if (isGptImage2(model)) {
    const wire = OPENAI_GPT2_WIRE[ratio]
    if (wire !== undefined) {
      const highTier = quality === '2K' || quality === '4K'
      const notes: string[] = quality === 'auto' ? [noteQualityAuto] : []
      if (quality === '4K' && wire[0] === wire[1]) notes.push(noteNoSecondTier)
      return sizePlan(highTier ? wire[1] : wire[0], notes)
    }
  }
  if (isDallE3(model)) {
    if (ratio === '16:9') return sizePlan('1792x1024', [])
    if (ratio === '9:16') return sizePlan('1024x1792', [])
    if (ratio === '1:1') return sizePlan('1024x1024', [])
    return sizePlan('1024x1024', [`ratio ${ratio} is not dall-e-3 legal; fell back to 1024x1024`])
  }
  if (isDallE2(model)) {
    return sizePlan('1024x1024', ratio === '1:1' ? [] : [`ratio ${ratio} is not dall-e-2 legal; fell back to 1024x1024`])
  }
  const candidates = isGptImage2(model) ? OPENAI_GPT2_WIRE_TABLE : OPENAI_ENUM_SIZES_TABLE
  const nearest = nearestRatio(candidates, ratioNumeric(ratio))
  const notes: string[] = []
  if (quality === 'auto') notes.push(noteQualityAuto)
  if (nearest !== null && ratioNumeric(ratio) != null && Math.abs(ratioNumeric(ratio)! - ratioFromSizeString(nearest)) > 0.05) {
    notes.push(`ratio ${ratio} mapped to the nearest legal size ${nearest}`)
  }
  return sizePlan(nearest ?? '1024x1024', notes)
}

const OPENAI_GPT2_WIRE_TABLE: readonly string[] = [...OPENAI_ENUM_SIZES, '2048x2048', '1920x1280', '1280x1920', '1792x1344', '1344x1792', '1920x1088', '1088x1920', '1360x1024', '1024x1360', '1792x1024', '1024x1792']
const OPENAI_ENUM_SIZES_TABLE: readonly string[] = OPENAI_ENUM_SIZES

// ---------------------------------------------------------------------------
// DashScope (Qwen-Image) — `宽*高` star syntax with its own preset set.
// ---------------------------------------------------------------------------

const DASHSCOPE_WIRE: Record<string, string> = {
  '1:1': '1024*1024',
  '3:2': '1536*1024',
  '2:3': '1024*1536',
  '16:9': '1664*928',
  '9:16': '928*1664',
  '4:3': '1536*1024',
  '3:4': '1024*1536',
}

const DASHSCOPE_SIZE_TABLE: readonly string[] = Object.values(DASHSCOPE_WIRE)

export function translateDashScopeSize(ratio: Ratio, resolution: PixelResolution | undefined): SizePlan {
  if (resolution !== undefined) {
    const nearest = nearestRatio(DASHSCOPE_SIZE_TABLE, resolution.width / resolution.height)
    return sizePlan(nearest ?? '1024*1024', [`${resolution.width}x${resolution.height} mapped to the nearest qwen-image size ${nearest}`])
  }
  if (ratio === 'auto') return sizePlan('1024*1024', [noteRatioAuto])
  const wire = DASHSCOPE_WIRE[ratio]
  if (wire !== undefined && ratio !== '4:3' && ratio !== '3:4') {
    return sizePlan(wire, [])
  }
  const nearest = nearestRatio(DASHSCOPE_SIZE_TABLE, ratioNumeric(ratio))
  return sizePlan(nearest ?? '1024*1024', [`ratio ${ratio} mapped to the nearest qwen-image size ${nearest}`])
}

/** Reverse map for regeneration: star size back to its first matching ratio. */
export function dashScopeRatioOf(size: string): { ratio: Ratio; quality: string } {
  for (const [ratio, wire] of Object.entries(DASHSCOPE_WIRE)) {
    if (wire === size) return { ratio: ratio as Ratio, quality: 'standard' }
  }
  return { ratio: '1:1', quality: 'standard' }
}

// ---------------------------------------------------------------------------
// Seedream — tier vocabulary straight through (1K/2K/4K).
// ---------------------------------------------------------------------------

export function seedreamTier(quality: Quality): string {
  if (quality === 'auto') return '2K'
  return quality
}

// ---------------------------------------------------------------------------
// Google Gemini — aspect-ratio + tier vocabulary natively.
// ---------------------------------------------------------------------------

export function googleAspect(ratio: Ratio): Exclude<Ratio, 'auto'> {
  return ratio === 'auto' ? '1:1' : ratio
}

export function googleSize(quality: Quality): '1K' | '2K' | '4K' {
  return quality === '4K' ? '4K' : quality === '2K' ? '2K' : '1K'
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

function ratioNumeric(ratio: Ratio): number | null {
  switch (ratio) {
    case '1:1': return 1
    case '3:2': return 1.5
    case '2:3': return 2 / 3
    case '4:3': return 4 / 3
    case '3:4': return 3 / 4
    case '16:9': return 16 / 9
    case '9:16': return 9 / 16
    default: return null
  }
}

function ratioFromSizeString(size: string): number {
  const parsed = parseResolution(size.replace(/\*/g, 'x'))
  if (parsed === undefined) return 1
  return parsed.width / parsed.height
}

/** The candidate whose aspect is numerically closest to the target ratio. */
function nearestRatio(candidates: readonly string[], target: number | null): string | null {
  if (target === null || !Number.isFinite(target)) return null
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const distance = Math.abs(ratioFromSizeString(candidate) - target)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Render a plan for tool output strings and attachment meta. */
export function planLabel(plan: SizePlan): string {
  if (plan.kind === 'size' && plan.size !== undefined) return plan.size
  if (plan.kind === 'width_height' && plan.width !== undefined && plan.height !== undefined) return `${plan.width}x${plan.height}`
  return 'default'
}
