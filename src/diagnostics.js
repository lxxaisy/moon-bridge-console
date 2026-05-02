export async function testProvider(provider, model, options = {}) {
  const protocol = provider.protocol || "anthropic";
  const selectedModel = model || provider.models?.[0]?.name || Object.keys(provider.models ?? {})[0] || "";
  const started = Date.now();
  const result = {
    ok: false,
    protocol,
    model: selectedModel,
    status: 0,
    latency_ms: 0,
    message: ""
  };
  try {
    if (!provider.base_url) {
      throw new Error("base_url is required");
    }
    if (!provider.api_key) {
      throw new Error("api_key is required");
    }
    if (!selectedModel) {
      throw new Error("model is required");
    }
    const timeoutMS = options.timeoutMS ?? 45000;
    if (protocol === "anthropic") {
      return await testAnthropicProvider(provider, selectedModel, timeoutMS, started);
    }
    if (protocol === "openai-response") {
      return await testOpenAIResponsesProvider(provider, selectedModel, timeoutMS, started);
    }
    throw new Error(`unsupported protocol ${protocol}`);
  } catch (error) {
    result.message = error.message || String(error);
    result.latency_ms = Date.now() - started;
    return result;
  }
}

export async function runDiagnostics({ baseURL, model, authToken = "" }) {
  const normalizedBaseURL = trimRightSlash(baseURL);
  const checks = [];
  if (!normalizedBaseURL) {
    return diagnosticResponse(model, normalizedBaseURL, [{ name: "config", ok: false, message: "baseURL is required" }]);
  }
  if (!model) {
    return diagnosticResponse(model, normalizedBaseURL, [{ name: "config", ok: false, message: "model alias is required" }]);
  }
  checks.push(await runTextCheck(normalizedBaseURL, model, authToken));
  checks.push(await runStreamCheck(normalizedBaseURL, model, authToken));
  checks.push(await runToolCheck(normalizedBaseURL, model, authToken));
  checks.push(await runToolRoundTripCheck(normalizedBaseURL, model, authToken));
  return diagnosticResponse(model, normalizedBaseURL, checks);
}

export async function fetchMetrics({ baseURL, authToken = "", limit = 100 }) {
  const response = await fetch(`${trimRightSlash(baseURL)}/admin/metrics?limit=${encodeURIComponent(String(limit))}`, {
    headers: authHeaders(authToken)
  });
  if (!response.ok) {
    return { enabled: false, records: [], message: `HTTP ${response.status}` };
  }
  const payload = await response.json();
  const records = payload.records ?? [];
  return {
    enabled: true,
    records,
    count: payload.count ?? records.length,
    summary: summarizeMetrics(records)
  };
}

async function testAnthropicProvider(provider, model, timeoutMS, started) {
  const response = await postJSON(`${trimRightSlash(provider.base_url)}/v1/messages`, {
    model,
    max_tokens: 64,
    messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly: moonbridge-ok" }] }]
  }, {
    "x-api-key": provider.api_key,
    "anthropic-version": provider.version || "2023-06-01",
    "user-agent": provider.user_agent || "moon-bridge-console"
  }, timeoutMS);
  const message = response.payload?.content?.find((item) => item.type === "text")?.text ?? "";
  return {
    ok: response.ok,
    protocol: "anthropic",
    model,
    status: response.status,
    latency_ms: Date.now() - started,
    message: response.ok ? (message || "provider responded successfully") : errorMessage(response.payload, response.status)
  };
}

async function testOpenAIResponsesProvider(provider, model, timeoutMS, started) {
  const response = await postJSON(`${trimRightSlash(provider.base_url)}/v1/responses`, {
    model,
    input: "Reply with exactly: moonbridge-ok",
    max_output_tokens: 64
  }, {
    authorization: `Bearer ${provider.api_key}`
  }, timeoutMS);
  return {
    ok: response.ok,
    protocol: "openai-response",
    model,
    status: response.status,
    latency_ms: Date.now() - started,
    message: response.ok ? (response.payload?.output_text || "provider responded successfully") : errorMessage(response.payload, response.status)
  };
}

async function runTextCheck(baseURL, model, authToken) {
  const started = Date.now();
  const response = await postMoonBridge(baseURL, authToken, {
    model,
    input: "Reply with exactly: moonbridge-ok",
    max_output_tokens: 64
  });
  const check = baseCheck("responses_text", started, response);
  if (!check.ok) {
    return check;
  }
  if ((response.payload?.output_text ?? "").trim() !== "moonbridge-ok") {
    return {
      ...check,
      ok: false,
      message: "text response did not match expected sentinel",
      details: {
        output_text: response.payload?.output_text ?? "",
        status: response.payload?.status ?? ""
      }
    };
  }
  check.message = "text response is compatible";
  check.details = {
    status: response.payload?.status ?? "",
    output_text: response.payload?.output_text ?? ""
  };
  return check;
}

