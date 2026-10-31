/** @jsxImportSource @opentui/solid */
import type { ModelInfo, SessionMessageInfo, UsageLimitsGo, UsageLimitsMeter } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { loadConfig, watchConfig } from "./config"
import { sessionsCost } from "./estimate"
import { bar, resetIn, TICK_MS, type UsageSeverity, usageSeverity } from "./usage"

// OpenTUI/Solid treats a plain expression as a static string. A function child
// is re-evaluated on every signal change; the cast keeps the JSX types happy.
const dyn = (fn: () => string) => fn as unknown as string

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

type SidebarUsageProps = {
  context: Plugin.Context
  sessionID: string
  /** Usage limits fetched before the slot mounts, so the first frame has meters. */
  initialGo?: UsageLimitsGo
  /** Whole-session tree cost fetched before the slot mounts. */
  initialCost?: number
  /** Sessions included in the prefetched tree cost. */
  initialSessionIDs?: string[]
  /** Plugin options from `cli.json`, which override the config file. */
  options?: unknown
}

const MAX_SESSIONS = 500
const PAGE_SIZE = 100
const COST_CONCURRENCY = 4

type SessionCost = { total: number; sessionIDs: string[] }

async function fetchMessages(context: Plugin.Context, sessionID: string): Promise<SessionMessageInfo[]> {
  const messages: SessionMessageInfo[] = []
  let cursor: string | undefined
  for (let page = 0; page < 100; page++) {
    const response = await context.client.message.list({ sessionID, limit: PAGE_SIZE, cursor })
    messages.push(...response.data)
    cursor = response.cursor.next ?? undefined
    if (!cursor) break
  }
  return messages
}

/** All sessions the TUI knows belong to this tree, with the root first. */
function familyIDs(context: Plugin.Context, sessionID: string): string[] {
  try {
    const rootID = context.data.session.root(sessionID)
    const ids = context.data.session.family(rootID)
    return ids.length > 0 ? ids : [rootID]
  } catch {
    return [sessionID]
  }
}

async function childIDs(context: Plugin.Context, parentID: string): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | undefined
  for (let page = 0; page < 100 && ids.length < MAX_SESSIONS; page++) {
    const response = await context.client.session.list({ parentID, limit: PAGE_SIZE, cursor })
    ids.push(...response.data.map((session) => session.id))
    cursor = response.cursor.next ?? undefined
    if (!cursor) break
  }
  return ids
}

/**
 * Every session in the tree. `family()` covers the normal store; walking the
 * parent links as well keeps archived or not-yet-synced subagents in the total.
 */
async function discoverSessions(context: Plugin.Context, sessionID: string): Promise<string[]> {
  const ids = new Set(familyIDs(context, sessionID))
  let frontier = [...ids]
  for (let depth = 0; depth < 10 && frontier.length > 0 && ids.size < MAX_SESSIONS; depth++) {
    const next: string[] = []
    for (const parentID of frontier) {
      for (const child of await childIDs(context, parentID)) {
        if (ids.has(child) || ids.size >= MAX_SESSIONS) continue
        ids.add(child)
        next.push(child)
      }
    }
    frontier = next
  }
  return [...ids]
}

async function costOfSessions(
  context: Plugin.Context,
  sessionIDs: readonly string[],
  models: readonly ModelInfo[],
): Promise<number> {
  const messageSets: SessionMessageInfo[][] = []
  for (let index = 0; index < sessionIDs.length; index += COST_CONCURRENCY) {
    const batch = sessionIDs.slice(index, index + COST_CONCURRENCY)
    messageSets.push(...(await Promise.all(batch.map((id) => fetchMessages(context, id)))))
  }
  return sessionsCost(messageSets, models)
}

async function fetchSessionCost(
  context: Plugin.Context,
  sessionID: string,
  models: readonly ModelInfo[],
): Promise<SessionCost> {
  const sessionIDs = await discoverSessions(context, sessionID)
  return { total: await costOfSessions(context, sessionIDs, models), sessionIDs }
}

