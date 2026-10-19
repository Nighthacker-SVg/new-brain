import { validateProviderUrl } from "./providers.mjs";

const MAX_OUTPUT_TOKENS = 8_192;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_CHARACTERS = 250_000;
const LOCAL_HOSTS = new Set(["host.docker.internal", "ollama"]);

/** Safe to show to an owner: never embeds remote bodies, URLs, or credentials. */
export class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ProviderError(code, message);
}
function bool(value) {
  return value === true || value === "1" || value === "true";
}
function hostsFromEnv(env) {
  return String(env.ATTENDX_PROVIDER_HOSTS || "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
}

function environmentProvider(env) {
  return {
    type: env.ATTENDX_MODEL_TYPE || "openai",
    baseUrl: env.ATTENDX_MODEL_BASE_URL || "https://api.openai.com/v1",
    model: env.ATTENDX_MODEL || "",
    apiKey: env.ATTENDX_MODEL_API_KEY || "",
    local: bool(env.ATTENDX_MODEL_LOCAL),
  };
}

function checkedConfig(input, env, allowedHosts) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("invalid_config", "Choose a valid AI provider in Settings.");
  const type = input.type || "openai";
  if (type !== "openai" && type !== "anthropic")
    fail(
      "invalid_config",
      "Choose OpenAI-compatible or Anthropic as the provider type.",
    );
  let baseUrl;
  try {
    baseUrl = validateProviderUrl(
      input.baseUrl ||
        (type === "anthropic"
          ? "https://api.anthropic.com/v1"
          : "https://api.openai.com/v1"),
      allowedHosts ?? hostsFromEnv(env),
    );
  } catch {
    fail(
      "invalid_config",
      "The provider endpoint is not permitted. Use an allowed HTTPS endpoint or ask the administrator to allow its host.",
    );
  }
  const url = new URL(baseUrl);
  if (url.search || url.hash || url.username || url.password)
    fail(
      "invalid_config",
      "The provider endpoint must not contain credentials, a query, or a fragment.",
    );
  if (
    typeof input.model !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,199}$/.test(input.model)
  ) {
    fail("missing_model", "Set a model name for the AI provider in Settings.");
  }
  const apiKey = input.apiKey ?? "";
  if (
    typeof apiKey !== "string" ||
    (apiKey && !/^[\x21-\x7E]{1,4096}$/.test(apiKey))
  ) {
    fail(
      "invalid_key",
      "The saved API key has an invalid format. Replace it in Settings.",
    );
  }
  const local =
    bool(input.local) && LOCAL_HOSTS.has(url.hostname) && type === "openai";
  if (!apiKey && !local)
    fail(
      "missing_key",
      "Add an API key in Settings before starting real agent work.",
    );
  if (input.enabled === false)
    fail(
      "invalid_config",
      "This AI provider is disabled. Enable a provider in Settings.",
    );
  // Only a fixed endpoint suffix is accepted; callers cannot supply a per-call URL.
  const endpoint = `${String(baseUrl).replace(/\/+$/, "")}/${type === "anthropic" ? "messages" : "chat/completions"}`;
  return { type, model: input.model, apiKey, endpoint };
}

export function providerAvailable(config, options = {}) {
  const env = options.env ?? process.env;
  try {
    checkedConfig(
      config ?? environmentProvider(env),
      env,
      options.allowedHosts,
    );
    return true;
  } catch {
    return false;
  }
}

