import test from "node:test";
import assert from "node:assert/strict";
import {
  createProvider,
  providerAvailable,
  ProviderError,
} from "../provider.mjs";
import { isLocalProvider, runtimePolicy } from "../runtime-policy.mjs";

const config = {
  type: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiKey: "test-secret-only",
};
const messages = [{ role: "user", content: "Plan a small project." }];
const result = () =>
  new Response(
    JSON.stringify({
      choices: [
        { message: { content: '{"summary":"A plan"}' }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 14, completion_tokens: 9 },
    }),
  );
const hasCode = (code) => (error) =>
  error instanceof ProviderError && error.code === code;

test("OpenAI reasoning models use the supported completion-token limit parameter", async () => {
  let body;
  const provider = createProvider({
    env: {},
    fetch: async (_url, request) => {
      body = JSON.parse(request.body);
      return result();
    },
  });
  await provider.complete({
    provider: { ...config, model: "gpt-5" },
    messages,
    maxTokens: 1024,
  });
  assert.equal(body.max_completion_tokens, 1024);
  assert.equal(body.max_tokens, undefined);
});

test("OpenAI-compatible calls fixed endpoint, bounds tokens, and reports real usage", async () => {
  let request;
  const provider = createProvider({
    provider: config,
    env: {},
    fetch: async (url, init) => {
      request = { url, ...init };
      return result();
    },
  });
  assert.equal(provider.configured, true);
  const response = await provider.complete({
    messages,
    system: "Be precise.",
    json: true,
    maxTokens: 99_999,
  });
  assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(request.headers.Authorization, "Bearer test-secret-only");
  assert.equal(request.redirect, "error");
  assert.equal(request.credentials, "omit");
  const body = JSON.parse(request.body);
  assert.equal(body.max_tokens, 4_096);
  assert.equal(body.stream, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.match(body.messages[0].content, /Be precise/);
  assert.match(body.messages[0].content, /JSON/);
  assert.deepEqual(body.messages[1], messages[0]);
  assert.deepEqual(response.usage, { inputTokens: 14, outputTokens: 9 });
  assert.equal(response.model, config.model);
  assert.ok(response.durationMs >= 0);
  assert.equal(JSON.parse(response.text).summary, "A plan");
});

test("Anthropic uses its own key header, separate system instruction, and content blocks", async () => {
  let request;
  const provider = createProvider({
    env: {},
    fetch: async (url, init) => {
      request = { url, ...init };
      return new Response(
        JSON.stringify({
          content: [
            { type: "thinking", thinking: "hidden" },
            { type: "text", text: '{"done":true}' },
          ],
          stop_reason: "end_turn",
          usage: { input_tokens: 7, output_tokens: 5 },
        }),
      );
    },
  });
  const response = await provider.complete({
    provider: {
      type: "anthropic",
      baseUrl: "https://api.anthropic.com/v1/",
      apiKey: "anthropic-test-secret",
      model: "claude-sonnet-4-20250514",
    },
    messages: [{ role: "system", content: "Act as a manager." }, ...messages],
    system: "Never claim unseen results.",
    json: true,
    maxTokens: 123,
  });
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.headers["x-api-key"], "anthropic-test-secret");
  assert.equal(request.headers["anthropic-version"], "2023-06-01");
  const body = JSON.parse(request.body);
  assert.equal(body.max_tokens, 123);
  assert.deepEqual(body.messages, messages);
  assert.match(body.system, /Never claim/);
  assert.match(body.system, /Act as a manager/);
  assert.match(body.system, /JSON/);
  assert.equal(body.response_format, undefined);
  assert.deepEqual(response.usage, { inputTokens: 7, outputTokens: 5 });
  assert.equal(response.text, '{"done":true}');
});

test("unconfigured providers block work without fabricating a completion", async () => {
  let called = false;
  const provider = createProvider({
    env: {},
    fetch: async () => {
      called = true;
      return result();
    },
  });
  assert.equal(provider.configured, false);
  assert.equal(providerAvailable(config, { env: {} }), true);
  assert.equal(
    providerAvailable({ ...config, apiKey: "" }, { env: {} }),
    false,
  );
  await assert.rejects(
    provider.complete({ messages }),
    hasCode("missing_model"),
  );
  await assert.rejects(
    provider.complete({ messages, provider: { ...config, apiKey: "" } }),
    hasCode("missing_key"),
  );
  assert.equal(called, false);
});

test("environment defaults support configured models and explicitly enabled local Ollama", async () => {
  const requests = [];
  const env = {
    ATTENDX_MODEL_BASE_URL: "http://ollama:11434/v1",
    ATTENDX_MODEL: "qwen2.5-coder:7b",
    ATTENDX_MODEL_LOCAL: "true",
  };
  const provider = createProvider({
    env,
    fetch: async (url, init) => {
      requests.push({ url, ...init });
      return result();
    },
  });
  assert.equal(provider.configured, true);
  await provider.complete({ messages });
  assert.equal(requests[0].url, "http://ollama:11434/v1/chat/completions");
  assert.equal(requests[0].headers.Authorization, undefined);
  assert.equal(
    providerAvailable({ ...config, apiKey: "", local: true }, { env: {} }),
    false,
  );
  assert.equal(
    providerAvailable(
      {
        ...config,
        baseUrl: "http://ollama:11434/v1",
        apiKey: "",
        local: false,
      },
      { env: {} },
    ),
    false,
  );
});

test("rejects non-allowlisted endpoints, credentials, insecure remote transport, queries and fragments", async () => {
  let called = false;
  const provider = createProvider({
    provider: config,
    env: {},
    fetch: async () => {
      called = true;
      return result();
    },
  });
  for (const baseUrl of [
    "https://evil.example/v1",
    "http://api.openai.com/v1",
    "https://secret@api.openai.com/v1",
    "https://api.openai.com/v1?token=secret",
    "https://api.openai.com/v1#fragment",
    "http://169.254.169.254/v1",
    "https://api.openai.com.evil.example/v1",
  ]) {
    await assert.rejects(
      provider.complete({ messages, provider: { ...config, baseUrl } }),
      hasCode("invalid_config"),
    );
  }
  await assert.rejects(
    provider.complete({
      messages,
      provider: { ...config, apiKey: "secret\r\nInjected: header" },
    }),
    hasCode("invalid_key"),
  );
  assert.equal(called, false);
});

test("administrator allowlisting permits only the configured custom host", async () => {
  let target;
  const provider = createProvider({
    env: { ATTENDX_PROVIDER_HOSTS: "models.example.test" },
    fetch: async (url) => {
      target = url;
      return result();
    },
  });
  await provider.complete({
    messages,
    provider: { ...config, baseUrl: "https://models.example.test/v1" },
  });
  assert.equal(target, "https://models.example.test/v1/chat/completions");
  await assert.rejects(
    provider.complete({
      messages,
      provider: { ...config, baseUrl: "https://other.example.test/v1" },
    }),
    hasCode("invalid_config"),
  );
});

test("authorization and remote errors never expose raw response body or secret", async () => {
  for (const [status, code] of [
    [401, "invalid_key"],
    [403, "invalid_key"],
    [429, "rate_limit"],
    [400, "provider_config"],
    [503, "provider_unavailable"],
  ]) {
    const provider = createProvider({
      provider: config,
      env: {},
      fetch: async () =>
        new Response(`RAW REMOTE BODY ${config.apiKey}`, { status }),
    });
    await assert.rejects(provider.complete({ messages }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes(config.apiKey), false);
      assert.equal(error.message.includes("RAW REMOTE"), false);
      return true;
    });
  }
  const provider = createProvider({
    provider: config,
    env: {},
    fetch: async () => {
      throw new Error(`network: ${config.apiKey}`);
    },
  });
  await assert.rejects(
    provider.complete({ messages }),
    (error) =>
      error.code === "provider_unavailable" &&
      !error.message.includes(config.apiKey),
  );
});

