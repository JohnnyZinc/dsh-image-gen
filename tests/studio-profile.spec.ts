import { describe, expect, it } from 'vitest'
import type { Config } from '../src/config.js'
import { resolveActiveChannelId, resolveStudioChannel, studioChannels, studioProfileFromChannel } from '../src/studio-profile.js'

const threeChannelConfig: Config = {
  channels: [
    { id: 'gitee', provider: 'gitee', baseURL: 'https://ai.gitee.com/v1', models: ['FLUX.2-dev', 'GLM-Image'] },
    { id: 'ch-ms', provider: 'modelscope', baseURL: 'https://api-inference.modelscope.cn/v1', models: ['Tongyi-MAI/Z-Image-Turbo'] },
    { id: 'ch-ag', provider: 'antigravity', baseURL: 'http://127.0.0.1:8045/v1', models: ['gemini-3.1-flash-image'] },
  ],
  defaultChannelId: 'ch-ag',
  defaultModel: 'gemini-3.1-flash-image',
}

describe('studioChannels', () => {
  it('lists declared cloud channels in order and excludes comfyui', () => {
    const channels = studioChannels(threeChannelConfig)
    expect(channels.map(channel => channel.id)).toEqual(['gitee', 'ch-ms', 'ch-ag'])
  })

  it('falls back to the legacy per-provider config when no channels are declared', () => {
    const legacy: Config = { provider: 'gitee', giteeModel: 'FLUX.2-dev', giteeBaseURL: 'https://ai.gitee.com/v1' }
    const channels = studioChannels(legacy)
    expect(channels.some(channel => channel.id === 'gitee' && channel.provider === 'gitee')).toBe(true)
  })

  it('excludes a declared comfyui channel from the cloud workbench', () => {
    const config: Config = {
      channels: [
        { id: 'gitee', provider: 'gitee', models: ['FLUX.2-dev'] },
        { id: 'comfy', provider: 'comfyui', models: [] },
      ],
    }
    expect(studioChannels(config).map(channel => channel.id)).toEqual(['gitee'])
  })
})

describe('resolveStudioChannel', () => {
  it('resolves a declared channel id', () => {
    expect(resolveStudioChannel(threeChannelConfig, 'ch-ms').provider).toBe('modelscope')
  })

  it('throws for an unknown channel id', () => {
    expect(() => resolveStudioChannel(threeChannelConfig, 'nope')).toThrow(/未知渠道/)
  })
})

describe('resolveActiveChannelId', () => {
  it('prefers the recorded default channel', () => {
    const profiles = studioChannels(threeChannelConfig).map(channel => studioProfileFromChannel(threeChannelConfig, channel, false))
    expect(resolveActiveChannelId(threeChannelConfig, profiles)).toBe('ch-ag')
  })

  it('falls back to the first configured channel when the default channel is gone', () => {
    const config: Config = { ...threeChannelConfig, defaultChannelId: 'gone' }
    const profiles = studioChannels(config).map(channel => studioProfileFromChannel(config, channel, channel.id === 'gitee'))
    expect(resolveActiveChannelId(config, profiles)).toBe('gitee')
  })
})

describe('studioProfileFromChannel', () => {
  it('exposes every model on the channel for the workbench dropdown', () => {
    const channel = studioChannels(threeChannelConfig)[0]!
    const profile = studioProfileFromChannel(threeChannelConfig, channel, true)
    expect(profile.channelId).toBe('gitee')
    expect(profile.provider).toBe('gitee')
    expect(profile.models).toEqual(['FLUX.2-dev', 'GLM-Image'])
    expect(profile.model).toBe('FLUX.2-dev')
    expect(profile.configured).toBe(true)
  })

  it('uses the recorded default model when it lives on the default channel', () => {
    const channel = studioChannels(threeChannelConfig).find(candidate => candidate.id === 'ch-ag')!
    const profile = studioProfileFromChannel(threeChannelConfig, channel, true)
    expect(profile.model).toBe('gemini-3.1-flash-image')
  })

  it('disambiguates labels when several channels share a provider', () => {
    const config: Config = {
      channels: [
        { id: 'gitee-a', provider: 'gitee', models: ['FLUX.2-dev'] },
        { id: 'gitee-b', provider: 'gitee', models: ['GLM-Image'] },
      ],
    }
    const profiles = studioChannels(config).map(channel => studioProfileFromChannel(config, channel, true))
    expect(profiles[0]!.label).toContain('Gitee AI')
    expect(profiles[0]!.label).toContain('gitee-a')
    expect(profiles[1]!.label).toContain('gitee-b')
  })
})
