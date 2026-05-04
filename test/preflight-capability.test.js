import assert from "node:assert/strict";
import test from "node:test";
import { providerCapabilitySummary } from "../src/config.js";

test("providerCapabilitySummary distinguishes anthropic and openai-response providers", () => {
  const anthropic = providerCapabilitySummary({
    protocol: "anthropic",
    base_url: "https://token-plan-cn.xiaomimimo.com/anthropic"
  });
  const responses = providerCapabilitySummary({
    protocol: "openai-response",
    base_url: "https://api.openai.com"
  });

  assert.equal(anthropic.supportsAnthropicMessages, true);
  assert.equal(anthropic.supportsResponses, false);
  assert.equal(responses.supportsResponses, true);
  assert.equal(responses.supportsAnthropicMessages, false);
});