test("timeouts abort the network call even if an injected fetch ignores cancellation", async () => {
  let networkSignal;
  const provider = createProvider({
    provider: config,
    env: {},
    timeoutMs: 5,
    fetch: async (_url, init) => {
      networkSignal = init.signal;
      return new Promise(() => {});
    },
  });
  await assert.rejects(provider.complete({ messages }), hasCode("timeout"));
  assert.equal(networkSignal.aborted, true);
});

test("caller cancellation propagates without returning a late result", async () => {
  const controller = new AbortController();
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  let networkSignal;
  const provider = createProvider({
    provider: config,
    env: {},
    fetch: async (_url, init) => {
      networkSignal = init.signal;
      started();
      return new Promise(() => {});
    },
  });
  const completion = provider.complete({ messages, signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(completion, hasCode("cancelled"));
  assert.equal(networkSignal.aborted, true);
  await assert.rejects(
    provider.complete({ messages, signal: controller.signal }),
    hasCode("cancelled"),
  );
});

test("provider credentials stay isolated between explicit per-call configurations", async () => {
  const keys = [];
  const provider = createProvider({
    provider: config,
    env: {},
    fetch: async (url, init) => {
      keys.push([
        new URL(url).host,
        init.headers.Authorization,
        init.headers["x-api-key"],
      ]);
      return url.includes("anthropic")
        ? new Response(
            JSON.stringify({
              content: [{ type: "text", text: "A reply." }],
              stop_reason: "end_turn",
            }),
          )
        : result();
    },
  });
  await provider.complete({ messages });
  await provider.complete({
    messages,
    provider: {
      type: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-sonnet-4-20250514",
      apiKey: "other-secret",
    },
  });
  assert.deepEqual(keys, [
    ["api.openai.com", "Bearer test-secret-only", undefined],
    ["api.anthropic.com", undefined, "other-secret"],
  ]);
});

test("rejects redirects, oversized responses, malformed completions, and truncated text", async () => {
  const cases = [
    [() => ({ ok: true, redirected: true }), "invalid_response"],
    [
      () =>
        new Response("large", {
          headers: { "content-length": String(3 * 1024 * 1024) },
        }),
      "response_limit",
    ],
    [() => new Response("not json"), "invalid_response"],
    [() => new Response(JSON.stringify({ choices: [] })), "invalid_response"],
    [
      () =>
        new Response(
          JSON.stringify({
            choices: [
              { finish_reason: "length", message: { content: "Incomplete" } },
            ],
          }),
        ),
      "response_limit",
    ],
    [
      () =>
        new Response(
          JSON.stringify({
            choices: [
              { finish_reason: "content_filter", message: { content: "" } },
            ],
          }),
        ),
      "provider_refused",
    ],
  ];
  for (const [response, code] of cases) {
    const provider = createProvider({
      provider: config,
      env: {},
      fetch: async () => response(),
    });
    await assert.rejects(provider.complete({ messages }), hasCode(code));
  }
});

test("missing usage remains unknown and oversized input is rejected before fetch", async () => {
  let called = 0;
  const provider = createProvider({
    provider: config,
    env: {},
    fetch: async () => {
      called += 1;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "A reply." } }] }),
      );
    },
  });
  const reply = await provider.complete({ messages });
  assert.deepEqual(reply.usage, { inputTokens: null, outputTokens: null });
  await assert.rejects(
    provider.complete({
      messages: [{ role: "user", content: "x".repeat(250_001) }],
    }),
    hasCode("request_limit"),
  );
  await assert.rejects(
    provider.complete({
      messages: [{ role: "tool", content: "unknown tool" }],
    }),
    hasCode("invalid_request"),
  );
  assert.equal(called, 1);
});

