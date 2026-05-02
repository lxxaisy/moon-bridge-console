# Moon Bridge Console

Moon Bridge Console is an external local management layer for [Moon Bridge](../moon-bridge). It does not patch Moon Bridge protocol conversion code. It generates Moon Bridge configuration, starts and stops the local Moon Bridge process, syncs Codex configuration, and runs Codex-facing compatibility diagnostics through Moon Bridge's public HTTP endpoints.

## Why This Layer Exists

Codex App expects OpenAI Responses semantics, stable streaming events, and reliable tool-call round trips. When the upstream model is DeepSeek, Xiaomi Token Plan, Anthropic-compatible gateways, or another non-OpenAI model, the biggest risk is not basic text generation. The risk is that one of these Codex-facing behaviors is subtly different:

- `/v1/responses` non-streaming response shape
- SSE event sequence for streaming
- function tool-call shape
- tool result round trip in multi-turn agent work
- metrics visibility for cost, token usage, errors, and model routing

This console keeps those checks outside Moon Bridge core. If a model fails, the output tells you whether to adjust configuration, choose a stronger model, or inspect Moon Bridge trace before touching the bridge implementation.

## Start

```bash
cd /Users/lxxaisy/AI/moon-bridge-console
npm install
npm start
```

Open:

```text
http://127.0.0.1:38540
```

By default the console expects Moon Bridge at:

```text
/Users/lxxaisy/AI/moon-bridge
```

If you have a compiled `moonbridge` binary, set it in the UI. If it is blank, the console starts Moon Bridge with:

```bash
go run ./cmd/moonbridge -config <generated-config> -addr <addr>
```

## Recommended Flow

1. Add providers from templates or edit them manually.
2. Fill API keys locally in the UI.
3. Set route aliases such as `xiaomi`, `deepseek`, or `coding`.
4. Pick the default model alias.
5. Save config.
6. Start Moon Bridge from the console.
7. Sync Codex configuration.
8. Run compatibility diagnostics.
9. Use Codex App with the generated Moon Bridge provider.

## Xiaomi Token Plan

Use Xiaomi's Anthropic-compatible endpoint for Moon Bridge:

```yaml
base_url: https://token-plan-cn.xiaomimimo.com/anthropic
protocol: anthropic
model: mimo-v2.5
```

Do not configure Xiaomi's OpenAI-compatible `/v1` endpoint as `openai-response` unless that endpoint supports `/v1/responses`. A `/v1/chat/completions` compatible API is not the same as OpenAI Responses API.

## Compatibility Diagnostics

The diagnostics call Moon Bridge's local `/v1/responses` endpoint and check:

- `responses_text`: non-streaming sentinel response
- `responses_stream`: required Responses SSE event sequence
- `function_tool_call`: function tool-call JSON shape
- `function_round_trip`: tool result returned into the next model turn

This gives a practical score for Codex Agent usage. A provider can pass basic text but still fail tool or stream checks; in that case it is usable for simple prompts but risky for file-editing agent workflows.

The API and UI also produce a compatibility profile:

- `agent_ready`: text, streaming, tool calls, and tool-result round trips all pass
- `agent_non_streaming`: tools work, but streaming needs attention
- `chat_and_stream`: text and streaming work, but tool workflows are risky
- `text_only`: only basic text is reliable
- `unusable`: provider, model, API key, or Moon Bridge base URL needs fixing

You can run the same check without opening the UI:

```bash
BASE_URL=http://127.0.0.1:38440/v1 MODEL=xiaomi npm run diagnose
```

For best Codex App results, make an `agent_ready` model your default route. Keep weaker models as explicit secondary aliases instead of the default model.

## Agent Benchmark

Compatibility checks prove the Responses and tool-call contract is shaped correctly. The Agent Benchmark goes one step closer to real Codex usage: it gives the model a tiny in-memory workspace, asks it to inspect files, fix a bug, run tests, and finish only after the test passes.

Run from the UI with the **Agent 基准** tab, or from the command line:

```bash
BASE_URL=http://127.0.0.1:38440/v1 MODEL=xiaomi npm run benchmark
```

Benchmark tiers:

- `coding_ready`: model completed read, write, test, and final confirmation
- `tool_loop_ready`: model can call tools, but did not complete the code task
- `not_ready`: model is not suitable as the default coding route

Use `coding_ready` as the stronger signal for choosing the default Codex coding model. A model can pass basic compatibility diagnostics and still fail this benchmark.

## Upstream Compatibility

The console probes Moon Bridge for the dev/v5 management API at `/api/v1/status`. Current stable usage still targets Moon Bridge main/v4 YAML. If Moon Bridge promotes the v5 config/API redesign to `main`, the console should add a v5 config backend instead of replacing the current v4 path abruptly.

Tracking notes are kept in [docs/moon-bridge-upstream.md](docs/moon-bridge-upstream.md).

## Agent Compatibility Strategy

The console reduces model differences by shaping configuration and diagnostics, not by changing Moon Bridge's core protocol conversion:

- generated model metadata includes conservative Codex Agent base instructions
- model catalog sync uses Moon Bridge's own `-print-codex-config` implementation
- routes keep provider/model selection explicit, so a weak model can be isolated behind a non-default alias
- diagnostics verify real Codex-facing behavior through Moon Bridge, including tool result round trips
- metrics stay enabled by default so failed requests, token usage, latency, and cost remain visible

When adding a new provider, first use Provider Test to verify upstream credentials. Then start Moon Bridge and run Compatibility Diagnostics. Only promote that route to default after the model reaches `agent_ready`.

## Files Written

The console stores its own state at:

```text
~/.moon-bridge-console/state.json
```

It writes Moon Bridge config to the path selected in the UI, defaulting to:

```text
~/.config/moonbridge/config.yml
```

It syncs Codex files to the selected Codex home, defaulting to:

```text
~/.codex/config.toml
~/.codex/models_catalog.json
```

For Codex sync, the console invokes Moon Bridge's own `-print-codex-config` path so model catalog generation stays aligned with Moon Bridge.

## Deployment Notes

This first version is for local personal use and should listen on `127.0.0.1`. API keys are stored in the generated local config file, matching Moon Bridge's current config model. For wider distribution, package this directory as the stable control surface and keep Moon Bridge as the upstream proxy dependency.
