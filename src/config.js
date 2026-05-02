import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

export const DEFAULT_STATE_PATH = path.join(os.homedir(), ".moon-bridge-console", "state.json");
export const DEFAULT_MOON_BRIDGE_DIR = path.join(os.homedir(), "AI", "moon-bridge");
export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".config", "moonbridge", "config.yml");
export const DEFAULT_ADDR = "127.0.0.1:38440";
export const DEFAULT_CODEX_HOME = path.join(os.homedir(), ".codex");

export const CODEX_AGENT_BASE_INSTRUCTIONS = [
  "You are a coding agent used through Codex App and Moon Bridge.",
  "Follow the user's latest request exactly, inspect the workspace before changing files, and keep edits minimal and local.",
  "When tools are available, call tools deliberately, emit valid JSON arguments, wait for tool results, and continue from the returned data.",
  "Do not invent tool results. If a required tool call fails, report the concrete failure and choose the smallest next diagnostic step.",
  "For code changes, preserve existing style, avoid unrelated refactors, and verify with the narrowest relevant command before finalizing.",
  "For streaming or multi-turn work, keep responses concise between tool calls so the client can maintain a stable event and tool-call loop."
].join(" ");

const DEFAULT_STATE = {
  moonBridgeDir: DEFAULT_MOON_BRIDGE_DIR,
  moonBridgeBinary: "",
  configPath: DEFAULT_CONFIG_PATH,
  codexHome: DEFAULT_CODEX_HOME,
  baseURL: `http://${DEFAULT_ADDR}/v1`,
  evaluations: {},
  config: {
    mode: "Transform",
    server: {
      addr: DEFAULT_ADDR,
      auth_token: ""
    },
    trace_requests: true,
    log: {
      level: "info",
      format: "text"
    },
    provider: {
      default_model: "xiaomi",
      default_max_tokens: 4096,
      providers: {
        xiaomi: {
          base_url: "https://token-plan-cn.xiaomimimo.com/anthropic",
          api_key: "",
          protocol: "anthropic",
          version: "2023-06-01",
          web_search: { support: "disabled" },
          models: {
            "mimo-v2.5": {
              context_window: 128000,
              max_output_tokens: 8192,
              display_name: "MiMo v2.5",
              description: "Xiaomi Token Plan Anthropic-compatible model.",
              base_instructions: CODEX_AGENT_BASE_INSTRUCTIONS,
              default_reasoning_level: "medium",
              supported_reasoning_levels: [
                { effort: "low", description: "Fast, lighter reasoning" },
                { effort: "medium", description: "Balanced default" },
                { effort: "high", description: "More deliberate reasoning" }
              ],
              pricing: {
                input_price: 0,
                output_price: 0,
                cache_write_price: 0,
                cache_read_price: 0
              }
            }
          }
        },
        deepseek: {
          base_url: "https://api.deepseek.com/anthropic",
          api_key: "",
          protocol: "anthropic",
          version: "2023-06-01",
          web_search: { support: "disabled" },
          models: {
            "deepseek-chat": {
              context_window: 64000,
              max_output_tokens: 8192,
              display_name: "DeepSeek Chat",
              description: "DeepSeek Anthropic-compatible route.",
              base_instructions: CODEX_AGENT_BASE_INSTRUCTIONS,
              default_reasoning_level: "medium",
              supported_reasoning_levels: [
                { effort: "low", description: "Fast, lighter reasoning" },
                { effort: "medium", description: "Balanced default" },
                { effort: "high", description: "More deliberate reasoning" }
              ],
              pricing: {
                input_price: 0,
                output_price: 0,
                cache_write_price: 0,
                cache_read_price: 0
              }
            }
          }
        }
      },
      routes: {
        xiaomi: { to: "xiaomi/mimo-v2.5" },
        deepseek: { to: "deepseek/deepseek-chat" }
      }
    },
    cache: {
      mode: "automatic",
      ttl: "5m"
    },
    persistence: {
      active_provider: "db_sqlite"
    },
    extensions: {
      db_sqlite: {
        enabled: true,
        config: {
          path: "./data/moonbridge.db"
        }
      },
      metrics: {
        enabled: true,
        config: {
          default_limit: 200,
          max_limit: 1000
        }
      }
    }
  }
};

