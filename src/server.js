#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_STATE_PATH,
  applyConfigView,
  configView,
  loadState,
  makeProviderFromTemplate,
  saveState,
  validateState,
  writeMoonBridgeConfig
} from "./config.js";
import { runAgentBenchmark } from "./benchmark.js";
import { fetchMetrics, runDiagnostics, testProvider } from "./diagnostics.js";
import { preflightReport, reportMarkdown } from "./preflight.js";
import { recommendationsView, recordEvaluation, setDefaultModel } from "./recommendations.js";
import { probeMoonBridgeUpstream } from "./upstream.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

let statePath = process.env.MOON_BRIDGE_CONSOLE_STATE || DEFAULT_STATE_PATH;
let state = await loadState(statePath);
let moonBridge = {
  process: null,
  startedAt: null,
  logs: [],
  exit: null
};

const listenAddr = parseListenArgs(process.argv.slice(2));
const server = http.createServer(route);
server.listen(listenAddr.port, listenAddr.host, () => {
  const url = `http://${listenAddr.host}:${server.address().port}`;
  console.log(`Moon Bridge Console listening at ${url}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function route(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return serveFile(res, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
    }
    if (url.pathname.startsWith("/assets/")) {
      return serveStatic(res, url.pathname);
    }
    if (url.pathname === "/api/status" && req.method === "GET") {
      return json(res, await statusPayload());
    }
    if (url.pathname === "/api/config" && req.method === "GET") {
      return json(res, configView(state));
    }
    if (url.pathname === "/api/config" && req.method === "PUT") {
      const body = await readJSON(req);
      state = applyConfigView(state, body);
      await saveState(state, statePath);
      const configPath = await writeMoonBridgeConfig(state);
      return json(res, { ok: true, configPath, config: configView(state) });
    }
    if (url.pathname === "/api/recommendations" && req.method === "GET") {
      return json(res, recommendationsView(state));
    }
    if (url.pathname === "/api/default-model" && req.method === "POST") {
      const body = await readJSON(req);
      state = setDefaultModel(state, body.alias);
      await saveState(state, statePath);
      const configPath = await writeMoonBridgeConfig(state);
      return json(res, { ok: true, configPath, config: configView(state), recommendations: recommendationsView(state) });
    }
    if (url.pathname === "/api/provider/template" && req.method === "POST") {
      const body = await readJSON(req);
      const provider = makeProviderFromTemplate(body.templateID, body.apiKey ?? "");
      return json(res, { provider });
    }
    if (url.pathname === "/api/provider/test" && req.method === "POST") {
      const body = await readJSON(req);
      return json(res, await testProvider(body.provider, body.model));
    }
    if (url.pathname === "/api/moonbridge/start" && req.method === "POST") {
      const body = await readJSON(req);
      return json(res, await startMoonBridge(body));
    }
    if (url.pathname === "/api/moonbridge/stop" && req.method === "POST") {
      return json(res, await stopMoonBridge());
    }
    if (url.pathname === "/api/codex/sync" && req.method === "POST") {
      const body = await readJSON(req);
      validateState(state);
      const configPath = await writeMoonBridgeConfig(state);
      return json(res, await syncCodexViaMoonBridge({
        configPath,
        codexHome: body.codexHome || state.codexHome,
        model: body.model || state.config.provider.default_model,
        baseURL: body.baseURL || state.baseURL
      }));
    }
    if (url.pathname === "/api/diagnostics/run" && req.method === "POST") {
      const body = await readJSON(req);
      const model = body.model || state.config.provider.default_model;
      const result = await runDiagnostics({
        baseURL: body.baseURL || state.baseURL,
        model,
        authToken: state.config.server?.auth_token ?? ""
      });
      result.completedAt = new Date().toISOString();
      state = recordEvaluation(state, model, "diagnostics", result);
      await saveState(state, statePath);
      return json(res, result);
    }
    if (url.pathname === "/api/benchmark/run" && req.method === "POST") {
      const body = await readJSON(req);
      const model = body.model || state.config.provider.default_model;
      const result = await runAgentBenchmark({
        baseURL: body.baseURL || state.baseURL,
        model,
        authToken: state.config.server?.auth_token ?? ""
      });
      result.completedAt = new Date().toISOString();
      state = recordEvaluation(state, model, "benchmark", result);
      await saveState(state, statePath);
      return json(res, result);
    }
    if (url.pathname === "/api/metrics" && req.method === "GET") {
      return json(res, await fetchMetrics({
        baseURL: url.searchParams.get("baseURL") || state.baseURL,
        authToken: state.config.server?.auth_token ?? "",
        limit: Number(url.searchParams.get("limit") ?? 100)
      }));
    }
    if (url.pathname === "/api/logs" && req.method === "GET") {
      return json(res, { logs: moonBridge.logs });
    }
    if (url.pathname === "/api/upstream" && req.method === "GET") {
      return json(res, await probeMoonBridgeUpstream(state.moonBridgeDir || process.cwd()));
    }
    if (url.pathname === "/api/preflight" && req.method === "GET") {
      return json(res, await buildPreflightReport());
    }
    if (url.pathname === "/api/report" && req.method === "GET") {
      const report = await buildPreflightReport();
      res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
      return res.end(reportMarkdown(report));
    }
    if (url.pathname === "/api/report.json" && req.method === "GET") {
      return json(res, await buildPreflightReport());
    }
    return json(res, { error: "not found" }, 404);
  } catch (error) {
    return json(res, { error: error.message || String(error) }, 400);
  }
}

async function buildPreflightReport() {
  const metrics = await fetchMetrics({
    baseURL: state.baseURL,
    authToken: state.config.server?.auth_token ?? "",
    limit: 100
  });
  state.metrics = metrics.enabled ? { records: metrics.records } : state.metrics;
  const upstream = await probeMoonBridgeUpstream(state.moonBridgeDir || process.cwd());
  return preflightReport({
    state,
    status: await statusPayload(),
    upstream,
    metrics
  });
}

async function statusPayload() {
  const health = await moonBridgeHealth();
  const capabilities = await moonBridgeCapabilities();
  return {
    console: {
      statePath,
      pid: process.pid
    },
    moonBridge: {
      running: Boolean(moonBridge.process),
      pid: moonBridge.process?.pid ?? null,
      startedAt: moonBridge.startedAt,
      exit: moonBridge.exit,
      health,
      capabilities
    },
    config: configView(state)
  };
}

async function startMoonBridge(options = {}) {
  if (moonBridge.process) {
    return { ok: true, running: true, pid: moonBridge.process.pid, message: "Moon Bridge is already running" };
  }
  state = applyConfigView(state, options.config ?? configView(state));
  await saveState(state, statePath);
  const configPath = await writeMoonBridgeConfig(state);
  await ensureMoonBridgeRuntimeDirs();
  const command = moonBridgeCommand();
  const args = moonBridgeArgs(command, configPath);
  const cwd = state.moonBridgeDir || process.cwd();
  moonBridge.logs = [];
  moonBridge.exit = null;
  moonBridge.startedAt = new Date().toISOString();
  moonBridge.process = spawn(command.bin, args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  attachLogs(moonBridge.process.stdout, "stdout");
  attachLogs(moonBridge.process.stderr, "stderr");
  moonBridge.process.on("exit", (code, signal) => {
    moonBridge.exit = { code, signal, at: new Date().toISOString() };
    moonBridge.process = null;
  });
  return {
    ok: true,
    running: true,
    pid: moonBridge.process.pid,
    configPath,
    command: command.label,
    args
  };
}

async function stopMoonBridge() {
  if (!moonBridge.process) {
    return { ok: true, running: false, message: "Moon Bridge is not running" };
  }
  const child = moonBridge.process;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  if (moonBridge.process === child) {
    child.kill("SIGKILL");
    moonBridge.process = null;
  }
  return { ok: true, running: false };
}

async function moonBridgeHealth() {
  try {
    const response = await fetch(`${state.baseURL.replace(/\/+$/, "")}/models`, {
      headers: state.config.server?.auth_token ? { authorization: `Bearer ${state.config.server.auth_token}` } : {},
      signal: AbortSignal.timeout(2000)
    });
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    const payload = await response.json();
    return { ok: true, status: response.status, modelCount: (payload.models ?? payload.data ?? []).length };
  } catch (error) {
    return { ok: false, message: error.message || String(error) };
  }
}

async function moonBridgeCapabilities() {
  const baseURL = state.baseURL.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  const headers = state.config.server?.auth_token ? { authorization: `Bearer ${state.config.server.auth_token}` } : {};
  const capabilities = {
    configFormat: "v4",
    managementAPI: false,
    managementBaseURL: `${baseURL}/api/v1`,
    notes: []
  };
  try {
    const response = await fetch(`${baseURL}/api/v1/status`, {
      headers,
      signal: AbortSignal.timeout(2000)
    });
    if (response.ok) {
      const payload = await response.json();
      capabilities.configFormat = "v5";
      capabilities.managementAPI = true;
      capabilities.version = payload.version ?? "";
      capabilities.providerCount = payload.provider_count ?? 0;
      capabilities.routeCount = payload.route_count ?? 0;
      capabilities.notes.push("Moon Bridge dev/v5 management API is available.");
    } else if (response.status === 404) {
      capabilities.notes.push("Management API not detected; using v4 YAML workflow.");
    } else {
      capabilities.notes.push(`Management API probe returned HTTP ${response.status}.`);
    }
  } catch (error) {
    capabilities.notes.push(`Management API probe failed: ${error.message || String(error)}`);
  }
  if (capabilities.configFormat === "v4") {
    capabilities.notes.push("If Moon Bridge dev/v5 is promoted to main, this console should switch to top-level providers/models/routes or /api/v1 changes.");
  }
  return capabilities;
}

function moonBridgeCommand() {
  if (state.moonBridgeBinary) {
    return { bin: state.moonBridgeBinary, label: state.moonBridgeBinary };
  }
  return { bin: "go", label: "go run ./cmd/moonbridge" };
}

function moonBridgeArgs(command, configPath) {
  const args = ["-config", configPath];
  if (state.config.server?.addr) {
    args.push("-addr", state.config.server.addr);
  }
  if (command.bin === "go") {
    return ["run", "./cmd/moonbridge", ...args];
  }
  return args;
}

async function syncCodexViaMoonBridge({ configPath, codexHome, model, baseURL }) {
  if (!codexHome) {
    throw new Error("codexHome is required");
  }
  if (!model) {
    throw new Error("model alias is required");
  }
  const command = moonBridgeCommand();
  const cliArgs = ["-config", configPath, "-print-codex-config", model, "-codex-base-url", baseURL, "-codex-home", codexHome];
  const args = command.bin === "go" ? ["run", "./cmd/moonbridge", ...cliArgs] : cliArgs;
  const result = await runCommand(command.bin, args, state.moonBridgeDir || process.cwd());
  const configTomlPath = path.join(codexHome, "config.toml");
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(configTomlPath, result.stdout);
  return {
    codexHome,
    configPath: configTomlPath,
    catalogPath: path.join(codexHome, "models_catalog.json"),
    model,
    baseURL
  };
}

function runCommand(bin, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `${bin} exited with ${code}`));
      }
    });
  });
}

function attachLogs(stream, source) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line) {
        continue;
      }
      moonBridge.logs.push({ source, line, at: new Date().toISOString() });
      if (moonBridge.logs.length > 500) {
        moonBridge.logs.shift();
      }
    }
  });
}

async function ensureMoonBridgeRuntimeDirs() {
  const dbPath = state.config.extensions?.db_sqlite?.config?.path;
  if (!state.config.extensions?.db_sqlite?.enabled || !dbPath) {
    return;
  }
  const resolved = path.isAbsolute(dbPath) ? dbPath : path.join(state.moonBridgeDir || process.cwd(), dbPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
}

async function serveStatic(res, pathname) {
  const filePath = path.normalize(path.join(publicDir, pathname.replace(/^\/assets\//, "")));
  if (!filePath.startsWith(publicDir)) {
    return json(res, { error: "invalid asset path" }, 400);
  }
  const type = filePath.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
  return serveFile(res, filePath, type);
}

async function serveFile(res, filePath, contentType) {
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "content-type": contentType });
    res.end(data);
  } catch {
    json(res, { error: "not found" }, 404);
  }
}

async function readJSON(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res, payload, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function parseListenArgs(args) {
  const portIndex = args.indexOf("--port");
  const hostIndex = args.indexOf("--host");
  return {
    host: hostIndex >= 0 ? args[hostIndex + 1] : process.env.HOST || "127.0.0.1",
    port: Number(portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 38540)
  };
}

async function shutdown() {
  await stopMoonBridge();
  server.close(() => process.exit(0));
}
