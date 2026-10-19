const MAX_FILES = 60;
const MAX_FILE_BYTES = 120_000;
const MAX_TOTAL_BYTES = 600_000;
const SKIPPED =
  /(^|\/)(?:\.git|node_modules|vendor|dist|build|coverage|\.next|\.venv|venv|__pycache__)(\/|$)/;
const SENSITIVE =
  /(^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519|credentials|master\.key)(?:$|\/)/i;

export function validPath(path) {
  return (
    typeof path === "string" &&
    /^[A-Za-z0-9_.\/-]+$/.test(path) &&
    path.length > 0 &&
    path.length <= 180 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/[\x00-\x1f\x7f]/.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..") &&
    !SKIPPED.test(path) &&
    !SENSITIVE.test(path)
  );
}

export function validateFiles(input) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_FILES)
    throw new Error(`Candidate must contain 1–${MAX_FILES} text files.`);
  let bytes = 0;
  const seen = new Set();
  return input.map((file) => {
    if (
      !file ||
      !validPath(file.path) ||
      typeof file.content !== "string" ||
      file.content.includes("\u0000")
    )
      throw new Error(
        "Candidate contains an unsupported or unsafe text file path.",
      );
    if (seen.has(file.path))
      throw new Error("Candidate contains duplicate paths.");
    seen.add(file.path);
    const length = Buffer.byteLength(file.content);
    bytes += length;
    if (length > MAX_FILE_BYTES || bytes > MAX_TOTAL_BYTES)
      throw new Error("Candidate exceeds the bounded text-file size limit.");
    return { path: file.path, content: file.content };
  });
}

export function parseModelJSON(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 800_000)
    throw new Error("Model response is missing or too large.");
  const value = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed;
  } catch {
    throw new Error(
      "Model did not return the required JSON object. Please revise the request or select a model supporting structured responses.",
    );
  }
}

export function sourceDiff(original, candidate) {
  const old = new Map(original.map((file) => [file.path, file.content]));
  const blocks = [];
  // Files omitted by the model are preserved; it cannot silently delete imported source.
  for (const file of candidate) {
    const before = old.get(file.path);
    if (before === file.content) continue;
    const previous = before === undefined ? [] : before.split("\n");
    const next = file.content.split("\n");
    blocks.push(
      `diff --git a/${file.path} b/${file.path}\n--- ${before === undefined ? "/dev/null" : `a/${file.path}`}\n+++ b/${file.path}\n@@ -${previous.length ? 1 : 0},${previous.length} +1,${next.length} @@\n${previous
        .map((line) => `-${line}`)
        .concat(next.map((line) => `+${line}`))
        .join("\n")}\n`,
    );
  }
  return blocks.join("\n") || "No source changes.\n";
}

async function boundedJSON(fetcher, url, signal, limit = 1_200_000) {
  const response = await fetcher(url, {
    signal,
    redirect: "error",
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "Attendx-read-only-import",
    },
  });
  if (!response.ok)
    throw new Error(
      response.status === 404 || response.status === 403
        ? "Repository is private, unavailable, or GitHub denied the read-only import. Only public repositories are supported."
        : "GitHub repository import failed.",
    );
  const text = await boundedText(response, limit);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("GitHub returned an invalid repository response.");
  }
}

async function boundedText(response, limit) {
  if (Number(response.headers.get("content-length") || 0) > limit)
    throw new Error("Repository response exceeds the import size limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit)
        throw new Error("Repository response exceeds the import size limit.");
      parts.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(parts).toString("utf8");
}

export async function importPublicRepository(
  repoUrl,
  { fetch: fetcher = fetch, signal } = {},
) {
  if (!repoUrl) return { files: [], source: null };
  signal = AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(30000),
  ]);
  let url;
  try {
    url = new URL(repoUrl);
  } catch {
    throw new Error(
      "Repository URL must be a public https://github.com/owner/repository address.",
    );
  }
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
    url.pathname,
  );
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match ||
    [".", ".."].includes(match[1]) ||
    [".", ".."].includes(match[2])
  )
    throw new Error(
      "Only a public https://github.com/owner/repository URL without credentials or extra paths is supported.",
    );
  const [, owner, name] = match;
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const metadata = await boundedJSON(fetcher, base, signal);
  if (metadata.private || typeof metadata.default_branch !== "string")
    throw new Error(
      "Only public repositories with a default branch can be imported.",
    );
  const commit = await boundedJSON(
    fetcher,
    `${base}/commits/${encodeURIComponent(metadata.default_branch)}`,
    signal,
    100_000,
  );
  if (!/^[a-f0-9]{40}$/i.test(commit.sha || ""))
    throw new Error("GitHub did not return a pinned source commit.");
  const tree = await boundedJSON(
    fetcher,
    `${base}/git/trees/${commit.sha}?recursive=1`,
    signal,
  );
  if (tree.truncated || !Array.isArray(tree.tree))
    throw new Error("Repository tree is too large for this bounded importer.");
  const blobs = tree.tree.filter(
    (item) => item.type === "blob" && !SKIPPED.test(item.path || ""),
  );
  if (blobs.length > MAX_FILES)
    throw new Error(
      `Repository has more than ${MAX_FILES} source files; import a smaller project or provide a focused repository.`,
    );
  const files = [];
  let total = 0;
  for (const blob of blobs) {
    if (
      !validPath(blob.path) ||
      !["100644", "100755"].includes(blob.mode) ||
      !Number.isSafeInteger(blob.size) ||
      blob.size > MAX_FILE_BYTES
    )
      throw new Error(
        "Repository contains unsafe paths, symlinks, secrets files, binary files, or oversized files unsupported by this importer.",
      );
    total += blob.size;
    if (total > MAX_TOTAL_BYTES)
      throw new Error(
        "Repository source exceeds the 600 KB bounded import limit.",
      );
    const path = blob.path.split("/").map(encodeURIComponent).join("/");
    const response = await fetcher(
      `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${commit.sha}/${path}`,
      {
        signal,
        redirect: "error",
        headers: {
          accept: "text/plain",
          "user-agent": "Attendx-read-only-import",
        },
      },
    );
    if (!response.ok)
      throw new Error("A public repository file could not be imported.");
    const content = await boundedText(response, MAX_FILE_BYTES);
    if (content.includes("\u0000") || content.includes("\ufffd"))
      throw new Error(
        "Repository contains binary or non-UTF-8 files unsupported by this importer.",
      );
    files.push({ path: blob.path, content });
  }
  return {
    files,
    source: {
      url: repoUrl,
      commit: commit.sha,
      files: files.length,
      bytes: total,
      readOnly: true,
    },
  };
}
