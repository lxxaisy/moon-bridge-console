import assert from "node:assert/strict";
import test from "node:test";
import { cloneDefaultState } from "../src/config.js";
import { preflightReport, reportMarkdown } from "../src/preflight.js";

test("preflightReport warns about missing provider keys and keeps endpoint guidance", () => {
  const state = cloneDefaultState();
  const report = preflightReport({
    state,
    status: {
      moonBridge: {
        running: false,
        health: { ok: false }
      }
    },
    upstream: {
      available: true,
      verdict: "stay_v4",
      label: "v5 更强，但还不适合直接切换"
    },
    metrics: {
      enabled: false,
      message: "HTTP 404",
      records: [],
      summary: {}
    }
  });

  assert.equal(report.summary.fail, 0);
  assert.ok(report.summary.warn >= 1);
  assert.ok(report.checks.some((item) => item.id === "provider_xiaomi_key" && item.level === "warn"));
  assert.ok(report.checks.some((item) => item.id === "provider_xiaomi_endpoint" && item.level === "pass"));
});

test("reportMarkdown renders a shareable summary", () => {
  const state = cloneDefaultState();
  const report = preflightReport({
    state,
    status: null,
    upstream: null,
    metrics: null
  });
  const markdown = reportMarkdown(report);

  assert.match(markdown, /Moon Bridge Console Report/);
  assert.match(markdown, /Default Model: xiaomi/);
});

test("preflightReport fails when a provider base_url is missing", () => {
  const state = cloneDefaultState();
  state.config.provider.providers.xiaomi.base_url = "";

  const report = preflightReport({
    state,
    status: null,
    upstream: null,
    metrics: null
  });

  assert.ok(report.checks.some((item) => item.id === "provider_xiaomi_base_url" && item.level === "fail"));
});
