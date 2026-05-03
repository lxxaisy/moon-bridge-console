const $ = (id) => document.getElementById(id);

const state = {
  config: null,
  status: null,
  recommendations: null
};

document.addEventListener("DOMContentLoaded", async () => {
  bindTabs();
  bindActions();
  await refreshAll();
});

function bindTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      $(button.dataset.tab).classList.add("active");
    });
  });
}

function bindActions() {
  $("refreshButton").addEventListener("click", refreshAll);
  $("saveButton").addEventListener("click", saveConfig);
  $("startButton").addEventListener("click", startMoonBridge);
  $("stopButton").addEventListener("click", stopMoonBridge);
  $("addProviderButton").addEventListener("click", addProvider);
  $("addTemplateButton").addEventListener("click", addTemplateProvider);
  $("addRouteButton").addEventListener("click", addRoute);
  $("syncCodexButton").addEventListener("click", syncCodex);
  $("runDiagnosticsButton").addEventListener("click", runDiagnostics);
  $("runBenchmarkButton").addEventListener("click", runBenchmark);
  $("loadMetricsButton").addEventListener("click", loadMetrics);
  $("refreshRecommendationsButton").addEventListener("click", refreshRecommendations);
}

async function refreshAll() {
  state.status = await getJSON("/api/status");
  state.config = await getJSON("/api/config");
  state.recommendations = await getJSON("/api/recommendations");
  renderConfig();
  renderStatus();
  renderRecommendations();
  await refreshLogs();
}

function renderConfig() {
  const cfg = state.config;
  $("moonBridgeDir").value = cfg.moonBridgeDir ?? "";
  $("moonBridgeBinary").value = cfg.moonBridgeBinary ?? "";
  $("configPath").value = cfg.configPath ?? "";
  $("addr").value = cfg.addr ?? "";
  $("baseURL").value = cfg.baseURL ?? "";
  $("authToken").value = "";
  $("defaultMaxTokens").value = cfg.defaultMaxTokens ?? 0;
  $("codexHome").value = cfg.codexHome ?? "";
  $("diagnosticsBaseURL").value = cfg.baseURL ?? "";
  $("benchmarkBaseURL").value = cfg.baseURL ?? "";
  renderTemplateSelect();
  renderRouteSelects();
  renderProviders();
  renderRoutes();
}

function renderTemplateSelect() {
  $("templateSelect").innerHTML = (state.config.templates ?? [])
    .map((template) => `<option value="${escapeHTML(template.id)}">${escapeHTML(template.name)}</option>`)
    .join("");
}

function renderRouteSelects() {
  const routes = state.config.routes ?? [];
  for (const id of ["defaultModel", "codexModel", "diagnosticsModel", "benchmarkModel"]) {
    $(id).innerHTML = routes.map((route) => `<option value="${escapeHTML(route.alias)}">${escapeHTML(route.alias)}</option>`).join("");
  }
  $("defaultModel").value = state.config.defaultModel ?? "";
  $("codexModel").value = state.config.defaultModel ?? "";
  $("diagnosticsModel").value = state.config.defaultModel ?? "";
  $("benchmarkModel").value = state.config.defaultModel ?? "";
}

function renderStatus() {
  const health = state.status?.moonBridge?.health ?? {};
  const running = Boolean(state.status?.moonBridge?.running);
  $("healthBadge").textContent = health.ok ? "Moon Bridge 可用" : running ? "启动中/不可用" : "未启动";
  $("healthBadge").className = `badge ${health.ok ? "good" : running ? "warn" : "bad"}`;
  $("activeModel").textContent = `默认模型: ${state.config.defaultModel || "-"}`;
  $("processState").textContent = running ? `运行中 PID ${state.status.moonBridge.pid}` : "未运行";
  $("modelCount").textContent = health.modelCount ?? "-";
  $("configPathText").textContent = state.config.configPath ?? "-";
  const capabilities = state.status?.moonBridge?.capabilities ?? {};
  $("capabilityState").textContent = capabilities.managementAPI ? "v5 API 可用" : "v4 YAML 模式";
  $("capabilityNotes").textContent = (capabilities.notes ?? []).join("\n");
}