export function SidebarUsage(props: SidebarUsageProps) {
  const theme = props.context.theme
  const [config, setConfig] = createSignal(loadConfig(props.options))
  onCleanup(watchConfig(() => setConfig(loadConfig(props.options))))

  const location = createMemo(
    () =>
      props.context.data.session.get(props.sessionID)?.location ??
      props.context.location ??
      props.context.data.location.default(),
  )

  const [total, setTotal] = createSignal<number | undefined>(props.initialCost)
  let treeIDs = new Set(props.initialSessionIDs ?? [])
  let costInFlight = false
  let costQueued = false
  let costReload = false

  const refreshCost = async (reloadTree = false) => {
    if (costInFlight) {
      costQueued = true
      costReload ||= reloadTree
      return
    }
    costInFlight = true
    const sessionID = props.sessionID
    try {
      let models = props.context.data.location.model.list(location()) ?? []
      if (models.length === 0) {
        await props.context.data.location.model.sync(location())
        models = props.context.data.location.model.list(location()) ?? []
      }
      if (reloadTree || treeIDs.size === 0) {
        const discovered = await discoverSessions(props.context, sessionID)
        if (sessionID !== props.sessionID) return
        treeIDs = new Set(discovered)
      }
      const value = await costOfSessions(props.context, [...treeIDs], models)
      if (sessionID !== props.sessionID) return
      setTotal(value)
      repaint()
    } catch {
      // Keep the last known total; usage events retry.
    } finally {
      costInFlight = false
      if (costQueued) {
        const reload = costReload
        costQueued = false
        costReload = false
        void refreshCost(reload)
      }
    }
  }

  const [go, setGo] = createSignal<UsageLimitsGo | undefined>(props.initialGo)
  const [now, setNow] = createSignal(Date.now())
  const repaint = () => props.context.renderer.requestRender()
  let lastLoaded = 0
  let lastForced = 0
  let inFlight = false

  const load = async (force = false) => {
    const settings = config()
    if (inFlight) return
    if (!force && settings.refreshMs === 0) return
    if (!force && Date.now() - lastLoaded < settings.refreshMs) return
    // Coalesce bursts of usage events into one request.
    if (force && Date.now() - lastForced < 1_000) return

    inFlight = true
    lastLoaded = Date.now()
    if (force) lastForced = Date.now()
    try {
      const response = await props.context.client.usage.limits({ location: { directory: location().directory } })
      setGo(response.data?.go)
      repaint()
    } catch {
      setGo(undefined)
    } finally {
      inFlight = false
    }
  }

  void load(true)
  if (props.initialCost === undefined) void refreshCost()

  createEffect(
    on(
      () => props.sessionID,
      () => {
        treeIDs = new Set()
        setTotal(undefined)
        void refreshCost(true)
        void load(true)
      },
      { defer: true },
    ),
  )

  // The tick advances the countdown every 15 s; the network read is throttled
  // by refreshMs, so the default cadence is one free GET every two minutes.
  const tick = setInterval(() => {
    setNow(Date.now())
    repaint()
    if (config().refreshMs > 0) void load()
  }, TICK_MS)
  onCleanup(() => clearInterval(tick))

  const touchesTree = (sessionID: string) => sessionID === props.sessionID || treeIDs.has(sessionID)

  onCleanup(
    props.context.data.on("session.execution.succeeded", (event) => {
      if (!touchesTree(event.data.sessionID)) return
      void refreshCost()
      void load(true)
    }),
  )
  onCleanup(
    props.context.data.on("session.usage.updated", (event) => {
      if (!touchesTree(event.data.sessionID)) return
      void refreshCost()
      void load(true)
    }),
  )
  onCleanup(
    props.context.data.on("session.created", (event) => {
      const parentID = event.data.parentID
      if (!parentID || (parentID !== props.sessionID && !treeIDs.has(parentID))) return
      treeIDs.add(event.data.sessionID)
      void refreshCost()
      void load(true)
    }),
  )
  onCleanup(
    props.context.data.on("session.deleted", (event) => {
      if (treeIDs.delete(event.data.sessionID)) void refreshCost()
    }),
  )

  const estimateText = createMemo(() => {
    const value = total()
    return value === undefined ? "…" : money.format(value)
  })

  const compactLine = createMemo(() => {
    const value = go()
    if (config().showMeters && value) {
      return [
        `R${Math.round(value.rolling.percent)}%`,
        `W${Math.round(value.weekly.percent)}%`,
        `M${Math.round(value.monthly.percent)}%`,
      ].join(" · ")
    }
    return config().showEstimate ? `≈ ${estimateText()}` : ""
  })

  const fallbackColor: Record<UsageSeverity, string> = {
    success: "#3fb950",
    warning: "#d29922",
    error: "#f85149",
  }

  // Resolve the colour while rendering, falling back to terminal defaults if
  // this host does not expose a themed feedback slot.
  const meterColor = (severity: UsageSeverity) => theme.text.feedback?.[severity]?.base ?? fallbackColor[severity]

  const severityOf = (meter: UsageLimitsMeter): UsageSeverity =>
    usageSeverity(meter.percent, meter.limited, config().warnAt, config().criticalAt)

  const meterOf = (key: "rolling" | "weekly" | "monthly"): UsageLimitsMeter =>
    go()?.[key] ?? { percent: 0, limited: false, resetsAt: 0 }

  const meterRow = (label: string, meter: () => UsageLimitsMeter) => {
    const size = () => bar(meter().percent, config().barWidth)
    const percentText = () => `${`${Math.round(meter().percent)}%`.padStart(4)} used`
    const resetText = () => (config().showReset ? ` · resets ${resetIn(meter().resetsAt, now())}` : "")
    // Recreate the row when severity changes. Updating `fg` alone can leave
    // already-rendered text chunks in their previous colour.
    return (
      <Show when={severityOf(meter())} keyed>
        {(severity) => (
          <box>
            <box height={1}>
              <text position="absolute" left={0} fg={theme.text.base}>
                {dyn(() => label.padEnd(8))}
              </text>
              <text position="absolute" left={8} fg={meterColor(severity)}>
                {dyn(percentText)}
              </text>
              <text position="absolute" left={17} fg={theme.text.muted}>
                {dyn(resetText)}
              </text>
            </box>
            <Show when={config().showBars}>
              <box height={1}>
                <text position="absolute" left={0} fg={theme.text.muted}>
                  {dyn(() => "─".repeat(config().barWidth))}
                </text>
                <text position="absolute" left={0} fg={meterColor(severity)}>
                  {dyn(() => "━".repeat(size().filled))}
                </text>
              </box>
            </Show>
          </box>
        )}
      </Show>
    )
  }

  return (
    <box>
      <Show when={!config().compact}>
        <text fg={theme.text.base}>{dyn(() => config().title)}</text>
        <Show when={config().showEstimate}>
          <text fg={theme.text.muted}>{dyn(() => `≈ ${estimateText()} session total`)}</text>
        </Show>
        <Show when={config().showMeters && go()}>
          <box paddingTop={config().showEstimate ? 1 : 0} gap={1}>
            {meterRow("Rolling", () => meterOf("rolling"))}
            {meterRow("Weekly", () => meterOf("weekly"))}
            {meterRow("Monthly", () => meterOf("monthly"))}
          </box>
        </Show>
      </Show>

      <Show when={config().compact}>
        <text fg={theme.text.base}>{dyn(() => `${config().title} · ${compactLine()}`)}</text>
      </Show>
    </box>
  )
}

