const DEFAULT_TIMEOUT_MS = 90000;

export async function runAgentBenchmark({ baseURL, model, authToken = "", timeoutMS = DEFAULT_TIMEOUT_MS }) {
  const normalizedBaseURL = trimRightSlash(baseURL);
  const started = Date.now();
  const workspace = new Map([
    ["package.json", JSON.stringify({ scripts: { test: "node test.js" } }, null, 2)],
    ["math.js", "export function add(a, b) {\n  return a - b;\n}\n"],
    ["test.js", "import { add } from './math.js';\nif (add(2, 3) !== 5) throw new Error('add failed');\nconsole.log('ok');\n"]
  ]);
  const steps = [];
  if (!normalizedBaseURL) {
    return benchmarkResponse({ model, baseURL: normalizedBaseURL, started, steps, workspace, error: "baseURL is required" });
  }
  if (!model) {
    return benchmarkResponse({ model, baseURL: normalizedBaseURL, started, steps, workspace, error: "model is required" });
  }

  const tools = benchmarkTools();
  let input = benchmarkPrompt();
  let finalText = "";
  let responseID = "";
  for (let turn = 0; turn < 6; turn += 1) {
    const response = await postResponses(normalizedBaseURL, authToken, {
      model,
      input,
      tools,
      tool_choice: "auto",
      max_output_tokens: 512
    }, timeoutMS);
    if (!response.ok) {
      steps.push({
        turn,
        type: "request_error",
        ok: false,
        status: response.status,
        message: `HTTP ${response.status}`,
        details: response.payload
      });
      break;
    }
    responseID = response.payload?.id || responseID;
    finalText = response.payload?.output_text || finalText;
    const calls = (response.payload?.output ?? []).filter((item) => item.type === "function_call");
    if (calls.length === 0) {
      steps.push({
        turn,
        type: "assistant_final",
        ok: finalText.toLowerCase().includes("done"),
        message: finalText || "model returned no function_call and no output_text"
      });
      break;
    }
    const outputs = [];
    for (const call of calls) {
      const result = executeBenchmarkTool(call, workspace);
      steps.push({
        turn,
        type: "tool_call",
        ok: result.ok,
        tool: call.name,
        call_id: call.call_id,
        arguments: safeParseJSON(call.arguments),
        output: result.output
      });
      outputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result.output)
      });
    }
    input = [
      ...normalizeOutputHistory(response.payload?.output ?? []),
      ...outputs
    ];
  }

  return benchmarkResponse({ model, baseURL: normalizedBaseURL, started, steps, workspace, finalText, responseID });
}

function benchmarkResponse({ model, baseURL, started, steps, workspace, finalText = "", responseID = "", error = "" }) {
  const testsPass = runWorkspaceTest(workspace).ok;
  const readCount = countTool(steps, "read_file");
  const writeCount = countTool(steps, "write_file");
  const commandCount = countTool(steps, "run_command");
  const invalidToolCalls = steps.filter((step) => step.type === "tool_call" && !step.ok).length;
  const toolCalls = steps.filter((step) => step.type === "tool_call").length;
  const completed = testsPass && writeCount > 0 && commandCount > 0 && invalidToolCalls === 0;
  const scoreParts = [
    readCount > 0,
    writeCount > 0,
    commandCount > 0,
    testsPass,
    invalidToolCalls === 0 && toolCalls > 0
  ];
  const score = Math.round((scoreParts.filter(Boolean).length * 100) / scoreParts.length);
  const connectionError = steps.some((step) => step.type === "request_error" && step.status === 0);
  const tier = completed ? "coding_ready" : toolCalls > 0 && invalidToolCalls === 0 ? "tool_loop_ready" : "not_ready";
  return {
    model,
    baseURL,
    response_id: responseID,
    score: error ? 0 : score,
    tier: error ? "not_ready" : tier,
    label: benchmarkLabel(error ? "not_ready" : tier),
    duration_ms: Date.now() - started,
    completed: error ? false : completed,
    summary: {
      tool_calls: toolCalls,
      invalid_tool_calls: invalidToolCalls,
      read_file_calls: readCount,
      write_file_calls: writeCount,
      run_command_calls: commandCount,
      tests_pass: error ? false : testsPass
    },
    final_text: finalText,
    error,
    workspace: Object.fromEntries(workspace),
    steps,
    recommendations: benchmarkRecommendations({ tier: error ? "not_ready" : tier, testsPass, writeCount, commandCount, invalidToolCalls, error, connectionError })
  };
}

