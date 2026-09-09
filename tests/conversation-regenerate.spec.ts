import { describe, expect, it } from 'vitest'
import type { StudioProviderProfile } from '../src/shared.js'
import { conversationRegenerateRequest } from '../src/client/conversation-regenerate.js'

const channels: StudioProviderProfile[] = [
  {
    channelId: 'gitee', provider: 'gitee', label: 'Gitee AI', model: 'FLUX.2-dev', models: ['FLUX.2-dev', 'GLM-Image'],
    configured: true, supportsEditing: true, ratioOptions: [], qualityOptions: [], defaultRatio: '1:1', defaultQuality: '1K',
  },
  {
    channelId: 'ch-ag', provider: 'antigravity', label: 'Antigravity', model: 'gemini-3.1-flash-image', models: ['gemini-3.1-flash-image'],
    configured: true, supportsEditing: true, ratioOptions: [], qualityOptions: [], defaultRatio: '1:1', defaultQuality: 'standard',
  },
]

describe('conversationRegenerateRequest', () => {
  it('keeps the recorded channelId when the channel still exists', () => {
    const request = conversationRegenerateRequest(
      { provider: 'gitee', model: 'FLUX.2-dev', channelId: 'gitee' },
      'new prompt',
      { channels },
    )
    expect(request.channelId).toBe('gitee')
    expect(request.model).toBe('FLUX.2-dev')
    expect(request.prompt).toBe('new prompt')
  })

  it('reverse-looks-up by (provider, model) for pre-channelization records', () => {
    const request = conversationRegenerateRequest(
      { provider: 'antigravity', model: 'gemini-3.1-flash-image' },
      'new prompt',
      { channels },
    )
    expect(request.channelId).toBe('ch-ag')
  })

  it('reverse-lookup tolerates a renamed model by picking the first channel of the provider', () => {
    const request = conversationRegenerateRequest(
      { provider: 'gitee', model: 'old-model' },
      'new prompt',
      { channels },
    )
    expect(request.channelId).toBe('gitee')
  })

  it('throws when the provider has no channel left', () => {
    expect(() => conversationRegenerateRequest({ provider: 'dashscope', model: 'x' }, 'p', { channels }))
      .toThrow(/渠道已不存在/)
  })

  it('accepts a recorded channelId even without a channel snapshot', () => {
    const request = conversationRegenerateRequest({ provider: 'gitee', model: 'FLUX.2-dev', channelId: 'gitee' }, 'p', {})
    expect(request.channelId).toBe('gitee')
  })

  it('rejects non-cloud providers', () => {
    expect(() => conversationRegenerateRequest({ provider: 'comfyui', model: 'w' }, 'p', { channels }))
      .toThrow(/暂不支持重新生成/)
  })
})