export const PROVIDER_TEMPLATES = [
  {
    id: "xiaomi-token-plan",
    name: "Xiaomi Token Plan",
    provider: "xiaomi",
    protocol: "anthropic",
    base_url: "https://token-plan-cn.xiaomimimo.com/anthropic",
    model: "mimo-v2.5"
  },
  {
    id: "deepseek-anthropic",
    name: "DeepSeek Anthropic",
    provider: "deepseek",
    protocol: "anthropic",
    base_url: "https://api.deepseek.com/anthropic",
    model: "deepseek-chat"
  },
  {
    id: "anthropic",
    name: "Anthropic",
    provider: "anthropic",
    protocol: "anthropic",
    base_url: "https://api.anthropic.com",
    model: "claude-sonnet-4-5"
  },
  {
    id: "openai-responses",
    name: "OpenAI Responses",
    provider: "openai",
    protocol: "openai-response",
    base_url: "https://api.openai.com",
    model: "gpt-5.1"
  }
];

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export function cloneDefaultState() {
  return structuredClone(DEFAULT_STATE);
}

export async function loadState(statePath = DEFAULT_STATE_PATH) {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw);
    return mergeState(DEFAULT_STATE, parsed);
  } catch (error) {
    if (error.code === "ENOENT") {
      return cloneDefaultState();
    }
    throw error;
  }
}

