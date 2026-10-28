# Legal and licensing notes

This is a practical compliance summary for the project, not legal advice. It
reflects the licenses and terms published on 2026-10-28.

## This project

`opencode-session-usage` is original code released under the MIT License
([LICENSE](./LICENSE)), copyright © 2026 Chromiell. You may use, modify,
redistribute and sell it, provided the copyright and permission notice are
included in copies or substantial portions.

## OpenCode

OpenCode is open-source software under the MIT License, copyright © 2025
opencode. Its license permits use, modification, redistribution and
sublicensing, with the notice preserved. This project:

- uses the public `@opencode/plugin/tui` and `@opencode/client` APIs;
- imports no OpenCode source files and vendors no OpenCode code;
- implements the catalog-price calculation independently, following the
  documented pricing semantics of OpenCode's public `calculateCost` function;
- includes the OpenCode MIT notice in [NOTICE](./NOTICE).

The plugin is loaded by the user's own OpenCode installation. It is not a fork
or a modified distribution of OpenCode.

## Third-party dependencies

The package declares these runtime/peer dependencies, each under its own
license:

| Package | License |
| :------------------------------------- | :----------------------------------- |
| `@opencode/plugin`, `@opencode/client` | MIT (OpenCode) |
| `@opentui/core`, `@opentui/solid` | MIT (opentui contributors) |
| `solid-js` | MIT (Ryan Carniato and contributors) |

They are installed from npm by the user or by OpenCode; they are not vendored
in this repository.

## Trademarks

"OpenCode" is used descriptively to identify the host application. This project
is not affiliated with, endorsed by, or sponsored by Anomaly Innovations, Inc.
or the OpenCode project. Do not use OpenCode logos or branding in a way that
suggests endorsement.

## OpenCode Terms of Service

The relevant prohibitions in the OpenCode Terms of Service (effective
2026-08-15, <https://opencode.ai/legal/terms-of-service>) are:

- creating or using multiple/bulk accounts to circumvent limits, billing or
  restrictions;
- automatically or programmatically extracting data or Output;
- crawling, scraping or spidering the Services;
- running processes while not logged in or placing unreasonable load on the
  infrastructure;
- obtaining another user's credentials or breaking security;
- decompiling or reverse engineering the Services.

This plugin is designed to stay outside those prohibitions:

| Requirement | Behaviour |
| :--------------------------- | :--------------------------------------------------------------------------------------------------------- |
| Personal/internal use | Reads the signed-in user's own session data and usage meters. |
| No limit circumvention | Displays limits; never changes, bypasses or resets them. |
| No Content/Output extraction | Reads token counts, catalog prices and usage percentages only — no prompts, completions or model Output. |
| No scraping | Calls the documented `usage.limits` server API. It does not fetch or parse Console HTML. |
| No unreasonable load | Default one read every two minutes, coalesced event refresh, and `refreshMs: 0` disables polling entirely. |
| No credential handling | OpenCode owns authentication; the plugin never reads, stores or transmits credentials. |
| No reverse engineering | Uses the public, MIT-licensed plugin API and public type definitions. |

The plugin sends no telemetry and has no analytics endpoint. The only request it
makes is the read-only usage-limits request to the local OpenCode server, which
OpenCode forwards to the Console/Go metering service under the user's own
account.

## User responsibilities

If you install or redistribute this plugin:

- use your own OpenCode/Console account and comply with the current OpenCode
  terms and any provider terms;
- keep the MIT notices and [NOTICE](./NOTICE) intact;
- do not add credential harvesting, telemetry, scraping, limit bypassing or
  multi-account behaviour;
- re-check the terms when OpenCode changes them or when you operate the plugin
  as a hosted service.

## Changes

OpenCode's license and terms can change. This summary is not a substitute for
reviewing the current [Terms of Service](https://opencode.ai/legal/terms-of-service)
and the licenses shipped with your installed dependencies.