function renderRecommendations() {
  const payload = state.recommendations ?? { items: [] };
  const recommended = payload.recommendedDefault || "";
  $("recommendationSummary").innerHTML = recommended
    ? `推荐默认模型：<strong>${escapeHTML(recommended)}</strong>。确认后可一键设为默认，并重新同步 Codex。`
    : "还没有足够结果。先在“兼容诊断”和“Agent 基准”分别运行目标模型。";
  $("recommendationList").innerHTML = "";
  for (const item of payload.items ?? []) {
    const row = document.createElement("article");
    row.className = "item recommendation";
    row.innerHTML = `
      <div class="item-head">
        <div>
          <h3>${escapeHTML(item.alias)} ${item.isDefault ? "<span class=\"badge good\">当前默认</span>" : ""}</h3>
          <p class="muted">${escapeHTML(item.provider)} / ${escapeHTML(item.model)}</p>
        </div>
        <div class="actions">
          <span class="badge ${recommendationBadgeClass(item.category)}">${escapeHTML(item.label)}</span>
          <span class="badge">评分 ${Number(item.score ?? 0)}</span>
          <button type="button" data-action="set-default-model" data-alias="${escapeAttr(item.alias)}"${item.isDefault ? " disabled" : ""}>设为默认</button>
        </div>
      </div>
      <div class="profile compact-profile">
        <div><span>兼容诊断</span><strong>${escapeHTML(item.diagnostics?.label ?? "未诊断")}</strong></div>
        <div><span>诊断评分</span><strong>${Number(item.diagnostics?.score ?? 0)}</strong></div>
        <div><span>Agent 基准</span><strong>${escapeHTML(item.benchmark?.label ?? "未运行")}</strong></div>
        <div><span>基准评分</span><strong>${Number(item.benchmark?.score ?? 0)}</strong></div>
        <div><span>运行成功率</span><strong>${Math.round((item.runtime?.success_rate ?? 0) * 100)}%</strong></div>
        <div><span>平均耗时</span><strong>${Math.round(item.runtime?.avg_latency_ms ?? 0)}ms</strong></div>
        <div><span>实际模型</span><strong>${escapeHTML(item.runtime?.actual_models?.[0]?.value ?? "-")}</strong></div>
        <div><span>Usage Source</span><strong>${escapeHTML(item.runtime?.usage_sources?.[0]?.value ?? "-")}</strong></div>
      </div>
      <p class="muted small">${item.updatedAt ? `最近验证：${escapeHTML(item.updatedAt)}` : "尚未验证"}${item.runtime?.last_seen ? ` · 最近请求：${escapeHTML(item.runtime.last_seen)}` : ""}</p>
    `;
    $("recommendationList").appendChild(row);
  }
  $("recommendationList").querySelectorAll("button[data-action='set-default-model']").forEach((button) => {
    button.addEventListener("click", setRecommendedDefault);
  });
}

function renderProviders() {
  $("providerList").innerHTML = "";
  (state.config.providers ?? []).forEach((provider, index) => {
    const item = document.createElement("article");
    item.className = "item";
    item.innerHTML = `
      <div class="item-head">
        <div>
          <h3>${escapeHTML(provider.name || "未命名 Provider")}</h3>
          <p class="muted">${escapeHTML(provider.protocol || "anthropic")} · ${escapeHTML(provider.base_url || "")}</p>
        </div>
        <div class="actions">
          <button type="button" data-action="test-provider" data-index="${index}">测试</button>
          <button type="button" data-action="add-model" data-index="${index}">新增模型</button>
          <button type="button" data-action="remove-provider" data-index="${index}">删除</button>
        </div>
      </div>
      <div class="provider-grid">
        <label><span>名称</span><input id="provider-name-${index}" value="${escapeAttr(provider.name)}" /></label>
        <label><span>Base URL</span><input id="provider-url-${index}" value="${escapeAttr(provider.base_url)}" /></label>
        <label><span>协议</span><select id="provider-protocol-${index}">
          <option value="anthropic">anthropic</option>
          <option value="openai-response">openai-response</option>
        </select></label>
        <label><span>Version</span><input id="provider-version-${index}" value="${escapeAttr(provider.version)}" /></label>
        <label><span>API Key</span><input id="provider-key-${index}" type="password" value="${escapeAttr(provider.api_key)}" autocomplete="off" /></label>
        <label><span>User Agent</span><input id="provider-agent-${index}" value="${escapeAttr(provider.user_agent)}" /></label>
        <label><span>Web Search</span><select id="provider-search-${index}">
          <option value="disabled">disabled</option>
          <option value="auto">auto</option>
          <option value="enabled">enabled</option>
          <option value="injected">injected</option>
        </select></label>
      </div>
      <div id="models-${index}" class="model-list"></div>
      <pre id="provider-test-${index}" class="mini-result"></pre>
    `;
    $("providerList").appendChild(item);
    $(`provider-protocol-${index}`).value = provider.protocol || "anthropic";
    $(`provider-search-${index}`).value = provider.web_search_support || "disabled";
    renderModels(index, provider.models ?? []);
  });
  $("providerList").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", handleProviderAction);
  });
}

