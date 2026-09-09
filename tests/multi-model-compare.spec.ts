import { describe, expect, it } from 'vitest'
import type { CloudImageProvider, StudioProviderProfile } from '../src/shared.js'
import { buildComparisonTargets, initialComparisonProviders } from '../src/client/multi-model-compare.js'

function profile(channelId: string, provider: CloudImageProvider, configured: boolean, models: string[]): StudioProviderProfile {
  return {
    channelId,
    provider,
    label: provider,
    model: models[0] ?? '',
    models,
    configured,
    supportsEditing: true,
    ratioOptions: [{ value: '1:1', label: '1:1' }],
    qualityOptions: [{ value: 'standard', label: 'standard' }],
    defaultRatio: '1:1',
    defaultQuality: 'standard',
  }
}

const profiles: StudioProviderProfile[] = [
  profile('gitee', 'gitee', true, ['FLUX.2-dev']),
  profile('ch-ag', 'antigravity', true, ['gemini-3.1-flash-image']),
  profile('ch-ms', 'modelscope', false, ['Tongyi-MAI/Z-Image-Turbo']),
]

describe('buildComparisonTargets', () => {
  it('selects only the configured channels named by id', () => {
    const targets = buildComparisonTargets(profiles, ['gitee', 'ch-ag', 'ch-ms'], '1:1', 'standard')
    expect(targets.map(target => target.profile.channelId).sort()).toEqual(['ch-ag', 'gitee'])
  })

  it('falls back to the profile default when a target cannot honor the shared ratio/quality', () => {
    const targets = buildComparisonTargets(profiles, ['gitee'], '16:9', 'standard')
    expect(targets[0]!.ratio).toBe('1:1')
    expect(targets[0]!.adjusted).toBe(true)
  })
})

describe('initialComparisonProviders', () => {
  it('puts the active channel first and caps the initial selection at two', () => {
    expect(initialComparisonProviders(profiles, 'ch-ag')).toEqual(['ch-ag', 'gitee'])
  })

  it('ignores an unknown active channel and starts from the first configured one', () => {
    expect(initialComparisonProviders(profiles, 'gone')).toEqual(['gitee', 'ch-ag'])
  })
})