test("runtime policy rejects malformed or unbounded limits instead of silently disabling them", () => {
  assert.deepEqual(runtimePolicy({}), {
    localOnly: false,
    workerConcurrency: 2,
    localCallLimit: 200,
    modelTimeoutMs: 45_000,
    maxTokens: 4_096,
  });
  assert.deepEqual(
    runtimePolicy({
      ATTENDX_LOCAL_ONLY: "true",
      ATTENDX_WORKER_CONCURRENCY: "1",
      ATTENDX_LOCAL_MAX_CALLS_PER_PROJECT: "12",
      ATTENDX_MODEL_TIMEOUT_MS: "600000",
      ATTENDX_MODEL_MAX_TOKENS: "1024",
    }),
    {
      localOnly: true,
      workerConcurrency: 1,
      localCallLimit: 12,
      modelTimeoutMs: 600_000,
      maxTokens: 1_024,
    },
  );
  for (const env of [
    { ATTENDX_LOCAL_ONLY: "yes" },
    { ATTENDX_WORKER_CONCURRENCY: "3" },
    { ATTENDX_LOCAL_MAX_CALLS_PER_PROJECT: "0" },
    { ATTENDX_LOCAL_MAX_CALLS_PER_PROJECT: "2garbage" },
    { ATTENDX_MODEL_TIMEOUT_MS: "900001" },
    { ATTENDX_MODEL_MAX_TOKENS: "8193" },
  ])
    assert.throws(() => createProvider({ env }), /ATTENDX_/);
});

