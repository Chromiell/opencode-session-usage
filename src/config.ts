import { readFileSync, watch } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"

export type Position = "top" | "bottom"

/**
 * User-facing settings. The file is merged first, then plugin options from
 * `cli.json` override it, so a machine-specific install can tighten defaults
 * without editing the shared config file.
 */
export interface UsageConfig {
  /** Polling interval in milliseconds. `0` disables polling (events still refresh). */
  refreshMs: number
  /** Where the panel sits in the sidebar. Only top/bottom are supported by OpenCode 2.2.0. */
  position: Position
  /** Two-line summary: title/estimate plus one meter line. Recommended for bottom placement. */
  compact: boolean
  title: string
  showEstimate: boolean
  showMeters: boolean
  showBars: boolean
  barWidth: number
  showReset: boolean
  warnAt: number
  criticalAt: number
}

export const DEFAULT_CONFIG: UsageConfig = {
  refreshMs: 120_000,
  position: "top",
  compact: false,
  title: "Usage",
  showEstimate: true,
  showMeters: true,
  showBars: true,
  barWidth: 22,
  showReset: true,
  warnAt: 70,
  criticalAt: 90,
}

const MIN_REFRESH_MS = 30_000
const MAX_TITLE = 40

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function numberIn(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, Math.round(value)))
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function string(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, maxLength)
}

/** Validate an untrusted JSON object or `cli.json` options object. */
export function parseConfig(value: unknown): Partial<UsageConfig> {
  const input = asRecord(value)
  const result: Partial<UsageConfig> = {}

  // 0 is a deliberate "no polling" value; everything else gets a floor.
  if (input.refreshMs === 0) result.refreshMs = 0
  else {
    const refresh = numberIn(input.refreshMs, MIN_REFRESH_MS, 86_400_000)
    if (refresh !== undefined) result.refreshMs = refresh
  }

  if (input.position === "top" || input.position === "bottom") result.position = input.position

  const title = string(input.title, MAX_TITLE)
  if (title !== undefined) result.title = title

  for (const key of ["compact", "showEstimate", "showMeters", "showBars", "showReset"] as const) {
    const enabled = boolean(input[key])
    if (enabled !== undefined) result[key] = enabled
  }

  const barWidth = numberIn(input.barWidth, 8, 60)
  if (barWidth !== undefined) result.barWidth = barWidth

  const warnAt = numberIn(input.warnAt, 0, 100)
  if (warnAt !== undefined) result.warnAt = warnAt

  const criticalAt = numberIn(input.criticalAt, 0, 100)
  if (criticalAt !== undefined) result.criticalAt = criticalAt

  if (result.warnAt !== undefined && result.criticalAt !== undefined && result.criticalAt < result.warnAt) {
    result.criticalAt = result.warnAt
  }

  return result
}

/** Defaults ← config file ← plugin options. */
export function mergeConfig(file: unknown, options: unknown): UsageConfig {
  return { ...DEFAULT_CONFIG, ...parseConfig(file), ...parseConfig(options) }
}

/** `$OPENCODE_USAGE_CONFIG`, else `$XDG_CONFIG_HOME/opencode/usage-sidebar.json`, else `~/.config/opencode/usage-sidebar.json`. */
export function configPath(): string {
  const override = process.env.OPENCODE_USAGE_CONFIG?.trim()
  if (override) return override
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config")
  return join(configHome, "opencode", "usage-sidebar.json")
}

/** Read and validate the config file. A missing or malformed file yields defaults. */
export function loadConfig(options?: unknown): UsageConfig {
  let file: unknown = {}
  try {
    file = JSON.parse(readFileSync(configPath(), "utf8"))
  } catch {
    // Missing file, permissions, or invalid JSON: defaults are still useful.
  }
  return mergeConfig(file, options)
}

/**
 * Watch the config file's directory so atomic saves (write + rename) are
 * noticed. Returns an unsubscribe function.
 */
export function watchConfig(onChange: () => void): () => void {
  const path = configPath()
  const directory = dirname(path)
  const name = basename(path)
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const watcher = watch(directory, (_event, filename) => {
      if (filename && filename.toString() !== name) return
      clearTimeout(timer)
      timer = setTimeout(onChange, 150)
    })
    watcher.on("error", () => {})
    return () => {
      clearTimeout(timer)
      watcher.close()
    }
  } catch {
    // The config directory may not exist yet; edits then take effect on reload.
    return () => {}
  }
}