function renderModels(providerIndex, models) {
  const root = $(`models-${providerIndex}`);
  root.innerHTML = "";
  models.forEach((model, modelIndex) => {
    const row = document.createElement("div");
    row.className = "model-row";
    row.innerHTML = `
      <label><span>模型名</span><input id="model-name-${providerIndex}-${modelIndex}" value="${escapeAttr(model.name)}" /></label>
      <label><span>Context</span><input id="model-context-${providerIndex}-${modelIndex}" type="number" value="${escapeAttr(model.context_window)}" /></label>
      <label><span>Max Output</span><input id="model-output-${providerIndex}-${modelIndex}" type="number" value="${escapeAttr(model.max_output_tokens)}" /></label>
      <label><span>Reasoning</span><input id="model-reasoning-${providerIndex}-${modelIndex}" value="${escapeAttr(model.default_reasoning_level)}" /></label>
      <label><span>显示名</span><input id="model-display-${providerIndex}-${modelIndex}" value="${escapeAttr(model.display_name)}" /></label>
      <button type="button" data-action="remove-model" data-provider="${providerIndex}" data-model="${modelIndex}">删除</button>
    `;
    root.appendChild(row);
  });
  root.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", handleProviderAction);
  });
}

function renderRoutes() {
  $("routeList").innerHTML = "";
  (state.config.routes ?? []).forEach((route, index) => {
    const row = document.createElement("article");
    row.className = "item route-row";
    row.innerHTML = `
      <label><span>Alias</span><input id="route-alias-${index}" value="${escapeAttr(route.alias)}" /></label>
      <label><span>Provider</span><select id="route-provider-${index}">${providerOptions()}</select></label>
      <label><span>Model</span><select id="route-model-${index}"></select></label>
      <button type="button" data-route="${index}">删除</button>
    `;
    $("routeList").appendChild(row);
    $(`route-provider-${index}`).value = route.provider;
    updateRouteModelOptions(index, route.provider, route.model);
    $(`route-provider-${index}`).addEventListener("change", () => updateRouteModelOptions(index, $(`route-provider-${index}`).value));
    row.querySelector("button").addEventListener("click", () => {
      collectConfig();
      state.config.routes.splice(index, 1);
      renderRoutes();
      renderRouteSelects();
    });
  });
}

function providerOptions() {
  return (state.config.providers ?? [])
    .map((provider) => `<option value="${escapeHTML(provider.name)}">${escapeHTML(provider.name)}</option>`)
    .join("");
}

function updateRouteModelOptions(index, providerName, selectedModel = "") {
  const provider = (state.config.providers ?? []).find((item) => item.name === providerName);
  const models = provider?.models ?? [];
  $(`route-model-${index}`).innerHTML = models.map((model) => `<option value="${escapeHTML(model.name)}">${escapeHTML(model.name)}</option>`).join("");
  $(`route-model-${index}`).value = selectedModel || models[0]?.name || "";
}

async function handleProviderAction(event) {
  collectConfig();
  const action = event.currentTarget.dataset.action;
  const index = Number(event.currentTarget.dataset.index ?? event.currentTarget.dataset.provider);
  if (action === "remove-provider") {
    state.config.providers.splice(index, 1);
  }
  if (action === "add-model") {
    state.config.providers[index].models.push(emptyModel());
  }
  if (action === "remove-model") {
    state.config.providers[index].models.splice(Number(event.currentTarget.dataset.model), 1);
  }
  if (action === "test-provider") {
    const provider = state.config.providers[index];
    const result = await postJSON("/api/provider/test", { provider, model: provider.models?.[0]?.name ?? "" });
    $(`provider-test-${index}`).textContent = JSON.stringify(result, null, 2);
    return;
  }
  renderProviders();
  renderRoutes();
  renderRouteSelects();
}

function addProvider() {
  collectConfig();
  state.config.providers.push({
    name: `provider${state.config.providers.length + 1}`,
    base_url: "",
    api_key: "",
    protocol: "anthropic",
    version: "2023-06-01",
    user_agent: "",
    web_search_support: "disabled",
    models: [emptyModel()]
  });
  renderProviders();
}

