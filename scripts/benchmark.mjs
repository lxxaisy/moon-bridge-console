#!/usr/bin/env node
import { runAgentBenchmark } from "../src/benchmark.js";

const args = parseArgs(process.argv.slice(2));
const baseURL = args.baseURL || process.env.BASE_URL || "http://127.0.0.1:38440/v1";
const model = args.model || process.env.MODEL || "xiaomi";
const authToken = args.authToken || process.env.AUTH_TOKEN || "";

const result = await runAgentBenchmark({ baseURL, model, authToken });
console.log(JSON.stringify(result, null, 2));

if (result.tier !== "coding_ready") {
  process.exitCode = 2;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--base-url") {
      out.baseURL = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--model") {
      out.model = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--auth-token") {
      out.authToken = argv[i + 1];
      i += 1;
    }
  }
  return out;
}
