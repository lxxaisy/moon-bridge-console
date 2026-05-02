import assert from "node:assert/strict";
import test from "node:test";
import {
  CODEX_AGENT_BASE_INSTRUCTIONS,
  applyConfigView,
  cloneDefaultState,
  configView,
  makeProviderFromTemplate,
  validateState
} from "../src/config.js";

test("config view supports multiple providers and routes", () => {
  const state = cloneDefaultState();
  const view = configView(state);

  assert.ok(view.providers.length >= 2);
  assert.ok(view.routes.some((route) => route.alias === "xiaomi"));
  assert.equal(view.defaultModel, "xiaomi");
});

test("applyConfigView replaces provider and route maps with edited values", () => {
  const state = cloneDefaultState();
  const view = configView(state);
  view.providers = [makeProviderFromTemplate("xiaomi-token-plan")];
  view.routes = [{ alias: "main", provider: "xiaomi", model: "mimo-v2.5" }];
  view.defaultModel = "main";

  const updated = applyConfigView(state, view);

  assert.deepEqual(Object.keys(updated.config.provider.providers), ["xiaomi"]);
  assert.deepEqual(Object.keys(updated.config.provider.routes), ["main"]);
  assert.equal(updated.config.provider.default_model, "main");
  assert.equal(updated.config.provider.providers.xiaomi.models["mimo-v2.5"].base_instructions, CODEX_AGENT_BASE_INSTRUCTIONS);
});

test("validateState rejects routes that point to missing models", () => {
  const state = cloneDefaultState();
  state.config.provider.routes.bad = { to: "xiaomi/not-real" };
  state.config.provider.default_model = "bad";

  assert.throws(() => validateState(state), /unknown model/);
});