async function addTemplateProvider() {
  collectConfig();
  const payload = await postJSON("/api/provider/template", { templateID: $("templateSelect").value });
  state.config.providers.push(payload.provider);
  renderProviders();
  toast("模板已添加");
}

function addRoute() {
  collectConfig();
  const provider = state.config.providers[0];
  state.config.routes.push({
    alias: `model${state.config.routes.length + 1}`,
    provider: provider?.name ?? "",
    model: provider?.models?.[0]?.name ?? ""
  });
  renderRoutes();
  renderRouteSelects();
}

async function saveConfig() {
  collectConfig();
  const result = await putJSON("/api/config", state.config);
  state.config = result.config;
  state.recommendations = await getJSON("/api/recommendations");
  renderConfig();
  renderRecommendations();
  toast(`已写入 ${result.configPath}`);
}

async function startMoonBridge() {
  collectConfig();
  const result = await postJSON("/api/moonbridge/start", { config: state.config });
  toast(result.message || `Moon Bridge PID ${result.pid}`);
  await refreshAll();
}

async function stopMoonBridge() {
  const result = await postJSON("/api/moonbridge/stop", {});
  toast(result.message || "Moon Bridge 已停止");
  await refreshAll();
}

async function syncCodex() {
  collectConfig();
  await saveConfig();
  const result = await postJSON("/api/codex/sync", {
    codexHome: $("codexHome").value,
    model: $("codexModel").value,
    baseURL: $("baseURL").value
  });
  $("codexResult").textContent = [
    "Codex 配置已同步",
    `config.toml: ${result.configPath}`,
    `models_catalog.json: ${result.catalogPath}`,
    `model: ${result.model}`,
    `baseURL: ${result.baseURL}`
  ].join("\n");
  toast("Codex 配置已同步");
}

async function runDiagnostics() {
  $("diagnosticsScore").textContent = "诊断中...";
  $("diagnosticsProfile").innerHTML = "";
  $("diagnosticsList").innerHTML = "";
  const result = await postJSON("/api/diagnostics/run", {
    model: $("diagnosticsModel").value,
    baseURL: $("diagnosticsBaseURL").value
  });
  $("diagnosticsScore").textContent = `兼容评分 ${result.score}/100 · ${result.model} · ${result.baseURL}`;
  renderDiagnosticsProfile(result.profile);
  for (const check of result.checks ?? []) {
    const item = document.createElement("article");
    item.className = "item";
    item.innerHTML = `
      <div class="item-head">
        <div>
          <h3>${escapeHTML(check.name)}</h3>
          <p class="muted">${escapeHTML(check.message ?? "")}</p>
        </div>
        <div class="actions">
          <span class="badge ${check.ok ? "good" : "bad"}">${check.ok ? "通过" : "失败"}</span>
          <span class="badge">${Number(check.latency_ms ?? 0)}ms</span>
        </div>
      </div>
      <pre class="mini-result">${escapeHTML(JSON.stringify(check.details ?? {}, null, 2))}</pre>
    `;
    $("diagnosticsList").appendChild(item);
  }
  const advice = document.createElement("article");
  advice.className = "item";
  advice.innerHTML = `<h3>建议</h3><ul>${(result.recommendations ?? []).map((text) => `<li>${escapeHTML(text)}</li>`).join("")}</ul>`;
  $("diagnosticsList").appendChild(advice);
  toast("诊断完成");
  await refreshRecommendations();
}

function renderDiagnosticsProfile(profile) {
  if (!profile) {
    $("diagnosticsProfile").innerHTML = "";
    return;
  }
  $("diagnosticsProfile").innerHTML = `
    <div><span>能力等级</span><strong>${escapeHTML(profile.label)}</strong></div>
    <div><span>流式</span><strong>${profile.supports_stream ? "稳定" : "需排查"}</strong></div>
    <div><span>工具调用</span><strong>${profile.supports_tool_call && profile.supports_tool_round_trip ? "可用" : "不稳定"}</strong></div>
    <div><span>建议用途</span><strong>${escapeHTML(profile.suggested_usage)}</strong></div>
  `;
}