test("local-only mode denies remote saved and environment configurations before any fetch", async () => {
  let requests = 0;
  const provider = createProvider({
    env: {
      ATTENDX_LOCAL_ONLY: "true",
      ATTENDX_MODEL: config.model,
      ATTENDX_MODEL_API_KEY: config.apiKey,
    },
    fetch: async () => {
      requests += 1;
      return result();
    },
  });
  assert.equal(provider.configured, false);
  assert.equal(provider.defaultLocal, false);
  for (const setting of [config, { ...config, local: true }])
    await assert.rejects(
      provider.complete({ provider: setting, messages }),
      hasCode("local_only"),
    );
  await assert.rejects(provider.complete({ messages }), hasCode("local_only"));
  assert.equal(requests, 0);
  assert.equal(isLocalProvider({ ...config, local: true }), false);
  assert.equal(
    isLocalProvider({ ...config, baseUrl: "http://ollama.attacker.test/v1", local: true }),
    false,
  );
});

test("local-only Ollama accepts keyless JSON requests with the configured output bound", async () => {
  let request;
  const provider = createProvider({
    env: {
      ATTENDX_LOCAL_ONLY: "true",
      ATTENDX_MODEL_BASE_URL: "http://ollama:11434/v1",
      ATTENDX_MODEL_LOCAL: "true",
      ATTENDX_MODEL: "qwen2.5-coder:3b",
      ATTENDX_MODEL_MAX_TOKENS: "1024",
      ATTENDX_MODEL_TIMEOUT_MS: "600000",
    },
    fetch: async (url, init) => {
      request = { url, ...init };
      return result();
    },
  });
  assert.equal(provider.configured, true);
  assert.equal(provider.defaultLocal, true);
  const response = await provider.complete({ messages, json: true, maxTokens: 4096 });
  assert.equal(request.url, "http://ollama:11434/v1/chat/completions");
  assert.equal(request.headers.Authorization, undefined);
  const body = JSON.parse(request.body);
  assert.equal(body.max_tokens, 1024);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(JSON.parse(response.text).summary, "A plan");
});

test("long model timeouts apply only to local inference and remote requests remain capped", async (t) => {
  const delays = [];
  const originalTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    delays.push(delay);
    return originalTimeout(callback, 1);
  });
  const provider = createProvider({
    env: { ATTENDX_MODEL_TIMEOUT_MS: "900000" },
    fetch: async () => new Promise(() => {}),
  });
  await assert.rejects(
    provider.complete({ provider: config, messages }),
    hasCode("timeout"),
  );
  await assert.rejects(
    provider.complete({
      provider: {
        ...config,
        baseUrl: "http://ollama:11434/v1",
        apiKey: "",
        local: true,
      },
      messages,
    }),
    hasCode("timeout"),
  );
  assert.deepEqual(delays, [120_000, 900_000]);
});