export default Plugin.define({
  // OpenCode 2.2.0 exposes `sidebar.content` as one slot and publishes no
  // anchor between the built-in Context, Limit and MCP sections. Claiming the
  // built-in Limit id puts the panel exactly between Context and MCP; the
  // built-in Limit section is empty on Go-only setups and is replaced when it
  // is not. `position: "bottom"` uses the footer instead.
  id: "opencode.sidebar.limit",
  async setup(context) {
    const settings = loadConfig(context.options)
    const route = context.ui.router.current()
    const location =
      (route.type === "session" ? context.data.session.get(route.sessionID)?.location : undefined) ??
      context.location ??
      context.data.location.default()
    let initialGo: UsageLimitsGo | undefined
    let initialCost: number | undefined
    let initialSessionIDs: string[] | undefined
    try {
      const response = await context.client.usage.limits({ location: { directory: location.directory } })
      initialGo = response.data?.go
    } catch {
      // The panel retries on its own; a failed prefetch must not block loading.
    }
    if (route.type === "session") {
      try {
        let models = context.data.location.model.list(location) ?? []
        if (models.length === 0) {
          await context.data.location.model.sync(location)
          models = context.data.location.model.list(location) ?? []
        }
        const result = await fetchSessionCost(context, route.sessionID, models)
        initialCost = result.total
        initialSessionIDs = result.sessionIDs
      } catch {
        // The component retries after mount.
      }
    }
    const render = (input: { sessionID: string }) => (
      <SidebarUsage
        context={context}
        sessionID={input.sessionID}
        initialGo={initialGo}
        initialCost={initialCost}
        initialSessionIDs={initialSessionIDs}
        options={context.options}
      />
    )
    return settings.position === "bottom"
      ? context.ui.slot({ prepend: "sidebar.footer", render })
      : context.ui.slot({ append: "sidebar.content", render })
  },
})
