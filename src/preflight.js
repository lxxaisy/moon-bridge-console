import { recommendationsView } from "./recommendations.js";

export function preflightReport({ state, status = null, upstream = null, metrics = null }) {
  const config = state.config ?? {};
  const view = recommendationsView({
    ...state,
    metrics: metrics?.records ? { records: metrics.records } : state.metrics
  });
  const checks = [
    ...runtimeChecks(state, status),
    ...providerChecks(state),
    ...routeChecks(state, view),
    ...codexChecks(state, view),
    ...metricsChecks(config, metrics),
    ...upstreamChecks(upstream)
  ];
  return {
    generatedAt: new Date().toISOString(),
    summary: summarizeChecks(checks),
    checks,
    recommendations: view,
    config: configSummary(state),
    metrics: metricsSummary(metrics),
    upstream: upstream ?? null
  };
}

export function reportMarkdown(report) {
  const lines = [
    "# Moon Bridge Console Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Status: ${report.summary.status}`,
    `- Passed: ${report.summary.pass}`,
    `- Warnings: ${report.summary.warn}`,
    `- Failed: ${report.summary.fail}`,
    "",
    "## Config",
    "",
    `- Moon Bridge Dir: ${report.config.moonBridgeDir}`,
    `- Base URL: ${report.config.baseURL}`,
    `- Config Path: ${report.config.configPath}`,
    `- Codex Home: ${report.config.codexHome}`,
    `- Default Model: ${report.config.defaultModel}`,
    `- Providers: ${report.config.providers.join(", ") || "-"}`,
    `- Routes: ${report.config.routes.join(", ") || "-"}`,
    "",
    "## Checks",
    ""
  ];
  for (const check of report.checks) {
    lines.push(`- [${check.level.toUpperCase()}] ${check.title}: ${check.message}`);
  }
  lines.push("", "## Model Recommendations", "");
  for (const item of report.recommendations.items ?? []) {
    lines.push(`- ${item.alias}: ${item.label}, score ${item.score}, runtime success ${Math.round((item.runtime?.success_rate ?? 0) * 100)}%`);
  }
  lines.push("", "## Metrics", "");
  lines.push(`- Requests: ${report.metrics.requests}`);
  lines.push(`- Success Rate: ${Math.round(report.metrics.successRate * 100)}%`);
  lines.push(`- Avg Latency: ${Math.round(report.metrics.avgLatencyMS)}ms`);
  lines.push("", "## Upstream", "");
  lines.push(`- Status: ${report.upstream?.status ?? "-"}`);
  lines.push(`- Verdict: ${report.upstream?.verdict ?? "-"}`);
  lines.push(`- Label: ${report.upstream?.label ?? "-"}`);
  return `${lines.join("\n")}\n`;
}

function runtimeChecks(state, status) {
  const checks = [];
  checks.push(check(
    state.moonBridgeDir,
    "moonbridge_dir",
    "Moon Bridge 目录",
    state.moonBridgeDir ? "Moon Bridge 目录已配置。" : "Moon Bridge 目录未配置。"
  ));
  checks.push(check(
    state.baseURL,
    "base_url",
    "Moon Bridge Base URL",
    state.baseURL ? "Base URL 已配置。" : "Base URL 未配置。"
  ));
  if (status?.moonBridge?.health?.ok) {
    checks.push(pass("moonbridge_health", "Moon Bridge 服务", "Moon Bridge 当前可访问。"));
  } else {
    checks.push(warn("moonbridge_health", "Moon Bridge 服务", status?.moonBridge?.running ? "进程已启动，但 /models 还不可用。" : "Moon Bridge 当前未运行。"));
  }
  return checks;
}

function providerChecks(state) {
  const providers = state.config?.provider?.providers ?? {};
  const out = [];
  for (const [name, provider] of Object.entries(providers)) {
    if (!provider.api_key) {
      out.push(warn(`provider_${name}_key`, `Provider ${name}`, "API key 未配置，启动后该 provider 无法访问上游。"));
    }
    out.push(endpointCheck(name, provider));
  }
  return out;
}

function endpointCheck(name, provider) {
  const baseURL = String(provider.base_url ?? "");
  const protocol = provider.protocol || "anthropic";
  if (protocol === "anthropic") {
    if (/\/v1\/?$/.test(baseURL) || /chat\/completions/.test(baseURL)) {
      return fail(`provider_${name}_endpoint`, `Provider ${name} endpoint`, "Anthropic 协议不应填写 OpenAI /v1 或 chat/completions endpoint。");
    }
    return pass(`provider_${name}_endpoint`, `Provider ${name} endpoint`, "Anthropic endpoint 形态正常。");
  }
  if (protocol === "openai-response") {
    if (/chat\/completions/.test(baseURL)) {
      return fail(`provider_${name}_endpoint`, `Provider ${name} endpoint`, "openai-response 协议需要 /v1/responses 兼容能力，不能使用 chat/completions endpoint。");
    }
    if (baseURL.includes("xiaomimimo.com/v1")) {
      return warn(`provider_${name}_endpoint`, `Provider ${name} endpoint`, "小米 /v1 是否支持 /v1/responses 需要确认；默认建议使用 /anthropic。");
    }
    return pass(`provider_${name}_endpoint`, `Provider ${name} endpoint`, "OpenAI Responses endpoint 形态正常。");
  }
  return fail(`provider_${name}_protocol`, `Provider ${name} protocol`, `未知协议: ${protocol}`);
}