async function runStreamCheck(baseURL, model, authToken) {
  const started = Date.now();
  const response = await postRaw(`${baseURL}/responses`, {
    model,
    input: "Reply with exactly: moonbridge-ok",
    max_output_tokens: 64,
    stream: true
  }, authHeaders(authToken), 60000);
  const check = {
    name: "responses_stream",
    ok: false,
    latency_ms: Date.now() - started,
    message: "",
    details: {}
  };
  if (!response.ok) {
    check.status = response.status;
    check.message = `HTTP ${response.status}`;
    check.details = response.payload;
    return check;
  }
  const parsed = parseSSE(response.text);
  const events = Object.fromEntries(parsed.eventTypes.map((name) => [name, parsed.events.filter((event) => event.type === name).length]));
  const required = ["response.created", "response.in_progress", "response.output_text.delta", "response.completed"];
  const missing = required.filter((name) => !events[name]);
  if (missing.length > 0) {
    check.message = "stream is missing required events";
    check.details = { missing, events, text: parsed.text };
    return check;
  }
  check.ok = true;
  check.message = "stream event sequence is compatible";
  check.details = { events, text: parsed.text };
  return check;
}

async function runToolCheck(baseURL, model, authToken) {
  const started = Date.now();
  const response = await postMoonBridge(baseURL, authToken, {
    model,
    input: "Call the echo_text tool with text exactly moonbridge-ok. Do not answer directly.",
    max_output_tokens: 128,
    tools: [echoTextTool()],
    tool_choice: "required"
  });
  const check = baseCheck("function_tool_call", started, response);
  if (!check.ok) {
    return check;
  }
  const call = (response.payload?.output ?? []).find((item) => item.type === "function_call");
  if (!call) {
    return {
      ...check,
      ok: false,
      message: "model did not emit a function_call",
      details: response.payload?.output ?? []
    };
  }
  if (call.name !== "echo_text" || !call.call_id || !isValidJSON(call.arguments)) {
    return {
      ...check,
      ok: false,
      message: "tool call shape is invalid",
      details: call
    };
  }
  check.message = "function tool call is compatible";
  check.details = call;
  return check;
}

async function runToolRoundTripCheck(baseURL, model, authToken) {
  const first = await postMoonBridge(baseURL, authToken, {
    model,
    input: "Call the echo_text tool with text exactly moonbridge-ok. Do not answer directly.",
    max_output_tokens: 128,
    tools: [echoTextTool()],
    tool_choice: "required"
  });
  const started = Date.now();
  if (!first.ok) {
    return baseCheck("function_round_trip", started, first);
  }
  const call = (first.payload?.output ?? []).find((item) => item.type === "function_call");
  if (!call?.call_id) {
    return {
      name: "function_round_trip",
      ok: false,
      latency_ms: Date.now() - started,
      message: "first turn did not produce a callable function_call",
      details: first.payload?.output ?? []
    };
  }
  const second = await postMoonBridge(baseURL, authToken, {
    model,
    input: [
      ...normalizeOutputHistory(first.payload?.output ?? []),
      {
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify({ text: "moonbridge-ok" })
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Now answer with exactly: done" }]
      }
    ],
    max_output_tokens: 64,
    tools: [echoTextTool()]
  });
  const check = baseCheck("function_round_trip", started, second);
  if (!check.ok) {
    return check;
  }
  if (!String(second.payload?.output_text ?? "").toLowerCase().includes("done")) {
    return {
      ...check,
      ok: false,
      message: "tool result round-trip completed but final answer was unexpected",
      details: { output_text: second.payload?.output_text ?? "", output: second.payload?.output ?? [] }
    };
  }
  check.message = "function call output round-trip is compatible";
  check.details = { output_text: second.payload?.output_text ?? "" };
  return check;
}

function normalizeOutputHistory(output) {
  return output.filter((item) => ["message", "function_call", "reasoning"].includes(item.type));
}

async function postMoonBridge(baseURL, authToken, body) {
  return postJSON(`${baseURL}/responses`, body, authHeaders(authToken), 60000);
}

async function postJSON(url, body, headers = {}, timeoutMS = 60000) {
  const response = await postRaw(url, body, headers, timeoutMS);
  if (response.payload !== undefined) {
    return response;
  }
  try {
    response.payload = response.text ? JSON.parse(response.text) : null;
  } catch {
    response.payload = { raw: response.text };
  }
  return response;
}