export async function saveState(state, statePath = DEFAULT_STATE_PATH) {
  validateState(state);
  await ensureDir(path.dirname(statePath));
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

export async function loadMoonBridgeConfig(configPath) {
  const raw = await fs.readFile(configPath, "utf8");
  return YAML.parse(raw);
}

export async function writeMoonBridgeConfig(state) {
  validateState(state);
  const configPath = state.configPath || DEFAULT_CONFIG_PATH;
  await ensureDir(path.dirname(configPath));
  const document = new YAML.Document(state.config);
  document.contents.spaceBefore = false;
  await fs.writeFile(configPath, document.toString({ lineWidth: 0 }));
  return configPath;
}

export function configView(state) {
  const config = state.config ?? {};
  const provider = config.provider ?? {};
  return {
    moonBridgeDir: state.moonBridgeDir,
    moonBridgeBinary: state.moonBridgeBinary,
    configPath: state.configPath,
    codexHome: state.codexHome,
    baseURL: state.baseURL,
    addr: config.server?.addr ?? DEFAULT_ADDR,
    authTokenConfigured: Boolean(config.server?.auth_token),
    defaultModel: provider.default_model ?? "",
    defaultMaxTokens: provider.default_max_tokens ?? 0,
    providers: providerMapToList(provider.providers ?? {}),
    routes: routeMapToList(provider.routes ?? {}),
    cache: config.cache ?? {},
    metrics: metricsView(config),
    templates: PROVIDER_TEMPLATES
  };
}

export function applyConfigView(state, view) {
  const next = mergeState(DEFAULT_STATE, state);
  next.moonBridgeDir = stringValue(view.moonBridgeDir);
  next.moonBridgeBinary = stringValue(view.moonBridgeBinary);
  next.configPath = stringValue(view.configPath) || DEFAULT_CONFIG_PATH;
  next.codexHome = stringValue(view.codexHome) || DEFAULT_CODEX_HOME;
  next.baseURL = stringValue(view.baseURL) || `http://${DEFAULT_ADDR}/v1`;
  next.config.server = {
    ...(next.config.server ?? {}),
    addr: stringValue(view.addr) || DEFAULT_ADDR,
    auth_token: view.authToken === undefined ? stringValue(next.config.server?.auth_token) : stringValue(view.authToken)
  };
  next.config.provider = {
    ...(next.config.provider ?? {}),
    default_model: stringValue(view.defaultModel),
    default_max_tokens: numberValue(view.defaultMaxTokens),
    providers: providerListToMap(view.providers ?? []),
    routes: routeListToMap(view.routes ?? [])
  };
  next.config.cache = {
    ...(next.config.cache ?? {}),
    mode: stringValue(view.cache?.mode) || "automatic",
    ttl: stringValue(view.cache?.ttl) || "5m"
  };
  applyMetrics(next.config, view.metrics ?? {});
  validateState(next);
  return next;
}

export function makeProviderFromTemplate(templateID, apiKey = "") {
  const template = PROVIDER_TEMPLATES.find((item) => item.id === templateID);
  if (!template) {
    throw new Error(`unknown provider template: ${templateID}`);
  }
  return {
    name: template.provider,
    base_url: template.base_url,
    api_key: apiKey,
    protocol: template.protocol,
    version: template.protocol === "anthropic" ? "2023-06-01" : "",
    web_search_support: "disabled",
    models: [
      {
        name: template.model,
        context_window: 128000,
        max_output_tokens: 8192,
        display_name: template.model,
        description: template.name,
        base_instructions: CODEX_AGENT_BASE_INSTRUCTIONS,
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
      }
    ]
  };
}

export function validateState(state) {
  const config = state.config ?? {};
  const providers = config.provider?.providers ?? {};
  const routes = config.provider?.routes ?? {};
  if (config.mode !== "Transform") {
    throw new Error("only Transform mode is supported by the console");
  }
  if (!stringValue(config.server?.addr)) {
    throw new Error("server.addr is required");
  }
  const providerNames = Object.keys(providers);
  if (providerNames.length === 0) {
    throw new Error("at least one provider is required");
  }
  for (const name of providerNames) {
    const provider = providers[name];
    if (!name.trim()) {
      throw new Error("provider name is required");
    }
    if (!stringValue(provider.base_url)) {
      throw new Error(`provider ${name} base_url is required`);
    }
    if (!["", "anthropic", "openai-response"].includes(stringValue(provider.protocol))) {
      throw new Error(`provider ${name} protocol must be anthropic or openai-response`);
    }
    const modelNames = Object.keys(provider.models ?? {});
    if (modelNames.length === 0) {
      throw new Error(`provider ${name} must define at least one model`);
    }
    for (const modelName of modelNames) {
      if (!modelName.trim()) {
        throw new Error(`provider ${name} contains an empty model name`);
      }
    }
  }
  const routeNames = Object.keys(routes);
  if (routeNames.length === 0) {
    throw new Error("at least one route is required");
  }
  for (const alias of routeNames) {
    const spec = stringValue(routes[alias]?.to);
    const slash = spec.indexOf("/");
    if (!alias.trim() || slash <= 0 || slash === spec.length - 1) {
      throw new Error(`route ${alias} must point to provider/model`);
    }
    const providerName = spec.slice(0, slash);
    const modelName = spec.slice(slash + 1);
    if (!providers[providerName]) {
      throw new Error(`route ${alias} references unknown provider ${providerName}`);
    }
    if (!providers[providerName].models?.[modelName]) {
      throw new Error(`route ${alias} references unknown model ${providerName}/${modelName}`);
    }
  }
  const defaultModel = stringValue(config.provider?.default_model);
  if (!defaultModel || !routes[defaultModel]) {
    throw new Error("provider.default_model must reference a configured route alias");
  }
}

function providerMapToList(providers) {
  return Object.entries(providers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, provider]) => ({
      name,
      base_url: provider.base_url ?? "",
      api_key: provider.api_key ?? "",
      protocol: provider.protocol ?? "anthropic",
      version: provider.version ?? "",
      user_agent: provider.user_agent ?? "",
      web_search_support: provider.web_search?.support ?? "disabled",
      models: modelMapToList(provider.models ?? {})
    }));
}

function providerListToMap(providers) {
  const out = {};
  for (const provider of providers) {
    const name = stringValue(provider.name);
    if (!name) {
      continue;
    }
    out[name] = {
      base_url: trimTrailingSlash(stringValue(provider.base_url)),
      api_key: stringValue(provider.api_key),
      protocol: stringValue(provider.protocol) || "anthropic",
      version: stringValue(provider.version),
      user_agent: stringValue(provider.user_agent),
      web_search: { support: stringValue(provider.web_search_support) || "disabled" },
      models: modelListToMap(provider.models ?? [])
    };
  }
  return out;
}

