import type { ModelCost, TokenUsageInfo } from "@opencode/client"
import { describe, expect, it } from "vitest"
import { bar, catalogCost, resetIn } from "./usage"

const base: ModelCost = { input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }
const tiered: ModelCost[] = [
  base,
  { input: 2, output: 4, cache: { read: 1, write: 1 }, tier: { type: "context", size: 1_000 } },
]

function tokens(overrides: Partial<TokenUsageInfo> = {}): TokenUsageInfo {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, ...overrides }
}

describe("catalogCost", () => {
  it("returns zero without token usage", () => {
    expect(catalogCost(tiered, undefined)).toBe(0)
  })

  it("uses the base price below the context tier", () => {
    expect(catalogCost(tiered, tokens({ input: 1_000, output: 500 }))).toBeCloseTo(0.002, 10)
  })

  it("uses the tier once context exceeds its threshold", () => {
    expect(catalogCost(tiered, tokens({ input: 1_001 }))).toBeCloseTo(1_001 * 2e-6, 10)
  })

  it("counts cache reads and writes toward context and price", () => {
    const usage = tokens({ input: 100, cache: { read: 500, write: 400 } })
    expect(catalogCost(tiered, usage)).toBeCloseTo(100 * 1e-6 + 500 * 1e-7 + 400 * 2e-7, 10)
  })

  it("prices reasoning tokens as output", () => {
    expect(catalogCost([base], tokens({ output: 100, reasoning: 50 }))).toBeCloseTo(150 * 2e-6, 10)
  })

  it("returns zero when no price matches", () => {
    expect(catalogCost([], tokens({ input: 10 }))).toBe(0)
  })
})

describe("resetIn", () => {
  const now = 1_800_000_000_000

  it("formats days and hours", () => {
    expect(resetIn(now + 4 * 86_400_000 + 9 * 3_600_000, now)).toBe("4d 9h")
  })

  it("formats hours and minutes", () => {
    expect(resetIn(now + 2 * 3_600_000 + 5 * 60_000, now)).toBe("2h 5m")
  })

  it("clamps past resets", () => {
    expect(resetIn(now - 1, now)).toBe("0h 0m")
  })
})

describe("bar", () => {
  it("fills proportionally", () => {
    expect(bar(0)).toEqual({ filled: 0, empty: 22 })
    expect(bar(50)).toEqual({ filled: 11, empty: 11 })
    expect(bar(100)).toEqual({ filled: 22, empty: 0 })
  })

  it("clamps out-of-range percentages", () => {
    expect(bar(-10)).toEqual({ filled: 0, empty: 22 })
    expect(bar(150)).toEqual({ filled: 22, empty: 0 })
  })

  it("honours a custom width", () => {
    expect(bar(50, 10)).toEqual({ filled: 5, empty: 5 })
  })
})