function benchmarkPrompt() {
  return [
    {
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: [
          "You are in a tiny coding benchmark workspace.",
          "Goal: inspect the files, fix the bug in math.js, run the test command, and then answer exactly DONE.",
          "Use the provided tools. Do not answer DONE until the test output is ok."
        ].join(" ")
      }]
    }
  ];
}

function benchmarkTools() {
  return [
    {
      type: "function",
      name: "list_files",
      description: "List files in the benchmark workspace.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "read_file",
      description: "Read a file from the benchmark workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"],
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "write_file",
      description: "Overwrite a file in the benchmark workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"],
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "run_command",
      description: "Run a supported command in the benchmark workspace.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["command"],
        additionalProperties: false
      }
    }
  ];
}

function executeBenchmarkTool(call, workspace) {
  const args = safeParseJSON(call.arguments);
  if (!call.call_id || !call.name || args === null) {
    return { ok: false, output: { error: "invalid function_call shape" } };
  }
  if (call.name === "list_files") {
    return { ok: true, output: { files: [...workspace.keys()].sort() } };
  }
  if (call.name === "read_file") {
    if (!workspace.has(args.path)) {
      return { ok: false, output: { error: `file not found: ${args.path}` } };
    }
    return { ok: true, output: { path: args.path, content: workspace.get(args.path) } };
  }
  if (call.name === "write_file") {
    if (typeof args.path !== "string" || typeof args.content !== "string") {
      return { ok: false, output: { error: "path and content are required strings" } };
    }
    if (!workspace.has(args.path)) {
      return { ok: false, output: { error: `file not found: ${args.path}` } };
    }
    workspace.set(args.path, args.content);
    return { ok: true, output: { path: args.path, bytes: args.content.length } };
  }
  if (call.name === "run_command") {
    const command = Array.isArray(args.command) ? args.command.join(" ") : "";
    if (command !== "npm test" && command !== "node test.js") {
      return { ok: false, output: { error: `unsupported command: ${command}` } };
    }
    const result = runWorkspaceTest(workspace);
    return { ok: result.ok, output: result };
  }
  return { ok: false, output: { error: `unknown tool: ${call.name}` } };
}

function runWorkspaceTest(workspace) {
  const math = workspace.get("math.js") || "";
  if (/return\s+a\s*\+\s*b\s*;/.test(math)) {
    return { ok: true, stdout: "ok\n", stderr: "", exit_code: 0 };
  }
  return { ok: false, stdout: "", stderr: "Error: add failed\n", exit_code: 1 };
}

async function postResponses(baseURL, authToken, body, timeoutMS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMS);
  try {
    const response = await fetch(`${baseURL}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(authToken)
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    return { ok: response.ok, status: response.status, payload };
  } catch (error) {
    return { ok: false, status: 0, payload: { error: error.message || String(error) } };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeOutputHistory(output) {
  return output.filter((item) => ["message", "function_call", "reasoning"].includes(item.type));
}

function countTool(steps, tool) {
  return steps.filter((step) => step.type === "tool_call" && step.tool === tool).length;
}

function benchmarkLabel(tier) {
  if (tier === "coding_ready") {
    return "适合 Codex 代码任务";
  }
  if (tier === "tool_loop_ready") {
    return "工具循环可用但代码任务未完成";
  }
  return "不适合作为默认 coding 模型";
}

function benchmarkRecommendations({ tier, testsPass, writeCount, commandCount, invalidToolCalls, error, connectionError }) {
  if (error || connectionError) {
    return ["先确认 Moon Bridge 已启动、base URL 正确、模型 alias 可用。"];
  }
  if (tier === "coding_ready") {
    return ["模型完成了读文件、写文件、运行测试和最终确认，可以进入更长真实任务验证。"];
  }
  const out = [];
  if (invalidToolCalls > 0) {
    out.push("工具参数或工具名不稳定，不建议作为 Codex 默认 coding 模型。");
  }
  if (writeCount === 0) {
    out.push("模型没有执行文件写入，可能只适合解释型任务。");
  }
  if (commandCount === 0) {
    out.push("模型没有运行测试命令，真实代码修复闭环不足。");
  }
  if (!testsPass) {
    out.push("测试未通过，建议换更强模型或降低任务复杂度。");
  }
  return out;
}

function authHeaders(authToken) {
  return authToken ? { authorization: `Bearer ${authToken}` } : {};
}

function safeParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function trimRightSlash(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}
