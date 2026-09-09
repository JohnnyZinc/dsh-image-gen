import { describe, expect, it } from 'vitest'
import { parseStudioGenerateRequest } from '../src/studio-route.js'

describe('parseStudioGenerateRequest', () => {
  it('parses a valid channel-based generate request', () => {
    const request = parseStudioGenerateRequest({
      mode: 'generate',
      channelId: 'ch-ag',
      model: 'gemini-3.1-flash-image',
      prompt: 'a cat',
      ratio: '1:1',
      quality: 'standard',
    })
    expect(request.channelId).toBe('ch-ag')
    expect(request.model).toBe('gemini-3.1-flash-image')
    expect(request.mode).toBe('generate')
  })

  it('rejects a request without a channelId', () => {
    expect(() => parseStudioGenerateRequest({ mode: 'generate', model: 'x', prompt: 'p', ratio: '1:1', quality: 'standard' }))
      .toThrow(/请选择渠道/)
  })

  it('does not treat the legacy provider field as the channel', () => {
    expect(() => parseStudioGenerateRequest({ mode: 'generate', provider: 'gitee', model: 'x', prompt: 'p', ratio: '1:1', quality: 'standard' }))
      .toThrow(/请选择渠道/)
  })

  it('validates the mode', () => {
    expect(() => parseStudioGenerateRequest({ mode: 'upscale', channelId: 'a', model: 'x', prompt: 'p', ratio: '1:1', quality: 'standard' }))
      .toThrow(/请选择生成类型/)
  })

  it('limits the batch count to 1..4', () => {
    expect(() => parseStudioGenerateRequest({ mode: 'generate', channelId: 'a', model: 'x', prompt: 'p', ratio: '1:1', quality: 'standard', count: 9 }))
      .toThrow(/生成数量仅支持 1 到 4/)
  })
})
