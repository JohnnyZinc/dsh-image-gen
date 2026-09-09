import type { StudioProviderProfile } from '../shared.js'

export interface ComparisonTarget {
  profile: StudioProviderProfile
  ratio: string
  quality: string
  adjusted: boolean
}

/** Map one shared output intent to settings accepted by every target channel's default model. */
export function buildComparisonTargets(
  profiles: readonly StudioProviderProfile[],
  selectedChannelIds: readonly string[],
  ratio: string,
  quality: string,
): ComparisonTarget[] {
  const selected = new Set(selectedChannelIds)
  return profiles
    .filter(profile => profile.configured && selected.has(profile.channelId))
    .map(profile => {
      const targetRatio = profile.ratioOptions.some(option => option.value === ratio) ? ratio : profile.defaultRatio
      const targetQuality = profile.qualityOptions.some(option => option.value === quality) ? quality : profile.defaultQuality
      return {
        profile,
        ratio: targetRatio,
        quality: targetQuality,
        adjusted: targetRatio !== ratio || targetQuality !== quality,
      }
    })
}

/** Start with two channels, not every configured API, to avoid surprise spend. */
export function initialComparisonProviders(
  profiles: readonly StudioProviderProfile[],
  activeChannelId: string,
): string[] {
  const configured = profiles.filter(profile => profile.configured)
  const active = configured.find(profile => profile.channelId === activeChannelId)
  const ordered = active === undefined
    ? configured
    : [active, ...configured.filter(profile => profile.channelId !== activeChannelId)]
  return ordered.slice(0, 2).map(profile => profile.channelId)
}