async function postRaw(url, body, headers = {}, timeoutMS = 60000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = undefined;
    }
    return {
      ok: response.ok,
      status: response.status,
      text,
      payload
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      payload: { error: error.message || String(error) }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function baseCheck(name, started, response) {
  return {
    name,
    ok: response.ok,
    status: response.status,
    latency_ms: Date.now() - started,
    message: response.ok ? "request completed" : `HTTP ${response.status}`,
    details: response.ok ? {} : response.payload
  };
}

function diagnosticResponse(model, baseURL, checks) {
  const passed = checks.filter((check) => check.ok).length;
  return {
    model,
    baseURL,
    score: checks.length ? Math.round((passed * 100) / checks.length) : 0,
    checks,
    profile: compatibilityProfile(checks),
    recommendations: recommendations(checks)
  };
}

function compatibilityProfile(checks) {
  const byName = Object.fromEntries(checks.map((check) => [check.name, check]));
  const text = Boolean(byName.responses_text?.ok);
  const stream = Boolean(byName.responses_stream?.ok);
  const toolCall = Boolean(byName.function_tool_call?.ok);
  const roundTrip = Boolean(byName.function_round_trip?.ok);
  let tier = "unusable";
  let label = "不可用于 Codex Agent";
  if (text && stream && toolCall && roundTrip) {
    tier = "agent_ready";
    label = "适合 Codex Agent";
  } else if (text && toolCall && roundTrip) {
    tier = "agent_non_streaming";
    label = "适合非流式 Agent";
  } else if (text && stream) {
    tier = "chat_and_stream";
    label = "适合聊天和简单流式任务";
  } else if (text) {
    tier = "text_only";
    label = "仅适合简单文本任务";
  }
  return {
    tier,
    label,
    supports_text: text,
    supports_stream: stream,
    supports_tool_call: toolCall,
    supports_tool_round_trip: roundTrip,
    suggested_usage: suggestedUsage({ text, stream, toolCall, roundTrip })
  };
}

function suggestedUsage(profile) {
  if (profile.text && profile.stream && profile.toolCall && profile.roundTrip) {
    return "可用于 Codex 代码编辑、多轮工具调用和常规 agent 任务。";
  }
  if (profile.text && profile.toolCall && profile.roundTrip) {
    return "可用于工具任务，但建议在客户端或调试时优先关闭流式输出。";
  }
  if (profile.text && profile.stream) {
    return "可用于问答、解释和轻量任务，不建议承担文件编辑或复杂工具链。";
  }
  if (profile.text) {
    return "仅建议用于简单文本生成，不建议作为 Codex 默认模型。";
  }
  return "先修复 provider、模型名、API key 或 Moon Bridge base URL。";
}

function recommendations(checks) {
  const out = [];
  for (const check of checks) {
    if (check.ok) {
      continue;
    }
    if (check.name === "responses_text") {
      out.push("文本诊断失败时，先检查默认模型 alias、provider API Key、base_url 和上游模型名。");
    }
    if (check.name === "responses_stream") {
      out.push("流式诊断失败时，查看 Moon Bridge trace；Codex 对 response.created、output_text.delta、completed 的事件顺序很敏感。");
    }
    if (check.name === "function_tool_call") {
      out.push("工具调用失败通常来自模型能力差异；优先选择工具调用稳定的模型，并保持 tool_choice 为 required 的场景可通过。");
    }
    if (check.name === "function_round_trip") {
      out.push("工具回传失败说明多轮 agent 链路不稳定；复杂文件编辑前应先换更强模型或降低一次任务中的工具调用密度。");
    }
  }
  if (out.length === 0) {
    out.push("基础文本、流式事件、函数工具调用和工具结果回传均通过；建议继续用真实 Codex 文件编辑任务做长链路验证。");
    out.push("推广部署时，优先把通过四项诊断的模型设为默认 route，把只通过文本的模型作为低风险辅助模型。");
  }
  return out;
}

function parseSSE(text) {
  const events = [];
  let accumulatedText = "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    try {
      const payload = JSON.parse(data);
      if (payload.type) {
        events.push(payload);
      }
      if (payload.type === "response.output_text.delta") {
        accumulatedText += payload.delta ?? "";
      }
      if (payload.type === "response.output_text.done" && !accumulatedText) {
        accumulatedText = payload.text ?? "";
      }
    } catch {
      continue;
    }
  }
  return {
    events,
    eventTypes: [...new Set(events.map((event) => event.type))],
    text: accumulatedText
  };
}

function echoTextTool() {
  return {
    type: "function",
    name: "echo_text",
    description: "Echo a short text value for compatibility diagnostics.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" }
      },
      required: ["text"]
    }
  };
}

function summarizeMetrics(records) {
  return records.reduce((summary, record) => {
    summary.requests += 1;
    if (record.status === "success") {
      summary.success += 1;
    } else {
      summary.failed += 1;
    }
    summary.input_tokens += Number(record.input_tokens ?? 0);
    summary.output_tokens += Number(record.output_tokens ?? 0);
    summary.cache_read += Number(record.cache_read ?? 0);
    summary.cache_creation += Number(record.cache_creation ?? 0);
    summary.cost += Number(record.cost ?? 0);
    return summary;
  }, {
    requests: 0,
    success: 0,
    failed: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read: 0,
    cache_creation: 0,
    cost: 0
  });
}

function authHeaders(authToken) {
  return authToken ? { authorization: `Bearer ${authToken}` } : {};
}

function trimRightSlash(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function errorMessage(payload, status) {
  return payload?.error?.message ?? payload?.message ?? `HTTP ${status}`;
}

function isValidJSON(value) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
