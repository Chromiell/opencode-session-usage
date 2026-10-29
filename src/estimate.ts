import type { ModelInfo, SessionMessageInfo } from "@opencode/client"
import { catalogCost } from "./usage"

/**
 * What the whole session cost, from every assistant message.
 *
 * OpenCode records a real per-message `cost` when the provider reports one.
 * If any message has a positive cost, summing those values is the same figure
 * the built-in usage statistics show. Subscription providers such as OpenCode
 * Go report `0`, so a session with no reported cost falls back to catalog
 * pricing for every message — the estimate the old sidebar used to show.
 */
export function sessionCost(messages: readonly SessionMessageInfo[], models: readonly ModelInfo[]): number {
  let reported = 0
  let catalog = 0
  let hasReported = false

  for (const message of messages) {
    if (message.type !== "assistant") continue
    const cost = message.cost ?? 0
    if (cost > 0) {
      hasReported = true
      reported += cost
    }
    const model = models.find((item) => item.providerID === message.model.providerID && item.id === message.model.id)
    if (model) catalog += catalogCost(model.cost, message.tokens)
  }

  return hasReported ? reported : catalog
}