function modelMapToList(models) {
  return Object.entries(models)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, model]) => ({
      name,
      context_window: model.context_window ?? 0,
      max_output_tokens: model.max_output_tokens ?? 0,
      display_name: model.display_name ?? "",
      description: model.description ?? "",
      base_instructions: model.base_instructions ?? "",
      default_reasoning_level: model.default_reasoning_level ?? "",
      supported_reasoning_levels: model.supported_reasoning_levels ?? [],
      supports_reasoning_summaries: Boolean(model.supports_reasoning_summaries),
      default_reasoning_summary: model.default_reasoning_summary ?? "",
      input_modalities: model.input_modalities ?? ["text"],
      supports_image_detail_original: Boolean(model.supports_image_detail_original),
      input_price: model.pricing?.input_price ?? 0,
      output_price: model.pricing?.output_price ?? 0,
      cache_write_price: model.pricing?.cache_write_price ?? 0,
      cache_read_price: model.pricing?.cache_read_price ?? 0
    }));
}

function modelListToMap(models) {
  const out = {};
  for (const model of models) {
    const name = stringValue(model.name);
    if (!name) {
      continue;
    }
    out[name] = {
      context_window: numberValue(model.context_window),
      max_output_tokens: numberValue(model.max_output_tokens),
      display_name: stringValue(model.display_name),
      description: stringValue(model.description),
      base_instructions: stringValue(model.base_instructions) || CODEX_AGENT_BASE_INSTRUCTIONS,
      default_reasoning_level: stringValue(model.default_reasoning_level),
      supported_reasoning_levels: model.supported_reasoning_levels ?? [],
      supports_reasoning_summaries: Boolean(model.supports_reasoning_summaries),
      default_reasoning_summary: stringValue(model.default_reasoning_summary) || "none",
      input_modalities: normalizeModalities(model.input_modalities),
      supports_image_detail_original: Boolean(model.supports_image_detail_original),
      pricing: {
        input_price: numberValue(model.input_price),
        output_price: numberValue(model.output_price),
        cache_write_price: numberValue(model.cache_write_price),
        cache_read_price: numberValue(model.cache_read_price)
      }
    };
  }
  return out;
}

function routeMapToList(routes) {
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

function routeListToMap(routes) {
  const out = {};
  for (const route of routes) {
    const alias = stringValue(route.alias);
    const provider = stringValue(route.provider);
    const model = stringValue(route.model);
    if (!alias) {
      continue;
    }
    out[alias] = { to: `${provider}/${model}` };
  }
  return out;
}

function metricsView(config) {
  return {
    enabled: Boolean(config.extensions?.metrics?.enabled) && Boolean(config.extensions?.db_sqlite?.enabled),
    path: config.extensions?.db_sqlite?.config?.path ?? "./data/moonbridge.db",
    default_limit: config.extensions?.metrics?.config?.default_limit ?? 200,
    max_limit: config.extensions?.metrics?.config?.max_limit ?? 1000
  };
}

function applyMetrics(config, metrics) {
  config.persistence = {
    ...(config.persistence ?? {}),
    active_provider: metrics.enabled ? "db_sqlite" : stringValue(config.persistence?.active_provider)
  };
  config.extensions = config.extensions ?? {};
  config.extensions.db_sqlite = {
    ...(config.extensions.db_sqlite ?? {}),
    enabled: Boolean(metrics.enabled),
    config: {
      ...(config.extensions.db_sqlite?.config ?? {}),
      path: stringValue(metrics.path) || "./data/moonbridge.db"
    }
  };
  config.extensions.metrics = {
    ...(config.extensions.metrics ?? {}),
    enabled: Boolean(metrics.enabled),
    config: {
      ...(config.extensions.metrics?.config ?? {}),
      default_limit: numberValue(metrics.default_limit) || 200,
      max_limit: numberValue(metrics.max_limit) || 1000
    }
  };
}

function mergeState(base, override, key = "") {
  if (Array.isArray(base) || Array.isArray(override)) {
    return structuredClone(override ?? base);
  }
  if (["providers", "routes", "models", "extensions"].includes(key) && override !== undefined) {
    return structuredClone(override);
  }
  if (isObject(base) && isObject(override)) {
    const out = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(override)])) {
      out[key] = mergeState(base[key], override[key], key);
    }
    return out;
  }
  return structuredClone(override ?? base);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function normalizeModalities(value) {
  if (Array.isArray(value)) {
    const out = value.map((item) => stringValue(item)).filter(Boolean);
    return out.length > 0 ? out : ["text"];
  }
  const out = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return out.length > 0 ? out : ["text"];
}
