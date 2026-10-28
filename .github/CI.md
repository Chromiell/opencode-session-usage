# Continuous Integration

`.github/workflows/ci.yml` runs on every push to `main`, every pull request, and
on demand. It mirrors the checks used by the author's dotfiles repository, but
only the parts relevant to a TypeScript/OpenTUI plugin.

## Jobs

| Job | Tool | Purpose |
| :----------- | :---------------- | :----------------------------------------------------------------- |
| `typecheck` | `tsc --noEmit` | Type-check the plugin, config and tests. |
| `test` | Vitest | Unit tests for pricing, reset formatting, bars and config parsing. |
| `lint` | Biome | Formatting and lint rules. |
| `package` | `npm pack --json` | Assert the tarball contains the TUI entrypoint, helpers and docs. |
| `secrets` | gitleaks | Fail if a credential is committed. |
| `spelling` | typos | Spell-check docs and comments. |
| `links` | lychee | Validate local Markdown links and anchors offline. |
| `markdown` | markdownlint-cli2 | Markdown style (`.github/linters/.markdownlint-cli2.yaml`). |
| `yaml` | yamllint | YAML style (`.github/linters/yamllint.yml`). |
| `actionlint` | actionlint | Validate the workflow files. |
| `notify` | curl + jq | Report the run result to Discord or Slack. |

## Discord / Slack notifications

The `notify` job runs after every completed run (`if: !cancelled()`), including
failures, and posts:

- a bold title with the repository, ref, actor and verdict,
- the triggering commit subject (or PR title) in italics,
- one line per job with a status icon,
- a link to the run.

Setup:

1. Create an incoming webhook — Discord: _Server Settings → Integrations →
   Webhooks_; Slack: _Apps → Incoming Webhooks_.
2. Add the URL as the repository secret **`CI_WEBHOOK_URL`**
   (_Settings → Secrets and variables → Actions_).
3. Nothing else — the job detects `hooks.slack.com` and otherwise uses the
   Discord payload.

The webhook is optional. Without the secret (for example on pull requests from
forks, which never receive secrets) the step is skipped and CI still runs.

To test a failure notification, run the workflow manually with
`simulate_failure` checked. The `typecheck` job fails on purpose and the
notification reports the failure.

## Supply chain

Marketplace actions are pinned to full commit SHAs and kept current by
Dependabot. Tools installed in run steps are pinned by version:

- actionlint `1.7.12`
- yamllint `1.38.0`
- markdownlint-cli2 `0.23.3`

Node.js 24 is used for `npm ci`, type-checking and tests. The plugin itself runs
inside OpenCode's Bun runtime.

## Local reproduction

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run pack:check

# Docs and workflow checks, matching CI
npx --yes markdownlint-cli2@0.23.3 --config .github/linters/.markdownlint-cli2.yaml "**/*.md"
yamllint --config-file .github/linters/yamllint.yml .
typos --config .github/linters/typos.toml
lychee --offline --no-progress --include-fragments './**/*.md'
```
