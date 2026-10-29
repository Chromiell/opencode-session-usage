/** @jsxImportSource @opentui/solid */
import type { ModelInfo, SessionMessageInfo, UsageLimitsGo } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { loadConfig, watchConfig } from "./config"
import { sessionCost } from "./estimate"
import { bar, resetIn, TICK_MS } from "./usage"

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
      const models = props.context.data.location.model.list(location()) ?? []
      setTotal(await fetchSessionCost(props.context, props.sessionID, models))
    } catch {
      // Keep the last known total; usage events retry.
    } finally {
      costInFlight = false
    }
  }

  const [go, setGo] = createSignal<UsageLimitsGo | undefined>(props.initialGo)
  const [now, setNow] = createSignal(Date.now())
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

  const rows = createMemo(() => {
    const value = go()
    if (!value) return []
    return [
      { label: "Rolling", meter: value.rolling },
      { label: "Weekly", meter: value.weekly },
      { label: "Monthly", meter: value.monthly },
    ]
  })

  const estimateText = createMemo(() => {
    const value = total()
    return value === undefined ? "…" : money.format(value)
  })

  const compactLine = createMemo(() => {
    const value = rows()
    if (config().showMeters && value.length > 0) {
      return value.map((row) => `${row.label.slice(0, 1)}${Math.round(row.meter.percent)}%`).join(" · ")
    }
    return config().showEstimate ? `≈ ${estimateText()}` : ""
  })

  const meterColor = (meter: { percent: number; limited: boolean }) => {
    const settings = config()
    if (meter.limited || meter.percent >= settings.criticalAt) return theme.text.feedback.error.base
    return meter.percent >= settings.warnAt ? theme.text.feedback.warning.base : theme.text.feedback.success.base
  }

  return (
    <box>
      <Show when={!config().compact}>
        <text fg={theme.text.base}>
          <b>{config().title}</b>
        </text>
        <Show when={config().showEstimate}>
          <text fg={theme.text.muted}>≈ {estimateText()} session total</text>
        </Show>
        <Show when={config().showMeters && rows().length > 0}>
          <box paddingTop={config().showEstimate ? 1 : 0} gap={1}>
            <For each={rows()}>
              {(row) => {
                const size = () => bar(row.meter.percent, config().barWidth)
                return (
                  <box>
                    <text fg={theme.text.base}>
                      <b>{row.label.padEnd(8)}</b>
                      <span style={{ fg: meterColor(row.meter) }}>
                        {`${Math.round(row.meter.percent)}%`.padStart(4)} used
                      </span>
                      <Show when={config().showReset}>
                        <span style={{ fg: theme.text.muted }}> · resets {resetIn(row.meter.resetsAt, now())}</span>
                      </Show>
                    </text>
                    <Show when={config().showBars}>
                      <text>
                        <span style={{ fg: meterColor(row.meter) }}>{"━".repeat(size().filled)}</span>
                        <span style={{ fg: theme.text.muted }}>{"─".repeat(size().empty)}</span>
                      </text>
                    </Show>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>
      </Show>

      <Show when={config().compact}>
        <text fg={theme.text.base}>
          <b>{config().title}</b>
          <span style={{ fg: theme.text.muted }}> · {compactLine()}</span>
        </text>
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
        const models = context.data.location.model.list(location) ?? []
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
