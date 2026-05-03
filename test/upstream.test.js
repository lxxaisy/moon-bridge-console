import assert from "node:assert/strict";
import test from "node:test";
import { classifyUpstream } from "../src/upstream.js";

test("classifyUpstream prefers v4 when dev is ahead but not merged", () => {
  const result = classifyUpstream({
    merged: false,
    mainHasDev: false,
    ahead: 32,
    behind: 1
  });

  assert.equal(result.verdict, "stay_v4");
  assert.equal(result.status, "dev_ahead");
  assert.match(result.label, /v5 更强/);
});

test("classifyUpstream switches to v5 once dev is merged into main", () => {
  const result = classifyUpstream({
    merged: true,
    mainHasDev: true,
    ahead: 0,
    behind: 0
  });

  assert.equal(result.verdict, "switch_v5_ready");
  assert.equal(result.status, "v5_merged");
});
