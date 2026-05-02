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