function messagesForRequest(messages, system, json) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 64) {
    fail(
      "invalid_request",
      "An AI request must contain between 1 and 64 messages.",
    );
  }
  if (system !== undefined && typeof system !== "string")
    fail("invalid_request", "The AI system instruction must be text.");
  let size = (system || "").length;
  const systems = system ? [system] : [];
  const conversation = [];
  for (const message of messages) {
    if (
      !message ||
      !["system", "user", "assistant"].includes(message.role) ||
      typeof message.content !== "string"
    ) {
      fail(
        "invalid_request",
        "AI messages must contain a valid role and text content.",
      );
    }
    size += message.content.length;
    if (size > MAX_INPUT_CHARACTERS)
      fail(
        "request_limit",
        "This AI request is too large. Split the project into smaller tasks.",
      );
    if (message.role === "system") systems.push(message.content);
    else conversation.push({ role: message.role, content: message.content });
  }
  if (size > MAX_INPUT_CHARACTERS || !conversation.length)
    fail(
      "invalid_request",
      "Include at least one conversation message within the request limit.",
    );
  if (json)
    systems.push(
      "Return a single valid JSON object. Do not wrap it in Markdown or add text outside the JSON object.",
    );
  return { system: systems.join("\n\n"), conversation };
}

async function boundedResponse(response) {
  if (Number(response.headers?.get?.("content-length")) > MAX_RESPONSE_BYTES)
    fail(
      "response_limit",
      "The AI response exceeded the permitted size. Request a smaller deliverable.",
    );
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES)
      fail(
        "response_limit",
        "The AI response exceeded the permitted size. Request a smaller deliverable.",
      );
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        fail(
          "response_limit",
          "The AI response exceeded the permitted size. Request a smaller deliverable.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

function usageCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function completionResult(payload, config, durationMs) {
  let text;
  let inputTokens;
  let outputTokens;
  if (config.type === "anthropic") {
    if (payload?.stop_reason === "max_tokens")
      fail(
        "response_limit",
        "The AI response reached the output limit. Split the task into smaller deliverables.",
      );
    if (Array.isArray(payload?.content))
      text = payload.content
        .filter(
          (part) => part?.type === "text" && typeof part.text === "string",
        )
        .map((part) => part.text)
        .join("\n");
    inputTokens = usageCount(payload?.usage?.input_tokens);
    outputTokens = usageCount(payload?.usage?.output_tokens);
  } else {
    const choice = payload?.choices?.[0];
    if (choice?.finish_reason === "length")
      fail(
        "response_limit",
        "The AI response reached the output limit. Split the task into smaller deliverables.",
      );
    if (choice?.finish_reason === "content_filter")
      fail(
        "provider_refused",
        "The AI provider declined this request. Review the project instructions.",
      );
    if (typeof choice?.message?.content === "string")
      text = choice.message.content;
    else if (Array.isArray(choice?.message?.content))
      text = choice.message.content
        .filter(
          (part) => part?.type === "text" && typeof part.text === "string",
        )
        .map((part) => part.text)
        .join("\n");
    inputTokens = usageCount(payload?.usage?.prompt_tokens);
    outputTokens = usageCount(payload?.usage?.completion_tokens);
  }
  if (typeof text !== "string" || !text.trim())
    fail(
      "invalid_response",
      "The AI provider returned no usable text. Try another configured model.",
    );
  return {
    text,
    usage: { inputTokens, outputTokens },
    model: config.model,
    durationMs,
  };
}

function statusError(status) {
  if (status === 401 || status === 403)
    fail(
      "invalid_key",
      "The AI provider rejected authorization. Check the saved API key and model access in Settings.",
    );
  if (status === 429)
    fail(
      "rate_limit",
      "The AI provider rate limit or account quota was reached. Check the provider account or try another configured provider.",
    );
  if (status === 400 || status === 404 || status === 422)
    fail(
      "provider_config",
      "The AI provider rejected the model or request configuration. Check its endpoint and model in Settings.",
    );
  if (status >= 500)
    fail(
      "provider_unavailable",
      "The AI provider is temporarily unavailable. Try again later or use another configured provider.",
    );
  fail(
    "provider_error",
    "The AI provider could not complete this request. Check the provider configuration.",
  );
}

/** Real model adapter; no model/key means a blocked job, never simulated AI text. */
export function createProvider(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? options.fetchImpl ?? globalThis.fetch;
  const defaultConfig =
    options.provider ??
    options.config ??
    (options.model || options.apiKey || options.baseUrl
      ? options
      : environmentProvider(env));
  const timeoutMs = Math.max(
    1,
    Math.min(
      120_000,
      Number.isFinite(options.timeoutMs) ? options.timeoutMs : 45_000,
    ),
  );
  const outputLimit = Math.max(
    1,
    Math.min(
      MAX_OUTPUT_TOKENS,
      Number.isSafeInteger(options.maxTokens) ? options.maxTokens : 4_096,
    ),
  );
  return {
    configured: providerAvailable(defaultConfig, {
      env,
      allowedHosts: options.allowedHosts,
    }),
    async complete({
      messages,
      system,
      json = false,
      signal,
      maxTokens,
      provider,
    } = {}) {
      const config = checkedConfig(
        provider ?? defaultConfig,
        env,
        options.allowedHosts,
      );
      const input = messagesForRequest(messages, system, json);
      if (signal?.aborted) fail("cancelled", "This AI request was cancelled.");
      const limit = Math.max(
        1,
        Math.min(
          outputLimit,
          Number.isSafeInteger(maxTokens) ? maxTokens : outputLimit,
        ),
      );
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      const body = { model: config.model, max_tokens: limit, stream: false };
      if (config.type === "anthropic") {
        headers["x-api-key"] = config.apiKey;
        headers["anthropic-version"] = "2023-06-01";
        body.messages = input.conversation;
        if (input.system) body.system = input.system;
      } else {
        if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
        if (
          new URL(config.endpoint).hostname === "api.openai.com" &&
          /^(?:gpt-5|o[134])(?:-|$)/.test(config.model)
        ) {
          body.max_completion_tokens = body.max_tokens;
          delete body.max_tokens;
        }
        body.messages = [
          ...(input.system ? [{ role: "system", content: input.system }] : []),
          ...input.conversation,
        ];
        if (json) body.response_format = { type: "json_object" };
      }
      const controller = new AbortController();
      let timedOut = false;
      let cancelled = false;
      let abortReject;
      const interrupted = new Promise((_, reject) => {
        abortReject = reject;
      });
      const cancel = () => {
        cancelled = true;
        controller.abort();
        abortReject(
          new ProviderError("cancelled", "This AI request was cancelled."),
        );
      };
      signal?.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        abortReject(
          new ProviderError(
            "timeout",
            "The AI provider did not respond within the time limit. Try a smaller task or another provider.",
          ),
        );
      }, timeoutMs);
      const started = performance.now();
      try {
        const work = async () => {
          const response = await fetchImpl(config.endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
          });
          if (
            response.redirected ||
            (response.url &&
              new URL(response.url).origin !== new URL(config.endpoint).origin)
          ) {
            fail(
              "invalid_response",
              "The AI provider attempted an unsupported redirect. Check its endpoint.",
            );
          }
          if (!response.ok) {
            await response.body?.cancel?.().catch(() => {});
            statusError(response.status);
          }
          let payload;
          try {
            payload = JSON.parse(await boundedResponse(response));
          } catch (error) {
            if (error instanceof ProviderError) throw error;
            fail(
              "invalid_response",
              "The AI provider returned an unreadable response. Try another configured model.",
            );
          }
          return completionResult(
            payload,
            config,
            Math.round(performance.now() - started),
          );
        };
        return await Promise.race([work(), interrupted]);
      } catch (error) {
        if (cancelled || signal?.aborted)
          fail("cancelled", "This AI request was cancelled.");
        if (timedOut)
          fail(
            "timeout",
            "The AI provider did not respond within the time limit. Try a smaller task or another provider.",
          );
        if (error instanceof ProviderError) throw error;
        fail(
          "provider_unavailable",
          "The AI connection failed. Check the provider endpoint and server connectivity.",
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    },
  };
}
