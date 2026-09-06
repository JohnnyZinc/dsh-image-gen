import { describe, expect, it } from 'vitest'
import {
  giteeRatioOf,
  googleAspect,
  googleSize,
  normalizeQuality,
  normalizeRatio,
  parseResolution,
  planLabel,
  seedreamTier,
  translateDashScopeSize,
  translateGiteeSize,
  translateModelScopeSize,
  translateOpenAICompatibleSize,
} from '../src/vocab.js'

describe('vocabulary normalization', () => {
  it('normalizes ratio spellings and falls back to auto', () => {
    expect(normalizeRatio(' 3:4 ')).toBe('3:4')
    expect(normalizeRatio('16/9')).toBe('auto')
    expect(normalizeRatio('Auto')).toBe('auto')
    expect(normalizeRatio('864x1152')).toBe('auto')
    expect(normalizeRatio(undefined)).toBe('auto')
  })

  it('normalizes quality tiers case-insensitively', () => {
    expect(normalizeQuality('2k')).toBe('2K')
    expect(normalizeQuality(' 4K ')).toBe('4K')
    expect(normalizeQuality('ultra')).toBe('auto')
    expect(normalizeQuality(42)).toBe('auto')
  })

  it('parses exact WxH resolutions and rejects the rest', () => {
    expect(parseResolution('864x1152')).toEqual({ width: 864, height: 1152 })
    expect(parseResolution('1024X1024')).toEqual({ width: 1024, height: 1024 })
    expect(parseResolution('1536*1024')).toEqual({ width: 1536, height: 1024 })
    expect(parseResolution('abc')).toBeUndefined()
    expect(parseResolution('10x10')).toBeUndefined()
    expect(parseResolution('99999x10')).toBeUndefined()
  })
})

describe('Gitee per-model registry translation', () => {
  it('maps 3:4 + 1K to the 768x1024 preset for the z-image family', () => {
    const plan = translateGiteeSize('z-image-turbo', '3:4', '1K', undefined)
    expect(plan).toMatchObject({ kind: 'size', size: '768x1024' })
    expect(plan.notes).toHaveLength(0)
  })

  it('maps 16:9 + 2K to the 2048x1152 preset', () => {
    expect(translateGiteeSize('z-image-turbo', '16:9', '2K', undefined)).toMatchObject({ kind: 'size', size: '2048x1152' })
  })

  it('keeps auto on the channel default preset with an honest note', () => {
    const plan = translateGiteeSize('z-image-turbo', 'auto', 'auto', undefined)
    expect(plan).toMatchObject({ kind: 'size', size: '1024x1024' })
    expect(plan.notes.join(' ')).toContain('auto')
  })

  it('clamps 4K to the 2K preset where Gitee offers no 4K tier', () => {
    const plan = translateGiteeSize('z-image-turbo', '3:4', '4K', undefined)
    expect(plan).toMatchObject({ kind: 'size', size: '1536x2048' })
    expect(plan.notes.join(' ')).toContain('4K')
  })

  it('sends exact preset resolutions as size and others as width/height', () => {
    expect(translateGiteeSize('z-image-turbo', 'auto', 'auto', { width: 1024, height: 576 })).toMatchObject({ kind: 'size', size: '1024x576' })
    const plan = translateGiteeSize('z-image-turbo', 'auto', 'auto', { width: 864, height: 1152 })
    expect(plan).toMatchObject({ kind: 'width_height', width: 864, height: 1152 })
    expect(plan.notes.join(' ')).toContain('width/height')
  })

  it('clamps width/height into the documented 512–2048 range', () => {
    const plan = translateGiteeSize('z-image-turbo', 'auto', 'auto', { width: 4096, height: 300 })
    expect(plan).toMatchObject({ kind: 'width_height', width: 2048, height: 512 })
    expect(plan.notes.join(' ')).toContain('fitted')
  })

  it('caps FLUX families at their proven 1024 ceiling', () => {
    // 3:4 + 2K: the 1536x2048 preset is illegal for FLUX.2-dev; the highest legal 3:4 preset is used with an honest note.
    const plan = translateGiteeSize('FLUX.2-dev', '3:4', '2K', undefined)
    expect(plan).toMatchObject({ kind: 'size', size: '768x1024' })
    expect(plan.notes.join(' ')).toContain('1024')
    // 16:9 + 2K → the ≤1024 preset.
    expect(translateGiteeSize('FLUX.2-dev', '16:9', '2K', undefined)).toMatchObject({ kind: 'size', size: '1024x576' })
    // 3:2 has no ≤1024 preset → width/height within the ceiling, ratio preserved.
    const wide = translateGiteeSize('FLUX.2-dev', '3:2', '1K', undefined)
    expect(wide).toMatchObject({ kind: 'width_height', width: 1024, height: 683 })
  })

  it('fits oversized exact resolutions into the model ceiling with ratio preserved', () => {
    const plan = translateGiteeSize('FLUX.2-dev', 'auto', 'auto', { width: 1536, height: 2048 })
    expect(plan).toMatchObject({ kind: 'width_height', width: 768, height: 1024 })
    expect(plan.notes.join(' ')).toContain('1536x2048')
  })

  it('keeps the conservative 1024 ceiling for unverified models', () => {
    expect(translateGiteeSize('some-new-model', '3:4', '2K', undefined)).toMatchObject({ kind: 'size', size: '768x1024' })
  })

  it('reverse-maps wire sizes back to ratio and tier for regeneration', () => {
    expect(giteeRatioOf('768x1024')).toEqual({ ratio: '3:4', quality: '1K' })
    expect(giteeRatioOf('2048x1152')).toEqual({ ratio: '16:9', quality: '2K' })
    expect(giteeRatioOf('1360x2048')).toEqual({ ratio: '2:3', quality: '1K' })
  })
})

