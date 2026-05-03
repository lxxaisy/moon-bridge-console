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
  const items = routes.map((route) => recommendationForRoute(route, config.default_model, evaluations[route.alias]));
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
    items
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

function recommendationForRoute(route, defaultModel, evaluation = {}) {
  const diagnostics = evaluation.diagnostics ?? null;
  const benchmark = evaluation.benchmark ?? null;
  const diagnosticTier = diagnostics?.profile?.tier ?? "unverified";
  const benchmarkTier = benchmark?.tier ?? "unverified";
  const diagnosticScore = diagnosticTier === "unverified" ? 0 : DIAGNOSTIC_SCORE[diagnosticTier] ?? 0;
  const benchmarkScore = benchmarkTier === "unverified" ? 0 : BENCHMARK_SCORE[benchmarkTier] ?? 0;
  const score = diagnosticScore + benchmarkScore;
  const category = categoryFor({ diagnosticTier, benchmarkTier, score });
  return {
    ...route,
    isDefault: route.alias === defaultModel,
    score,
    category,
    label: categoryLabel(category),
    diagnostics: diagnosticsSummary(diagnostics),
    benchmark: benchmarkSummary(benchmark),
    updatedAt: evaluation.updatedAt ?? diagnostics?.completedAt ?? benchmark?.completedAt ?? ""
  };
}

function categoryFor({ diagnosticTier, benchmarkTier, score }) {
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
