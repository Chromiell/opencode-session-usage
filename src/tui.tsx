import type { UsageLimitsGo } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { loadConfig, watchConfig } from "./config"
import { bar, catalogCost, resetIn, TICK_MS } from "./usage"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

type SidebarUsageProps = {
  context: Plugin.Context
  sessionID: string
  /** Plugin options from `cli.json`, which override the config file. */
  options?: unknown
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

  const estimate = createMemo(() => {
    const models = props.context.data.location.model.list(location()) ?? []
    let total = 0
    for (const message of props.context.data.session.message.list(props.sessionID)) {
      if (message.type !== "assistant") continue
      const model = models.find((item) => item.providerID === message.model.providerID && item.id === message.model.id)
      if (model) total += catalogCost(model.cost, message.tokens)
    }
    return total
  })

  const [go, setGo] = createSignal<UsageLimitsGo>()
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

  // Switching sessions must not show the previous session's meters while the
  // new reading is in flight.
  createEffect(
    on(
      () => props.sessionID,
      () => {
        setGo(undefined)
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
      if (event.data.sessionID === props.sessionID) void load(true)
    }),
  )
  onCleanup(
    props.context.data.on("session.usage.updated", (event) => {
      if (event.data.sessionID === props.sessionID) void load(true)
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

  return (
    <box>
      <text fg={theme.text.base}>
        <b>{config().title}</b>
      </text>
      <Show when={config().showEstimate}>
        <text fg={theme.text.muted}>≈ {money.format(estimate())} session estimate</text>
      </Show>
      <Show when={config().showMeters && rows().length > 0}>
        <box paddingTop={config().showEstimate ? 1 : 0} gap={1}>
          <For each={rows()}>
            {(row) => {
              const size = () => bar(row.meter.percent, config().barWidth)
              const color = () => {
                const settings = config()
                if (row.meter.limited || row.meter.percent >= settings.criticalAt) {
                  return theme.text.feedback.error.base
                }
                return row.meter.percent >= settings.warnAt
                  ? theme.text.feedback.warning.base
                  : theme.text.feedback.success.base
              }
              return (
                <box>
                  <text fg={theme.text.base}>
                    <b>{row.label.padEnd(8)}</b>
                    <span style={{ fg: color() }}>{`${Math.round(row.meter.percent)}%`.padStart(4)} used</span>
                    <Show when={config().showReset}>
                      <span style={{ fg: theme.text.muted }}> · resets {resetIn(row.meter.resetsAt, now())}</span>
                    </Show>
                  </text>
                  <Show when={config().showBars}>
                    <text>
                      <span style={{ fg: color() }}>{"━".repeat(size().filled)}</span>
                      <span style={{ fg: theme.text.muted }}>{"─".repeat(size().empty)}</span>
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
        </box>
      </Show>
    </box>
  )
}

export default Plugin.define({
  // OpenCode 2.2.0 exposes `sidebar.content` as one slot, so the supported
  // choices are the top or the bottom of the sidebar. `position` in
  // usage-sidebar.json (or cli.json options) selects between them.
  id: "chromiell.usage-sidebar",
  setup(context) {
    const settings = loadConfig(context.options)
    const render = (input: { sessionID: string }) => (
      <SidebarUsage context={context} sessionID={input.sessionID} options={context.options} />
    )
    return settings.position === "bottom"
      ? context.ui.slot({ append: "sidebar.content", render })
      : context.ui.slot({ prepend: "sidebar.content", render })
  },
})
