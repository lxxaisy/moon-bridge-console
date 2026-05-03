# Moon Bridge Upstream Tracking

Last checked: 2026-05-03

## Current Upstream State

- Local Moon Bridge checkout: `main`
- `origin/main`: same as local `main`
- `origin/dev`: ahead of `main` with a large v5 configuration and management API redesign
- Open PR: `#11 refactor: make worker runnable`
  - draft PR
  - base branch: `dev`
  - scope: Cloudflare Worker/TinyGo/WASM runtime support

## What Changed On `origin/dev`

The dev branch is materially different from main:

- new top-level v5 config structure:
  - `defaults`
  - `models`
  - `providers`
  - `providers.<key>.offers`
  - `routes`
  - `trace`
  - `proxy`
- old nested v4 structure:
  - `provider.providers.<key>.models`
  - `provider.routes.<alias>.to`
  - `provider.default_model`
  - `trace_requests`
  - `developer.proxy`
- new management API mounted at `/api/v1`
  - `/api/v1/status`
  - `/api/v1/providers`
  - `/api/v1/models`
  - `/api/v1/routes`
  - `/api/v1/defaults`
  - `/api/v1/config/export`
  - `/api/v1/config/import`
  - `/api/v1/changes/apply`
- new persistence-backed config store and runtime hot reload path
- model pricing moves from model metadata to provider offer metadata
- model metadata becomes shared by slug and providers declare offers for those models
- `origin/dev` now also includes visual tool-call metrics work and a clearer request metrics path for actual model / protocol / usage-source inspection

## Console Impact

The console currently targets Moon Bridge main/v4 YAML. That remains correct while upstream main has not adopted v5.

If dev/v5 is merged into main, the console should add a second config backend:

- v4 backend: current YAML generator
- v5 backend: top-level `models/providers/offers/routes/defaults` generator
- v5 live backend: use `/api/v1` for edits when Moon Bridge is already running

The console now probes `/api/v1/status` and reports whether the v5 management API is available. This keeps the current workflow stable while making the future migration visible.

The console should also mirror the newer observability model:

- show `actual_model`, `protocol`, and `usage_source` in metrics
- preserve both raw and normalized token counters when available
- keep the recommendation layer conservative so only well-validated routes become defaults
- treat `agent_non_streaming` as acceptable only when the benchmark also completes a full coding loop

## Recommendation

Do not switch the local Moon Bridge checkout to `origin/dev` for normal use yet. The dev branch is a broad redesign and PR #11 is still draft. Keep using main for the current local workflow.

Prepare console support for v5 after either of these happens:

- v5 config lands on `main`
- the project maintainer marks the v5 API/config structure as stable

## Future Console Work

1. Add `configFormat: v4 | v5 | auto` to console state.
2. Implement `writeMoonBridgeConfigV5`.
3. Add `importConfigFromMoonBridgeAPI` via `/api/v1/config/effective`.
4. Add optional live edits through `/api/v1/*` plus `/api/v1/changes/apply`.
5. Keep Codex diagnostics unchanged because `/v1/responses` remains the stable client-facing contract.
