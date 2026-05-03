const DIAGNOSTIC_SCORE = {
  agent_ready: 55,
  agent_non_streaming: 42,
  chat_and_stream: 25,
  text_only: 12,
  unusable: 0
};

const BENCHMARK_SCORE = {
  coding_ready: 45,
  tool_loop_ready: 25,
  not_ready: 0
};

export function recommendationsView(state) {
  const config = state.config?.provider ?? {};
  const routes = routeList(config.routes ?? {});
  const evaluations = state.evaluations ?? {};
  const runtime = runtimeMetricsView(state.metrics?.records ?? []);
  const items = routes.map((route) => recommendationForRoute(route, config.default_model, evaluations[route.alias], runtime[route.alias]));
  items.sort((a, b) => {
    if (a.alias === config.default_model) {
      return -1;
    }
    if (b.alias === config.default_model) {
      return 1;
    }
    return b.score - a.score || a.alias.localeCompare(b.alias);
  });
  const recommended = items.find((item) => item.category === "recommended_default")
    ?? items.find((item) => item.category === "coding_ready")
    ?? null;
  return {
    defaultModel: config.default_model ?? "",
    recommendedDefault: recommended?.alias ?? "",
    items,
    runtime
  };
}

export function setDefaultModel(state, alias) {
  const next = structuredClone(state);
  const routes = next.config?.provider?.routes ?? {};
  if (!routes[alias]) {
    throw new Error(`unknown route alias: ${alias}`);
  }
  next.config.provider.default_model = alias;
  return next;
}

export function recordEvaluation(state, modelAlias, kind, result) {
  if (!modelAlias) {
    throw new Error("model alias is required");
  }
  if (!["diagnostics", "benchmark"].includes(kind)) {
    throw new Error(`unknown evaluation kind: ${kind}`);
  }
  const next = structuredClone(state);
  next.evaluations = next.evaluations ?? {};
  next.evaluations[modelAlias] = {
    ...(next.evaluations[modelAlias] ?? {}),
    [kind]: result,
    updatedAt: new Date().toISOString()
  };
  return next;
}

function recommendationForRoute(route, defaultModel, evaluation = {}, runtime = null) {
  const diagnostics = evaluation.diagnostics ?? null;
  const benchmark = evaluation.benchmark ?? null;
  const diagnosticTier = diagnostics?.profile?.tier ?? "unverified";
  const benchmarkTier = benchmark?.tier ?? "unverified";
  const diagnosticScore = diagnosticTier === "unverified" ? 0 : DIAGNOSTIC_SCORE[diagnosticTier] ?? 0;
  const benchmarkScore = benchmarkTier === "unverified" ? 0 : BENCHMARK_SCORE[benchmarkTier] ?? 0;
  const score = diagnosticScore + benchmarkScore;
  const category = categoryFor({ diagnosticTier, benchmarkTier, score, runtime });
  return {
    ...route,
    isDefault: route.alias === defaultModel,
    score,
    category,
    label: categoryLabel(category),
    diagnostics: diagnosticsSummary(diagnostics),
    benchmark: benchmarkSummary(benchmark),
    runtime: runtimeSummary(runtime),
    updatedAt: evaluation.updatedAt ?? diagnostics?.completedAt ?? benchmark?.completedAt ?? ""
  };
}

function categoryFor({ diagnosticTier, benchmarkTier, score, runtime }) {
  if (runtime && runtime.requests >= 5 && runtime.success_rate < 0.8) {
    return "runtime_unstable";
  }
  if (diagnosticTier === "agent_ready" && benchmarkTier === "coding_ready") {
    return "recommended_default";
  }
  if (diagnosticTier === "agent_non_streaming" && benchmarkTier === "coding_ready") {
    return "recommended_default";
  }
  if (benchmarkTier === "coding_ready" && score >= 70) {
    return "coding_ready";
  }
  if (diagnosticTier === "agent_ready" || benchmarkTier === "tool_loop_ready") {
    return "tool_loop_only";
  }
  if (["chat_and_stream", "text_only"].includes(diagnosticTier)) {
    return "text_only";
  }
  if (diagnosticTier === "unverified" && benchmarkTier === "unverified") {
    return "unverified";
  }
  return "not_ready";
}

function diagnosticsSummary(result) {
  if (!result) {
    return {
      tier: "unverified",
      label: "未诊断",
      score: 0,
      ok: false
    };
  }
  return {
    tier: result.profile?.tier ?? "unusable",
    label: result.profile?.label ?? "诊断失败",
    score: result.score ?? 0,
    ok: result.profile?.tier === "agent_ready",
    completedAt: result.completedAt ?? ""
  };
}

