import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { runAgentBenchmark } from "../src/benchmark.js";

test("runAgentBenchmark completes a small file edit tool loop", async () => {
  let turn = 0;
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/responses") {
      res.writeHead(404).end();
      return;
    }
    await readJSON(req);
    turn += 1;
    if (turn === 1) {
      json(res, responseWithCall("call_1", "list_files", "{}"));
      return;
    }
    if (turn === 2) {
      json(res, responseWithCall("call_2", "read_file", "{\"path\":\"math.js\"}"));
      return;
    }
    if (turn === 3) {
      json(res, responseWithCall("call_3", "write_file", "{\"path\":\"math.js\",\"content\":\"export function add(a, b) {\\n  return a + b;\\n}\\n\"}"));
      return;
    }
    if (turn === 4) {
      json(res, responseWithCall("call_4", "run_command", "{\"command\":[\"npm\",\"test\"]}"));
      return;
    }
    json(res, { id: `resp_${turn}`, status: "completed", output_text: "DONE", output: [] });
  });
  await listen(server);
  try {
    const result = await runAgentBenchmark({
      baseURL: `http://127.0.0.1:${server.address().port}/v1`,
      model: "moonbridge"
    });

    assert.equal(result.tier, "coding_ready");
    assert.equal(result.completed, true);
    assert.equal(result.summary.tests_pass, true);
    assert.equal(result.summary.write_file_calls, 1);
  } finally {
    server.close();
  }
});

function responseWithCall(callID, name, args) {
  return {
    id: `resp_${callID}`,
    status: "completed",
    output: [{
      type: "function_call",
      call_id: callID,
      name,
      arguments: args
    }]
  };
}

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
