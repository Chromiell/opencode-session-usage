import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { configPath, DEFAULT_CONFIG, loadConfig, mergeConfig, parseConfig } from "./config"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("parseConfig", () => {
  it("ignores non-objects and unknown values", () => {
    expect(parseConfig(null)).toEqual({})
    expect(parseConfig([])).toEqual({})
    expect(parseConfig({ refreshMs: "soon", title: 3, showBars: "yes" })).toEqual({})
  })

  it("accepts the full option set", () => {
    expect(
      parseConfig({
        refreshMs: 120_000,
        position: "bottom",
        title: "Go quota",
        showEstimate: false,
        showMeters: true,
        showBars: false,
        barWidth: 16,
        showReset: false,
        warnAt: 60,
        criticalAt: 85,
      }),
    ).toEqual({
      refreshMs: 120_000,
      position: "bottom",
      title: "Go quota",
      showEstimate: false,
      showMeters: true,
      showBars: false,
      barWidth: 16,
      showReset: false,
      warnAt: 60,
      criticalAt: 85,
    })
  })

  it("allows zero to disable polling but floors real intervals", () => {
    expect(parseConfig({ refreshMs: 0 }).refreshMs).toBe(0)
    expect(parseConfig({ refreshMs: 10_000 }).refreshMs).toBe(30_000)
  })

  it("clamps widths and thresholds", () => {
    expect(parseConfig({ barWidth: 1 }).barWidth).toBe(8)
    expect(parseConfig({ barWidth: 999 }).barWidth).toBe(60)
    expect(parseConfig({ warnAt: 90, criticalAt: 50 })).toEqual({ warnAt: 90, criticalAt: 90 })
  })

  it("trims and caps the title", () => {
    expect(parseConfig({ title: "  Usage  " }).title).toBe("Usage")
    expect(parseConfig({ title: "x".repeat(100) })?.title).toHaveLength(40)
  })
})

describe("mergeConfig", () => {
  it("lets plugin options override the config file", () => {
    const merged = mergeConfig({ title: "File", refreshMs: 0 }, { title: "Options" })
    expect(merged.title).toBe("Options")
    expect(merged.refreshMs).toBe(0)
    expect(merged.barWidth).toBe(DEFAULT_CONFIG.barWidth)
  })
})

describe("loadConfig", () => {
  it("reads a JSON config file", () => {
    const directory = mkdtempSync(join(tmpdir(), "usage-config-"))
    const path = join(directory, "usage.json")
    writeFileSync(path, JSON.stringify({ refreshMs: 0, title: "From file", position: "bottom" }))
    vi.stubEnv("OPENCODE_USAGE_CONFIG", path)
    try {
      expect(loadConfig()).toMatchObject({ refreshMs: 0, title: "From file", position: "bottom" })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("falls back to defaults for malformed JSON", () => {
    const directory = mkdtempSync(join(tmpdir(), "usage-config-"))
    const path = join(directory, "usage.json")
    writeFileSync(path, "{not json")
    vi.stubEnv("OPENCODE_USAGE_CONFIG", path)
    try {
      expect(loadConfig()).toEqual(DEFAULT_CONFIG)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("uses the env override for the path", () => {
    vi.stubEnv("OPENCODE_USAGE_CONFIG", "/tmp/custom.json")
    expect(configPath()).toBe("/tmp/custom.json")
  })
})
