/**
 * Pure channel → workbench-profile helpers.
 *
 * Extracted from studio.ts so the workbench's channelization logic stays
 * free of I/O and provider adapters — unit-testable without a Cordis context
 * or credential service.
 */
import {
  ASPECT_RATIOS,
  IMAGE_SIZES,
  agentChannels,
  defaultModelOn,
  type AgentChannelChoice,
  type Config,
} from './config.js'
import {
  CLOUD_IMAGE_PROVIDERS,
  type CloudImageProvider,
  type StudioOption,
  type StudioProviderProfile,
} from './shared.js'

const RATIO_LABELS: Record<string, string> = {
  auto: '自动',
  '1:1': '1:1 方形',
  '3:2': '3:2 横向',
  '2:3': '2:3 肖像',
  '4:3': '4:3 横向',
  '3:4': '3:4 竖向',
  '16:9': '16:9 宽屏',
  '9:16': '9:16 竖屏',
}

/** A workbench channel narrowed to the cloud providers the Studio serves. */
export type StudioChannel = AgentChannelChoice & { provider: CloudImageProvider }

function isCloudChannel(channel: AgentChannelChoice): channel is StudioChannel {
  return (CLOUD_IMAGE_PROVIDERS as readonly string[]).includes(channel.provider)
}

/** Workbench-eligible channels: every cloud (non-ComfyUI) agent channel, in declaration order. */
export function studioChannels(config: Config): StudioChannel[] {
  return agentChannels(config).filter(isCloudChannel)
}

/** Resolve one channel by its stable id for a workbench request. */
export function resolveStudioChannel(config: Config, channelId: string): StudioChannel {
  const channels = studioChannels(config)
  const channel = channels.find(candidate => candidate.id === channelId)
  if (channel !== undefined) return channel
  if (channels.length === 0) {
    throw new Error('尚未配置任何云端图像渠道，请到设置中添加后再试')
  }
  throw new Error(`未知渠道 "${channelId}"，可用渠道：${channels.map(candidate => `"${candidate.id}"`).join(', ')}。请刷新工作台后重试`)
}

/** The channel the workbench opens on: the recorded default, else the first configured, else the first. */
export function resolveActiveChannelId(config: Config, profiles: readonly StudioProviderProfile[]): string {
  const wanted = config.defaultChannelId?.trim() ?? ''
  if (wanted !== '') {
    const match = profiles.find(profile => profile.channelId === wanted)
    if (match !== undefined) return match.channelId
  }
  const configured = profiles.find(profile => profile.configured)
  if (configured !== undefined) return configured.channelId
  return profiles[0]?.channelId ?? ''
}

/** Browser-safe capability profile for one channel, with per-provider ratio/quality tables. */
export function studioProfileFromChannel(
  config: Config,
  channel: AgentChannelChoice,
  configured: boolean,
): StudioProviderProfile {
  const models = channel.models.filter(model => typeof model === 'string' && model.trim() !== '')
  const clean = models.length === channel.models.length ? channel : { ...channel, models }
  const model = defaultModelOn(config, clean)
  switch (channel.provider) {
    case 'google':
      return build(channel, model, models, configured, ASPECT_RATIOS.map(option), IMAGE_SIZES.map(value => ({ value, label: value })), '1:1', '1K')
    case 'openai':
      return build(channel, model, models, configured, ['1:1', '3:2', '2:3'].map(option), [{ value: 'standard', label: '标准（推荐）' }], '1:1', 'standard')
    case 'gitee':
      return build(channel, model, models, configured, ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'].map(option), ['1K', '2K', '4K'].map(value => ({ value, label: value })), '1:1', '1K')
    case 'modelscope':
      return build(channel, model, models, configured, ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'].map(option), ['1K', '2K', '4K'].map(value => ({ value, label: value })), '1:1', '1K')
    case 'antigravity':
      return build(channel, model, models, configured, ['1:1', '4:3', '3:4', '16:9', '9:16'].map(option), [{ value: 'standard', label: '标准（1K）' }, { value: 'medium', label: '中（2K）' }, { value: 'hd', label: '高（4K）' }], '1:1', 'standard')
    case 'seedream':
      return build(channel, model, models, configured, [{ value: 'auto', label: '模型自动' }], ['1K', '2K', '4K'].map(value => ({ value, label: value })), 'auto', '2K')
    default:
      return build(channel, model, models, configured, ['1:1', '3:2', '2:3', '16:9', '9:16'].map(option), [{ value: 'standard', label: '标准（推荐）' }], '1:1', 'standard')
  }
}

function build(
  channel: AgentChannelChoice,
  model: string,
  models: string[],
  configured: boolean,
  ratioOptions: StudioOption[],
  qualityOptions: StudioOption[],
  defaultRatio: string,
  defaultQuality: string,
): StudioProviderProfile {
  return {
    channelId: channel.id,
    provider: channel.provider as CloudImageProvider,
    label: channel.label,
    model,
    models,
    configured,
    supportsEditing: true,
    ratioOptions,
    qualityOptions,
    defaultRatio,
    defaultQuality,
  }
}

function option(value: string): StudioOption {
  return { value, label: RATIO_LABELS[value] ?? value }
}
