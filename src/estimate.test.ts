import type { ModelInfo, SessionMessageInfo } from "@opencode/client"
import { describe, expect, it } from "vitest"
import { sessionCost } from "./estimate"

const model = {
  id: "m",
  providerID: "p",
  cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }],
} as ModelInfo

function assistant(cost?: number, input = 1_000_000) {
  return {
    type: "assistant",
    model: { providerID: "p", id: "m" },
    cost,
    tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as SessionMessageInfo
}

const other = { type: "user" } as SessionMessageInfo

describe("sessionCost", () => {
  it("uses reported costs when the provider supplies them", () => {
    expect(sessionCost([assistant(0.25), assistant(0), other], [model])).toBeCloseTo(0.25, 10)
  })

  it("sums every positive reported cost, ignoring zero-cost messages", () => {
    expect(sessionCost([assistant(0.25), assistant(0.5)], [model])).toBeCloseTo(0.75, 10)
  })

  it("falls back to catalog pricing when every cost is zero", () => {
    expect(sessionCost([assistant(0), assistant(0, 500_000), other], [model])).toBeCloseTo(1.5, 10)
  })

  it("ignores assistant messages whose model is missing from the catalog", () => {
    expect(sessionCost([assistant(0)], [])).toBe(0)
  })
})