function benchmarkSummary(result) {
  if (!result) {
    return {
      tier: "unverified",
      label: "未运行",
      score: 0,
      ok: false
    };
  }
  return {
    tier: result.tier ?? "not_ready",
    label: result.label ?? "基准未通过",
    score: result.score ?? 0,
    ok: result.tier === "coding_ready",
    completedAt: result.completedAt ?? "",
    summary: result.summary ?? {}
  };
}

function runtimeSummary(result) {
  if (!result) {
    return {
      requests: 0,
      success: 0,
      failed: 0,
      success_rate: 0,
      avg_latency_ms: 0,
      protocols: [],
      usage_sources: [],
      actual_models: [],
      error_messages: []
    };
  }
  return result;
}

function runtimeMetricsView(records) {
  const perRoute = {};
  const scoped = [...records]
    .filter((record) => String(record.model ?? "").trim())
    .sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")));
  for (const record of scoped) {
    const alias = String(record.model ?? "").trim();
    if (!alias) {
      continue;
    }
    perRoute[alias] = perRoute[alias] ?? emptyRuntime();
    const bucket = perRoute[alias];
    bucket.requests += 1;
    if (record.status === "success") {
      bucket.success += 1;
    } else {
      bucket.failed += 1;
    }
    bucket.input_tokens += Number(record.normalized_input_tokens ?? record.input_tokens ?? 0);
    bucket.output_tokens += Number(record.normalized_output_tokens ?? record.output_tokens ?? 0);
    bucket.cache_read += Number(record.normalized_cache_read ?? record.cache_read ?? 0);
    bucket.cache_creation += Number(record.normalized_cache_creation ?? record.cache_creation ?? 0);
    bucket.latency_total_ms += Number(record.response_time ?? 0) / 1_000_000;
    bumpCount(bucket.protocols, record.protocol ?? "");
    bumpCount(bucket.usage_sources, record.usage_source ?? "");
    bumpCount(bucket.actual_models, record.actual_model || "");
    bumpCount(bucket.error_messages, record.error_message || "");
    if (!bucket.last_seen || String(record.timestamp ?? "") > bucket.last_seen) {
      bucket.last_seen = String(record.timestamp ?? "");
    }
  }
  return Object.fromEntries(Object.entries(perRoute).map(([alias, bucket]) => {
    const total = bucket.success + bucket.failed;
    return [alias, {
      requests: bucket.requests,
      success: bucket.success,
      failed: bucket.failed,
      success_rate: total > 0 ? bucket.success / total : 0,
      avg_latency_ms: total > 0 ? bucket.latency_total_ms / total : 0,
      input_tokens: bucket.input_tokens,
      output_tokens: bucket.output_tokens,
      cache_read: bucket.cache_read,
      cache_creation: bucket.cache_creation,
      protocols: topCounts(bucket.protocols),
      usage_sources: topCounts(bucket.usage_sources),
      actual_models: topCounts(bucket.actual_models),
      error_messages: topCounts(bucket.error_messages),
      last_seen: bucket.last_seen
    }];
  }));
}

function emptyRuntime() {
  return {
    requests: 0,
    success: 0,
    failed: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read: 0,
    cache_creation: 0,
    latency_total_ms: 0,
    protocols: {},
    usage_sources: {},
    actual_models: {},
    error_messages: {},
    last_seen: ""
  };
}

function bumpCount(map, key) {
  const value = String(key ?? "").trim();
  if (!value) {
    return;
  }
  map[value] = (map[value] ?? 0) + 1;
}

function topCounts(map) {
  return Object.entries(map)
    .sort(([, a], [, b]) => b - a)
    .map(([value, count]) => ({ value, count }));
}

function categoryLabel(category) {
  if (category === "recommended_default") {
    return "推荐默认";
  }
  if (category === "coding_ready") {
    return "适合代码任务";
  }
  if (category === "agent_non_streaming") {
    return "可用但流式需谨慎";
  }
  if (category === "runtime_unstable") {
    return "运行中不稳定";
  }
  if (category === "tool_loop_only") {
    return "工具链需谨慎";
  }
  if (category === "text_only") {
    return "仅适合文本";
  }
  if (category === "unverified") {
    return "未验证";
  }
  return "不建议默认";
}

function routeList(routes) {
  return Object.entries(routes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([alias, route]) => {
      const spec = route.to ?? "";
      const slash = spec.indexOf("/");
      return {
        alias,
        provider: slash > 0 ? spec.slice(0, slash) : "",
        model: slash > 0 ? spec.slice(slash + 1) : spec
      };
    });
}
