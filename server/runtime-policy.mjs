const LOCAL_HOSTS = new Set(["host.docker.internal", "ollama"]);

function invalid(name, range) {
  const error = new Error(`${name} must be ${range}.`);
  error.code = "invalid_runtime_policy";
  throw error;
}

function integer(env, name, fallback, min, max) {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  if (
    !/^[0-9]+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    invalid(name, `an integer from ${min} to ${max}`);
  return Number(value);
}

/** Validated, non-secret operating limits shared by the API and worker. */
export function runtimePolicy(env = process.env) {
  const localOnly = env.ATTENDX_LOCAL_ONLY;
  if (
    localOnly !== undefined &&
    localOnly !== "" &&
    ![true, false, "true", "false", "1", "0"].includes(localOnly)
  )
    invalid("ATTENDX_LOCAL_ONLY", "true or false");
  return {
    localOnly: [true, "true", "1"].includes(localOnly),
    workerConcurrency: integer(env, "ATTENDX_WORKER_CONCURRENCY", 2, 1, 2),
    localCallLimit: integer(
      env,
      "ATTENDX_LOCAL_MAX_CALLS_PER_PROJECT",
      200,
      1,
      100_000,
    ),
    modelTimeoutMs: integer(env, "ATTENDX_MODEL_TIMEOUT_MS", 45_000, 1, 900_000),
    maxTokens: integer(env, "ATTENDX_MODEL_MAX_TOKENS", 4_096, 1, 8_192),
  };
}

/** Merely marking a remote endpoint as local never grants local privileges. */
export function isLocalProvider(config) {
  if (
    !config ||
    ![true, "true", "1"].includes(config.local) ||
    (config.type || "openai") !== "openai"
  )
    return false;
  try {
    const url = new URL(config.baseUrl);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      LOCAL_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