async function loadMetrics() {
  const payload = await getJSON(`/api/metrics?baseURL=${encodeURIComponent($("baseURL").value)}&limit=100`);
  const summary = payload.summary ?? {};
  $("metricRequests").textContent = summary.requests ?? 0;
  $("metricStatus").textContent = `${summary.success ?? 0} / ${summary.failed ?? 0}`;
  $("metricTokens").textContent = Number((summary.input_tokens ?? 0) + (summary.output_tokens ?? 0)).toLocaleString();
  $("metricCost").textContent = `¥${Number(summary.cost ?? 0).toFixed(4)}`;
  $("metricSuccessRate").textContent = `${Math.round((summary.success_rate ?? 0) * 100)}%`;
  $("metricLatency").textContent = `${Math.round(summary.avg_response_time_ms ?? 0)}ms`;
  $("metricProtocols").textContent = formatTopCounts(summary.protocols ?? []);
  $("metricActualModels").textContent = formatTopCounts(summary.actual_models ?? []);
  $("metricUsageSources").textContent = formatCountList(summary.usage_sources ?? []);
  $("metricErrors").textContent = formatCountList(summary.error_messages ?? []);
  $("metricRawTokens").textContent = [
    `input: ${Number(summary.raw_input_tokens ?? 0).toLocaleString()}`,
    `output: ${Number(summary.raw_output_tokens ?? 0).toLocaleString()}`,
    `cache_read: ${Number(summary.raw_cache_read ?? 0).toLocaleString()}`,
    `cache_creation: ${Number(summary.raw_cache_creation ?? 0).toLocaleString()}`
  ].join("\n");
  $("metricNormalizedTokens").textContent = [
    `input: ${Number(summary.normalized_input_tokens ?? 0).toLocaleString()}`,
    `output: ${Number(summary.normalized_output_tokens ?? 0).toLocaleString()}`,
    `cache_read: ${Number(summary.normalized_cache_read ?? 0).toLocaleString()}`,
    `cache_creation: ${Number(summary.normalized_cache_creation ?? 0).toLocaleString()}`
  ].join("\n");
  $("metricsTable").innerHTML = "";
  for (const record of payload.records ?? []) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHTML(record.timestamp ?? "")}</td>
      <td>${escapeHTML(record.model ?? "")}</td>
      <td>${escapeHTML(record.actual_model ?? "")}</td>
      <td>${escapeHTML(record.protocol ?? "")}</td>
      <td>${escapeHTML(record.usage_source ?? "")}</td>
      <td>${Number(record.input_tokens ?? 0)}</td>
      <td>${Number(record.output_tokens ?? 0)}</td>
      <td>${Number(record.cache_read ?? 0)}</td>
      <td>¥${Number(record.cost ?? 0).toFixed(4)}</td>
      <td>${escapeHTML(record.status ?? "")}</td>
    `;
    $("metricsTable").appendChild(row);
  }
  toast(payload.enabled ? "指标已加载" : payload.message || "metrics 未启用");
}

async function runBenchmark() {
  $("benchmarkScore").textContent = "基准运行中...";
  $("benchmarkProfile").innerHTML = "";
  $("benchmarkTable").innerHTML = "";
  $("benchmarkWorkspace").textContent = "";
  const result = await postJSON("/api/benchmark/run", {
    model: $("benchmarkModel").value,
    baseURL: $("benchmarkBaseURL").value
  });
  $("benchmarkScore").textContent = `Agent 基准 ${result.score}/100 · ${result.label} · ${result.duration_ms}ms`;
  $("benchmarkProfile").innerHTML = `
    <div><span>等级</span><strong>${escapeHTML(result.tier)}</strong></div>
    <div><span>工具调用</span><strong>${Number(result.summary?.tool_calls ?? 0)}</strong></div>
    <div><span>写文件</span><strong>${Number(result.summary?.write_file_calls ?? 0)}</strong></div>
    <div><span>测试</span><strong>${result.summary?.tests_pass ? "通过" : "失败"}</strong></div>
  `;
  for (const step of result.steps ?? []) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${Number(step.turn ?? 0)}</td>
      <td>${escapeHTML(step.type ?? "")}</td>
      <td>${escapeHTML(step.tool ?? "")}</td>
      <td><span class="badge ${step.ok ? "good" : "bad"}">${step.ok ? "通过" : "失败"}</span></td>
      <td><pre class="table-json">${escapeHTML(JSON.stringify(step.output ?? step.message ?? step.details ?? {}, null, 2))}</pre></td>
    `;
    $("benchmarkTable").appendChild(row);
  }
  $("benchmarkWorkspace").textContent = [
    "最终工作区",
    JSON.stringify(result.workspace ?? {}, null, 2),
    "",
    "建议",
    ...(result.recommendations ?? [])
  ].join("\n");
  toast("Agent 基准完成");
  await refreshRecommendations();
}

