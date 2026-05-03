import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { runDiagnostics } from "../src/diagnostics.js";

test("runDiagnostics reports compatible text, stream, tool call, and round trip", async () => {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/responses") {
      res.writeHead(404).end();
      return;
    }
    const body = await readJSON(req);
    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { type: "response.created" },
        { type: "response.in_progress" },
        { type: "response.output_text.delta", delta: "moonbridge-ok" },
        { type: "response.completed" }
      ]) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.end("data: [DONE]\n\n");
      return;
    }
    if (Array.isArray(body.input)) {
      json(res, { status: "completed", output_text: "done", output: [] });
      return;
    }
    if (body.tools?.length) {
      json(res, {
        status: "completed",
        output: [{
          type: "function_call",
          name: "echo_text",
          call_id: "call_1",
          arguments: "{\"text\":\"moonbridge-ok\"}"
        }]
      });
      return;
    }
    json(res, { status: "completed", output_text: "moonbridge-ok", output: [] });
  });
  await listen(server);
  try {
    const result = await runDiagnostics({
      baseURL: `http://127.0.0.1:${server.address().port}/v1`,
      model: "moonbridge"
    });

    assert.equal(result.score, 100);
    assert.equal(result.profile.tier, "agent_ready");
    assert.equal(result.checks.length, 4);
    assert.ok(result.checks.every((check) => check.ok));
  } finally {
    server.close();
  }
});

test("summarizeMetrics includes normalized usage and top counts", async () => {
  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith("/admin/metrics")) {
      json(res, {
        records: [
          {
            timestamp: "2026-05-03T00:00:00.000Z",
            model: "moonbridge",
            actual_model: "kimi-for-coding",
            protocol: "anthropic",
            usage_source: "anthropic_stream",
            input_tokens: 100,
            output_tokens: 25,
            cache_read: 40,
            cache_creation: 10,
            raw_input_tokens: 110,
            raw_output_tokens: 25,
            raw_cache_read: 40,
            raw_cache_creation: 10,
            normalized_input_tokens: 100,
            normalized_output_tokens: 25,
            normalized_cache_read: 40,
            normalized_cache_creation: 10,
            cost: 0.3,
            response_time: 5_000_000,
            status: "success"
          }
        ],
        count: 1
      });
      return;
    }
    res.writeHead(404).end();
  });
  await listen(server);
  try {
    const payload = await (await import("../src/diagnostics.js")).fetchMetrics({
      baseURL: `http://127.0.0.1:${server.address().port}`,
      limit: 10
    });
    assert.equal(payload.enabled, true);
    assert.equal(payload.summary.requests, 1);
    assert.equal(payload.summary.normalized_input_tokens, 100);
    assert.equal(payload.summary.raw_input_tokens, 110);
    assert.equal(payload.summary.protocols[0].value, "anthropic");
    assert.equal(payload.summary.actual_models[0].value, "kimi-for-coding");
  } finally {
    server.close();
  }
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function json(res, payload) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readJSON(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
