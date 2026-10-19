let csrfToken = "";
export function setCsrfToken(value: string) {
  csrfToken = value;
}
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    signal: options.signal,
    headers: {
      Accept: "application/json",
      ...(method !== "GET"
        ? {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
            "X-Requested-With": "Attendx",
          }
        : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      "The server returned an unexpected response. Check that the API container is healthy.",
      response.status || 502,
    );
  }
  if (!response.ok)
    throw new ApiError(
      typeof body === "object" && body && "error" in body
        ? String(body.error)
        : `Request failed (${response.status}).`,
      response.status,
    );
  return body as T;
}
export const mutate = <T>(path: string, body: unknown = {}, method = "POST") =>
  api<T>(path, { method, body });