async function refreshRecommendations() {
  state.recommendations = await getJSON("/api/recommendations");
  state.config = await getJSON("/api/config");
  renderRouteSelects();
  renderStatus();
  renderRecommendations();
}

async function setRecommendedDefault(event) {
  collectConfig();
  const alias = event.currentTarget.dataset.alias;
  const result = await postJSON("/api/default-model", { alias });
  state.config = result.config;
  state.recommendations = result.recommendations;
  renderConfig();
  renderStatus();
  renderRecommendations();
  toast(`默认模型已切换为 ${alias}，需要同步 Codex 后生效`);
}

async function refreshLogs() {
  const payload = await getJSON("/api/logs");
  $("logs").textContent = (payload.logs ?? []).map((entry) => `[${entry.source}] ${entry.line}`).join("\n");
}

function collectConfig() {
  const oldAuthToken = state.status?.config?.authTokenConfigured ? undefined : "";
  state.config.moonBridgeDir = $("moonBridgeDir").value;
  state.config.moonBridgeBinary = $("moonBridgeBinary").value;
  state.config.configPath = $("configPath").value;
  state.config.addr = $("addr").value;
  state.config.baseURL = $("baseURL").value;
  state.config.codexHome = $("codexHome").value;
  state.config.authToken = $("authToken").value || oldAuthToken;
  state.config.defaultModel = $("defaultModel").value;
  state.config.defaultMaxTokens = Number($("defaultMaxTokens").value);
  state.config.providers = (state.config.providers ?? []).map((provider, index) => ({
    ...provider,
    name: $(`provider-name-${index}`)?.value ?? provider.name,
    base_url: $(`provider-url-${index}`)?.value ?? provider.base_url,
    api_key: $(`provider-key-${index}`)?.value ?? provider.api_key,
    protocol: $(`provider-protocol-${index}`)?.value ?? provider.protocol,
    version: $(`provider-version-${index}`)?.value ?? provider.version,
    user_agent: $(`provider-agent-${index}`)?.value ?? provider.user_agent,
    web_search_support: $(`provider-search-${index}`)?.value ?? provider.web_search_support,
    models: (provider.models ?? []).map((model, modelIndex) => ({
      ...model,
      name: $(`model-name-${index}-${modelIndex}`)?.value ?? model.name,
      context_window: Number($(`model-context-${index}-${modelIndex}`)?.value ?? model.context_window),
      max_output_tokens: Number($(`model-output-${index}-${modelIndex}`)?.value ?? model.max_output_tokens),
      default_reasoning_level: $(`model-reasoning-${index}-${modelIndex}`)?.value ?? model.default_reasoning_level,
      display_name: $(`model-display-${index}-${modelIndex}`)?.value ?? model.display_name,
      base_instructions: model.base_instructions
    }))
  }));
  state.config.routes = (state.config.routes ?? []).map((route, index) => ({
    alias: $(`route-alias-${index}`)?.value ?? route.alias,
    provider: $(`route-provider-${index}`)?.value ?? route.provider,
    model: $(`route-model-${index}`)?.value ?? route.model
  }));
}

function emptyModel() {
  return {
    name: "model-name",
    context_window: 128000,
    max_output_tokens: 8192,
    display_name: "",
    description: "",
    base_instructions: "",
    default_reasoning_level: "medium",
    supported_reasoning_levels: [
      { effort: "low", description: "Fast, lighter reasoning" },
      { effort: "medium", description: "Balanced default" },
      { effort: "high", description: "More deliberate reasoning" }
    ],
    input_price: 0,
    output_price: 0,
    cache_write_price: 0,
    cache_read_price: 0
  };
}

async function getJSON(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function postJSON(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function putJSON(url, body) {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2600);
}

function recommendationBadgeClass(category) {
  if (category === "recommended_default" || category === "coding_ready") {
    return "good";
  }
  if (category === "tool_loop_only" || category === "text_only" || category === "unverified" || category === "agent_non_streaming" || category === "runtime_unstable") {
    return "warn";
  }
  return "bad";
}

function formatTopCounts(items) {
  return (items ?? [])
    .slice(0, 3)
    .map((item) => `${item.value} (${item.count})`)
    .join(" · ") || "-";
}

function formatCountList(items) {
  return (items ?? [])
    .slice(0, 8)
    .map((item) => `${item.value}: ${item.count}`)
    .join("\n") || "-";
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttr(value) {
  return escapeHTML(value);
}
