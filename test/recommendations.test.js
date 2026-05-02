import assert from "node:assert/strict";
import test from "node:test";
import { cloneDefaultState } from "../src/config.js";
import { recommendationsView, recordEvaluation, setDefaultModel } from "../src/recommendations.js";

test("recommendationsView ranks a fully validated coding model as recommended default", () => {
  let state = cloneDefaultState();
  state = recordEvaluation(state, "deepseek", "diagnostics", {
    score: 100,
    profile: {
      tier: "agent_ready",
      label: "适合 Codex Agent"
    }
  });
  state = recordEvaluation(state, "deepseek", "benchmark", {
    score: 100,
    tier: "coding_ready",
    label: "适合 Codex 代码任务",
    summary: {
      tests_pass: true
    }
  });

  const view = recommendationsView(state);
  const deepseek = view.items.find((item) => item.alias === "deepseek");

  assert.equal(view.recommendedDefault, "deepseek");
  assert.equal(deepseek.category, "recommended_default");
  assert.equal(deepseek.score, 100);
});

test("setDefaultModel updates the route default and rejects unknown aliases", () => {
  const state = cloneDefaultState();
  const updated = setDefaultModel(state, "deepseek");

  assert.equal(updated.config.provider.default_model, "deepseek");
  assert.throws(() => setDefaultModel(state, "missing"), /unknown route alias/);
});
