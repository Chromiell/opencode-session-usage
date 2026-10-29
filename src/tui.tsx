/** @jsxImportSource @opentui/solid */
import type { ModelInfo, SessionMessageInfo, UsageLimitsGo, UsageLimitsMeter } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { loadConfig, watchConfig } from "./config"
import { sessionCost } from "./estimate"
import { bar, resetIn, TICK_MS } from "./usage"

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
  /** Whole-session cost fetched before the slot mounts. */
  initialCost?: number
  /** Plugin options from `cli.json`, which override the config file. */
  options?: unknown
}

async function fetchSessionCost(
  context: Plugin.Context,
  sessionID: string,
  models: readonly ModelInfo[],
): Promise<number> {
  const messages: SessionMessageInfo[] = []
  let cursor: string | undefined
  for (let page = 0; page < 100; page++) {
    const response = await context.client.message.list({ sessionID, limit: 100, cursor })
    messages.push(...response.data)
    cursor = response.cursor.next ?? undefined
    if (!cursor) break
  }
  return sessionCost(messages, models)
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
  let costInFlight = false

  const refreshCost = async () => {
    if (costInFlight) return
    costInFlight = true
    try {
      let models = props.context.data.location.model.list(location()) ?? []
      if (models.length === 0) {
        await props.context.data.location.model.sync(location())
        models = props.context.data.location.model.list(location()) ?? []
      }
      setTotal(await fetchSessionCost(props.context, props.sessionID, models))
      repaint()
    } catch {
      // Keep the last known total; usage events retry.
    } finally {
      costInFlight = false
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
        void refreshCost()
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

  onCleanup(
    props.context.data.on("session.execution.succeeded", (event) => {
      if (event.data.sessionID === props.sessionID) {
        void refreshCost()
        void load(true)
      }
    }),
  )
  onCleanup(
    props.context.data.on("session.usage.updated", (event) => {
      if (event.data.sessionID === props.sessionID) {
        void refreshCost()
        void load(true)
      }
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

  const meterColor = (meter: { percent: number; limited: boolean }) => {
    const settings = config()
    if (meter.limited || meter.percent >= settings.criticalAt) return theme.text.feedback.error.base
    return meter.percent >= settings.warnAt ? theme.text.feedback.warning.base : theme.text.feedback.success.base
  }

  const meterOf = (key: "rolling" | "weekly" | "monthly"): UsageLimitsMeter =>
    go()?.[key] ?? { percent: 0, limited: false, resetsAt: 0 }

  const meterRow = (label: string, meter: () => UsageLimitsMeter) => {
    const size = () => bar(meter().percent, config().barWidth)
    const percentText = () => `${`${Math.round(meter().percent)}%`.padStart(4)} used`
    const resetText = () => (config().showReset ? ` · resets ${resetIn(meter().resetsAt, now())}` : "")
    return (
      <box>
        <box height={1}>
          <text position="absolute" left={0} fg={theme.text.base}>
            {dyn(() => label.padEnd(8))}
          </text>
          <text position="absolute" left={8} fg={meterColor(meter())}>
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
            <text position="absolute" left={0} fg={meterColor(meter())}>
              {dyn(() => "━".repeat(size().filled))}
            </text>
          </box>
        </Show>
      </box>
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
    const location = context.location ?? context.data.location.default()
    let initialGo: UsageLimitsGo | undefined
    let initialCost: number | undefined
    try {
      const response = await context.client.usage.limits({ location: { directory: location.directory } })
      initialGo = response.data?.go
    } catch {
      // The panel retries on its own; a failed prefetch must not block loading.
    }
    const route = context.ui.router.current()
    if (route.type === "session") {
      try {
        let models = context.data.location.model.list(location) ?? []
        if (models.length === 0) {
          await context.data.location.model.sync(location)
          models = context.data.location.model.list(location) ?? []
        }
        initialCost = await fetchSessionCost(context, route.sessionID, models)
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
        options={context.options}
      />
    )
    return settings.position === "bottom"
      ? context.ui.slot({ prepend: "sidebar.footer", render })
      : context.ui.slot({ append: "sidebar.content", render })
  },
})
