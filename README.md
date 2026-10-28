# opencode-session-usage

A TUI sidebar panel for [OpenCode](https://opencode.ai) that shows:

- an **estimated session cost** at model catalog prices, and
- your **OpenCode Go / Console usage meters** — rolling, weekly and monthly —
  with reset countdowns and progress bars.

```text
Usage
≈ $0.21 session estimate

Rolling   2% used · resets 0h 5m
━━━━━━━━━━━━━━━━━━━━━━
Weekly    1% used · resets 4d 9h
━━━━━━━━━━━━━━━━━━━━━━
Monthly   8% used · resets 21d 23h
━━━━━━━━━━━━━━━━━━━━━━
```

The estimate is what the same tokens would cost at list prices. It is **not**
your invoice: subscription providers such as OpenCode Go report a real cost of
`$0`, which is why OpenCode's built-in `$ spent` line disappears on Go.

## Requirements

- OpenCode **2.2.0 or newer**.
- Node.js 24+ only for development; OpenCode itself runs the plugin with Bun.
- For usage meters: an OpenCode Console account with a Go or Go Plus
  subscription, connected through OAuth (see
  [Enabling Console usage metrics](#enabling-console-usage-metrics)).

## Install

TUI-only plugins are configured in `cli.json`, not `opencode.json`:

```json title="~/.config/opencode/cli.json"
{
  "plugins": ["opencode-session-usage"]
}
```

From a local checkout, use a path instead:

```json title="~/.config/opencode/cli.json"
{
  "plugins": ["/home/you/Projects/opencode-session-usage"]
}
```

Relative paths are resolved from the config directory, so
`"../../Projects/opencode-session-usage"` works for `~/.config/opencode/cli.json`.
OpenCode hot-reloads `cli.json`; use `/reload` if the panel does not appear.

## Configuration

The plugin reads a JSON file, in this order:

1. `$OPENCODE_USAGE_CONFIG`, if set.
2. `$XDG_CONFIG_HOME/opencode/usage-sidebar.json`.
3. `~/.config/opencode/usage-sidebar.json`.

The file is optional — every key falls back to the default below. It is watched,
so display changes apply immediately. `position` is read when the plugin loads,
so changing it needs `/reload` (or a TUI restart).

```json title="~/.config/opencode/usage-sidebar.json"
{
  "refreshMs": 120000,
  "position": "top",
  "title": "Usage",
  "showEstimate": true,
  "showMeters": true,
  "showBars": true,
  "barWidth": 22,
  "showReset": true,
  "warnAt": 70,
  "criticalAt": 90
}
```

| Key | Default | Description |
| :------------- | :-------- | :------------------------------------------------------------------------------------------------------------- |
| `refreshMs` | `120000` | Polling interval in ms (2 minutes). Minimum `30000`; `0` disables polling and refreshes only on usage events. |
| `position` | `"top"` | `"top"` or `"bottom"` of the sidebar. OpenCode 2.2.0 exposes one sidebar slot, so there is no middle position. |
| `title` | `"Usage"` | Section heading, up to 40 characters. |
| `showEstimate` | `true` | Show the catalog-price estimate. |
| `showMeters` | `true` | Show the Go meters when the account provides them. |
| `showBars` | `true` | Show progress bars. Set `false` for a compact text-only panel. |
| `barWidth` | `22` | Bar width in cells, 8–60. |
| `showReset` | `true` | Show the time until each window resets. |
| `warnAt` | `70` | Percentage where the bar turns warning-coloured. |
| `criticalAt` | `90` | Percentage where the bar turns error-coloured. Must be ≥ `warnAt`. |

Plugin options in `cli.json` override the file, which is useful for a
machine-specific setting without editing the shared config:

```json title="~/.config/opencode/cli.json"
{
  "plugins": [
    {
      "package": "opencode-session-usage",
      "options": { "position": "bottom", "refreshMs": 300000 }
    }
  ]
}
```

## Enabling Console usage metrics

The meters come from the same data as the OpenCode Console usage page. Two
conditions matter:

1. **Use OpenCode Console with an OAuth account.** Sign in at
   <https://opencode.ai/console>, subscribe to Go or Go Plus, then add an
   **OpenCode Console account** in OpenCode through the OAuth/device flow.
   A plain Console API key (a service-account key) can call inference, but
   OpenCode's `usage.limits` resolves the workspace from the OAuth credential's
   `metadata.orgID`; service-account keys have no such metadata, so the plugin
   gets no meters.
2. **Use a model from that workspace.** Pick a Go model with `/models`, for
   example `opencode-go/kimi-k3`. The panel reads limits for the session's
   location.

If the panel shows the estimate but no meters:

- Confirm the active credential is an OAuth **OpenCode Console** account, not
  only a service-account API key.
- Confirm the Go subscription and the session use the same Console workspace.
- Providers other than Go have no rolling/weekly/monthly meters; the estimate
  still works.

Percentages are integers reported by the Go usage endpoint, which truncates
toward zero; the Console page rounds the underlying spend. A one-point
difference (for example `8%` here vs `9%` there) is normal.

> [!NOTE]
> `usage.limits` is an experimental OpenCode endpoint. The plugin degrades to
> hiding the meters if it returns no data or changes shape.

## How it works

### Session estimate

For every assistant message, the plugin looks up the model in OpenCode's cached
catalog and prices its tokens:

```text
(input × input price
 + (output + reasoning) × output price
 + cache.read × cached-read price
 + cache.write × cached-write price) / 1,000,000
```

It selects the most specific context-tiered price whose threshold the input +
cached tokens exceed, otherwise the base price. This mirrors OpenCode's public
`calculateCost` semantics. The result is formatted as USD and is an estimate,
not a billed amount.

### Usage meters

The panel calls `client.usage.limits()` on the local OpenCode server, which in
turn reads the Console/Go metering endpoints. It reads only the three
`go.rolling`, `go.weekly` and `go.monthly` objects (`percent`, `limited`,
`resetsAt`).

### Refresh behaviour

- A 15-second timer moves the reset countdowns.
- The network read is throttled by `refreshMs` (default 2 minutes).
- `session.usage.updated` and `session.execution.succeeded` force an immediate
  read, coalesced to at most one per second, so a finished turn updates at once.
- `refreshMs: 0` disables periodic polling; events still refresh.
- Switching sessions clears the previous meters and reloads.

### Network and cost

The only network request is the read-only `usage.limits` GET. The plugin never
calls a model, a tool, or a prompt, sends no telemetry, and stores no
credentials. A usage read does not consume Go allowance. Errors are swallowed
and simply hide the meters.

## Troubleshooting

- **No panel:** ensure the entry is in `cli.json` (not `opencode.json`), the
  path is correct, and run `/reload`. Check
  `~/.local/share/opencode/log/opencode.log`.
- **No meters:** see
  [Enabling Console usage metrics](#enabling-console-usage-metrics).
- **Estimate is lower/higher than expected:** it uses catalog list prices, not
  provider-reported costs, discounts, or peak/off-peak pricing. Token counts
  include reasoning and cache usage as reported by OpenCode.
- **`position` ignored:** it is applied at setup; reload after changing it.

## Development

npm may warn that `@opentui/core` prefers Node.js 26.4+; that engine applies to running OpenTUI directly. Type-checking and the unit tests run on Node.js 24, and OpenCode executes the plugin with its own Bun runtime.

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run lint        # biome check
npm run ci          # typecheck + test + lint + pack check
```

Source layout:

```text
src/tui.tsx      plugin entry, slot registration, Solid/OpenTUI panel
src/config.ts    config file discovery, validation, hot reload
src/usage.ts     pure cost, reset and bar helpers
src/*.test.ts    Vitest coverage for the pure helpers and config
```

### CI and Discord notifications

`.github/workflows/ci.yml` runs typecheck, tests, Biome, package validation,
actionlint, secret scanning, spelling, Markdown link checks, Markdown style and
YAML lint. A final `notify` job reports every completed run to a Discord or
Slack incoming webhook, using the same payload format as the dotfiles CI.

To enable it, add the webhook URL as the repository secret
**`CI_WEBHOOK_URL`** (_Settings → Secrets and variables → Actions_). Without
the secret the notification step is skipped; CI still runs. Use **Actions → CI
→ Run workflow** with `simulate_failure` checked to test a failure message.

## Compatibility

Built against `@opencode/plugin` and `@opencode/client` **2.2.0**. OpenCode
plugin APIs evolve; pin a compatible plugin release for the OpenCode version
you run.

## Legal

This project is MIT-licensed (see [LICENSE](./LICENSE)) and is an independent
community plugin. See [LEGAL.md](./LEGAL.md) for the licensing and Terms-of-Service
analysis. It is not affiliated with, endorsed by, or sponsored by
Anomaly Innovations, Inc. or the OpenCode project; see [NOTICE](./NOTICE) for
attribution and third-party licenses.

The plugin uses OpenCode's documented, public TUI plugin API and the same
read-only usage endpoint the host TUI uses. It is intended for personal or
internal use with your own account. It does not scrape Console pages, access
other accounts, bypass limits, or handle credentials. OpenCode's Terms of
Service (effective 2026-08-15) prohibit bulk/multiple accounts, limit
circumvention, automated extraction of Content/Output, and unreasonable load;
this plugin does none of those things. That is a compatibility statement, not
legal advice — review the current
[Terms of Service](https://opencode.ai/legal/terms-of-service) before
redistributing or operating it as a service.