describe('ModelScope translation', () => {
  it('maps ratio + tier through the shared preset vocabulary', () => {
    expect(translateModelScopeSize('3:4', '1K', undefined)).toMatchObject({ kind: 'size', size: '768x1024' })
    expect(translateModelScopeSize('16:9', '2K', undefined)).toMatchObject({ kind: 'size', size: '2048x1152' })
  })

  it('keeps auto on the channel default with an honest note', () => {
    const plan = translateModelScopeSize('auto', 'auto', undefined)
    expect(plan).toMatchObject({ kind: 'size', size: '1024x1024' })
    expect(plan.notes.join(' ')).toContain('auto')
  })

  it('sends free-form exact resolutions, fitted into 512–2048 with ratio preserved', () => {
    expect(translateModelScopeSize('auto', 'auto', { width: 1152, height: 1536 })).toMatchObject({ kind: 'size', size: '1152x1536' })
    const plan = translateModelScopeSize('auto', 'auto', { width: 3000, height: 4000 })
    expect(plan).toMatchObject({ kind: 'size', size: '1536x2048' })
    expect(plan.notes.join(' ')).toContain('fitted')
  })

  it('maps every enum ratio through a shared preset (4:3)', () => {
    expect(translateModelScopeSize('4:3', '1K', undefined)).toMatchObject({ kind: 'size', size: '1152x896' })
  })
})

describe('OpenAI-compatible translation', () => {
  it('uses the gpt-image-2 rule table with tier mapping', () => {
    expect(translateOpenAICompatibleSize('gpt-image-2', '3:4', '2K', undefined)).toMatchObject({ kind: 'size', size: '1344x1792' })
    expect(translateOpenAICompatibleSize('gpt-image-2', '16:9', '1K', undefined)).toMatchObject({ kind: 'size', size: '1792x1024' })
  })

  it('passes gpt-image-2-legal exact resolutions through and maps the rest', () => {
    expect(translateOpenAICompatibleSize('gpt-image-2', 'auto', 'auto', { width: 864, height: 1152 })).toMatchObject({ kind: 'size', size: '864x1152' })
    const plan = translateOpenAICompatibleSize('gpt-image-2', 'auto', 'auto', { width: 100, height: 100 })
    expect(plan.kind).toBe('size')
    expect(plan.size).not.toBe('100x100')
    expect(plan.notes.join(' ')).toContain('nearest')
  })

  it('keeps unknown relay models on the conservative enum', () => {
    const plan = translateOpenAICompatibleSize('some-relay-model', '4:3', 'auto', undefined)
    expect(plan).toMatchObject({ kind: 'size', size: '1536x1024' })
    expect(plan.notes.join(' ')).toContain('nearest')
  })

  it('honors dall-e-3 and dall-e-2 limits', () => {
    expect(translateOpenAICompatibleSize('dall-e-3', '16:9', 'auto', undefined)).toMatchObject({ kind: 'size', size: '1792x1024' })
    const square = translateOpenAICompatibleSize('dall-e-2', '3:2', 'auto', undefined)
    expect(square).toMatchObject({ kind: 'size', size: '1024x1024' })
    expect(square.notes.join(' ')).toContain('dall-e-2')
  })
})

describe('DashScope, Seedream, and Google translations', () => {
  it('maps ratios to qwen-image star sizes and notes the nearest fallback', () => {
    expect(translateDashScopeSize('9:16', undefined)).toMatchObject({ kind: 'size', size: '928*1664' })
    const plan = translateDashScopeSize('4:3', undefined)
    expect(plan).toMatchObject({ kind: 'size', size: '1536*1024' })
    expect(plan.notes.join(' ')).toContain('nearest')
  })

  it('defaults seedream to its 2K tier', () => {
    expect(seedreamTier('auto')).toBe('2K')
    expect(seedreamTier('4K')).toBe('4K')
    expect(seedreamTier('1K')).toBe('1K')
  })

  it('keeps Google on its native aspect-ratio and tier vocabulary', () => {
    expect(googleAspect('3:4')).toBe('3:4')
    expect(googleAspect('auto')).toBe('1:1')
    expect(googleSize('auto')).toBe('1K')
    expect(googleSize('4K')).toBe('4K')
  })

  it('labels plans for tool output strings', () => {
    expect(planLabel({ kind: 'size', size: '768x1024', notes: [] })).toBe('768x1024')
    expect(planLabel({ kind: 'width_height', width: 864, height: 1152, notes: [] })).toBe('864x1152')
    expect(planLabel({ kind: 'omit', notes: [] })).toBe('default')
  })
})
