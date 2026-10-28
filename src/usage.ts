import type { ModelCost, TokenUsageInfo } from "@opencode/client"

/** Width of the usage bar, in terminal cells. */
export const BAR_WIDTH = 22

/** Minimum interval between usage-limits reads. */
export const REFRESH_MS = 30_000

/** UI tick; advances the countdown and lets the throttled read run. */
export const TICK_MS = 15_000

/**
 * What a message would have cost at catalog prices.
 *
 * This is the estimate OpenCode's sidebar showed before v2.2.0 started
 * preferring a provider-reported cost. Providers on a subscription (notably
 * OpenCode Go) report `cost: 0`, so the catalog estimate is the only way to
 * show what the same tokens would cost at list prices.
 *
 * Mirrors OpenCode's `calculateCost`: pick the most specific context-tiered
 * price whose threshold the context exceeds, otherwise the base price.
 */
export function catalogCost(costs: readonly ModelCost[], tokens: TokenUsageInfo | undefined): number {
  if (!tokens) return 0
  const context = tokens.input + tokens.cache.read + tokens.cache.write
  const tier = costs
    .filter((cost) => cost.tier?.type === "context" && context > cost.tier.size)
    .toSorted((left, right) => (right.tier?.size ?? 0) - (left.tier?.size ?? 0))[0]
  const price = tier ?? costs.find((cost) => cost.tier === undefined)
  if (!price) return 0
  return (
    (tokens.input * price.input +
      (tokens.output + tokens.reasoning) * price.output +
      tokens.cache.read * price.cache.read +
      tokens.cache.write * price.cache.write) /
    1_000_000
  )
}

/** Human-readable time until a reset, e.g. `4d 9h` or `2h 5m`. */
export function resetIn(at: number, now: number): string {
  const remaining = Math.max(0, at - now)
  const days = Math.floor(remaining / 86_400_000)
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000)
  const minutes = Math.floor((remaining % 3_600_000) / 60_000)
  if (days > 0) return `${days}d ${hours}h`
  return `${hours}h ${minutes}m`
}

/** Split a percentage into filled and empty bar cells, clamped to 0–100. */
export function bar(percent: number, width = BAR_WIDTH): { filled: number; empty: number } {
  const size = Math.max(1, Math.round(width))
  const value = Math.min(100, Math.max(0, percent))
  const filled = Math.round((value / 100) * size)
  return { filled, empty: size - filled }
}