function routeChecks(state, recommendations) {
  const out = [];
  const routes = state.config?.provider?.routes ?? {};
  const defaultModel = state.config?.provider?.default_model ?? "";
  out.push(check(
    routes[defaultModel],
    "default_route",
    "默认模型 route",
    routes[defaultModel] ? "默认模型 route 存在。" : "默认模型没有指向有效 route。"
  ));
  const current = (recommendations.items ?? []).find((item) => item.alias === defaultModel);
  if (!current) {
    out.push(fail("default_recommendation", "默认模型推荐", "默认模型不在推荐列表中。"));
  } else if (["recommended_default", "coding_ready"].includes(current.category)) {
    out.push(pass("default_recommendation", "默认模型推荐", `默认模型当前为 ${current.label}。`));
  } else {
    out.push(warn("default_recommendation", "默认模型推荐", `默认模型当前为 ${current.label}，建议先运行诊断和 Agent 基准。`));
  }
  return out;
}

function codexChecks(state, recommendations) {
  const out = [];
  out.push(check(
    state.codexHome,
    "codex_home",
    "Codex Home",
    state.codexHome ? "Codex Home 已配置。" : "Codex Home 未配置。"
  ));
  if (recommendations.recommendedDefault && recommendations.recommendedDefault !== state.config?.provider?.default_model) {
    out.push(warn("codex_sync_model", "Codex 同步模型", `推荐默认模型是 ${recommendations.recommendedDefault}，当前默认模型是 ${state.config?.provider?.default_model}。`));
  } else {
    out.push(pass("codex_sync_model", "Codex 同步模型", "Codex 默认模型选择与推荐状态一致或暂无推荐。"));
  }
  return out;
}

function metricsChecks(config, metrics) {
  const out = [];
  const configured = Boolean(config.extensions?.metrics?.enabled) && Boolean(config.extensions?.db_sqlite?.enabled);
  out.push(check(
    configured,
    "metrics_config",
    "Metrics 配置",
    configured ? "Metrics 和 SQLite 持久化已启用。" : "Metrics 未完整启用，无法长期观察模型稳定性。"
  ));
  if (metrics?.enabled) {
    out.push(pass("metrics_runtime", "Metrics 运行态", `已读取 ${metrics.count ?? 0} 条请求指标。`));
  } else {
    out.push(warn("metrics_runtime", "Metrics 运行态", metrics?.message || "尚未读取到 metrics 数据。"));
  }
  return out;
}

function upstreamChecks(upstream) {
  if (!upstream?.available) {
    return [warn("upstream_state", "Moon Bridge 上游状态", "无法读取本地 Moon Bridge git 状态。")];
  }
  if (upstream.verdict === "stay_v4") {
    return [pass("upstream_state", "Moon Bridge 上游状态", upstream.label)];
  }
  return [warn("upstream_state", "Moon Bridge 上游状态", upstream.label)];
}

function configSummary(state) {
  const provider = state.config?.provider ?? {};
  return {
    moonBridgeDir: state.moonBridgeDir ?? "",
    baseURL: state.baseURL ?? "",
    configPath: state.configPath ?? "",
    codexHome: state.codexHome ?? "",
    defaultModel: provider.default_model ?? "",
    providers: Object.keys(provider.providers ?? {}),
    routes: Object.keys(provider.routes ?? {})
  };
}

function metricsSummary(metrics) {
  const summary = metrics?.summary ?? {};
  return {
    requests: summary.requests ?? 0,
    successRate: summary.success_rate ?? 0,
    avgLatencyMS: summary.avg_response_time_ms ?? 0
  };
}

function summarizeChecks(checks) {
  const failCount = checks.filter((item) => item.level === "fail").length;
  const warnCount = checks.filter((item) => item.level === "warn").length;
  return {
    status: failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass",
    pass: checks.filter((item) => item.level === "pass").length,
    warn: warnCount,
    fail: failCount
  };
}

function check(condition, id, title, message) {
  return condition ? pass(id, title, message) : fail(id, title, message);
}

function pass(id, title, message) {
  return { id, title, message, level: "pass" };
}

function warn(id, title, message) {
  return { id, title, message, level: "warn" };
}

function fail(id, title, message) {
  return { id, title, message, level: "fail" };
}
