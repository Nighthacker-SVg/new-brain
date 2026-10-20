import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const DEFAULT_HOSTS = [
  "api.github.com", "raw.githubusercontent.com", "github.com",
  "developer.mozilla.org", "nodejs.org", "docs.python.org", "docs.ollama.com",
];
const MAX_SOURCES = 3;
const MAX_BYTES = 256 * 1024;
const MAX_TEXT = 12_000;
const PRIVATE_IPS = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) PRIVATE_IPS.addSubnet(address, prefix, "ipv4");
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 32], ["2001:2::", 48], ["2001:10::", 28],
  ["2001:20::", 28], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
]) PRIVATE_IPS.addSubnet(address, prefix, "ipv6");

export class ResearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ResearchError";
    this.code = code;
  }
}
function fail(code, message) { throw new ResearchError(code, message); }
function checkAbort(signal) {
  if (signal.aborted) fail("cancelled", "Research was cancelled or its time limit was reached.");
}
function safeUrl(value) {
  try {
    const u = new URL(value);
    u.username = ""; u.password = ""; u.search = ""; u.hash = "";
    return u.href.slice(0, 2048);
  } catch { return "Invalid source URL"; }
}
function allowedHosts(env) {
  const extra = String(env.ATTENDX_RESEARCH_HOSTS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  for (const host of extra) {
    if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes(".") || host.includes("..") || isIP(host))
      fail("invalid_config", "Research allowlist must contain exact DNS hostnames.");
  }
  return new Set([...DEFAULT_HOSTS, ...extra]);
}
function checkedUrl(value, hosts, internal = false) {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\\x00-\x1f\x7f]/.test(value))
    fail("invalid_url", "Enter a valid public HTTPS source URL.");
  let u;
  try { u = new URL(value); } catch { fail("invalid_url", "Enter a valid public HTTPS source URL."); }
  if (u.protocol !== "https:" || (u.port && u.port !== "443") || u.username || u.password || u.hash ||
      (u.search && !(internal && u.hostname === "api.github.com" && u.pathname === "/search/repositories")) ||
      !hosts.has(u.hostname) || isIP(u.hostname.replace(/^\[|\]$/g, "")) || u.hostname.endsWith("."))
    fail("forbidden_url", "Source must use an allowed public HTTPS hostname without credentials, queries, or fragments.");
  return u;
}
function publicAddress(address) {
  if (typeof address !== "string" || address.includes("%")) return false;
  const family = isIP(address);
  if (family === 4) return !PRIVATE_IPS.check(address, "ipv4");
  return family === 6 && GLOBAL_V6.check(address, "ipv6") && !PRIVATE_IPS.check(address, "ipv6");
}
async function interruptible(promise, signal) {
  checkAbort(signal);
  let abort;
  const stopped = new Promise((_, reject) => {
    abort = () => reject(new ResearchError("cancelled", "Research was cancelled or its time limit was reached."));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([promise, stopped]); }
  finally { signal.removeEventListener("abort", abort); }
}

/** Resolve every destination and pin the accepted address for this TLS connection. */
async function download(url, { signal, lookup, request }) {
  checkAbort(signal);
  let addresses;
  try { addresses = await interruptible(lookup(url.hostname, { all: true, verbatim: true }), signal); }
  catch (error) {
    if (error instanceof ResearchError) throw error;
    fail("dns_failure", "The source hostname could not be resolved.");
  }
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(x => !publicAddress(x.address) || Number(x.family) !== isIP(x.address)))
    fail("private_address", "Research cannot connect to private, reserved, or metadata addresses.");
  const selected = addresses.find(x => Number(x.family) === 4) || addresses[0];
  return await new Promise((resolve, reject) => {
    let req, response, done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", abort);
      if (error) { response?.destroy(); req?.destroy(); reject(error); }
      else resolve(result);
    };
    const abort = () => finish(new ResearchError("cancelled", "Research was cancelled or its time limit was reached."));
    const pin = (hostname, options, callback) => {
      if (hostname !== url.hostname) return callback(new Error("Unexpected research hostname"));
      if (options?.all) callback(null, [{ address: selected.address, family: Number(selected.family) }]);
      else callback(null, selected.address, Number(selected.family));
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      req = request(url, {
        method: "GET", agent: false, family: Number(selected.family), autoSelectFamily: false,
        lookup: pin, servername: url.hostname, rejectUnauthorized: true, maxHeaderSize: 16 * 1024,
        headers: { "User-Agent": "Attendx-Research/1.0", Accept: "text/html, text/plain, application/json, text/markdown", "Accept-Encoding": "identity" },
      }, res => {
        response = res;
        const status = Number(res.statusCode || 0);
        const headers = res.headers || {};
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.destroy();
          finish(null, { status, headers, body: Buffer.alloc(0) });
          return;
        }
        if (status !== 200) { finish(new ResearchError("http_error", `Source returned HTTP ${status}.`)); return; }
        const encoding = String(headers["content-encoding"] || "identity").toLowerCase();
        const type = String(headers["content-type"] || "text/plain").toLowerCase();
        if (encoding !== "identity" || !/^(?:text\/|application\/(?:json|xhtml\+xml))/.test(type)) {
          finish(new ResearchError("unsupported_content", "Source must return uncompressed text, HTML, or JSON.")); return;
        }
        if (Number(headers["content-length"] || 0) > MAX_BYTES) {
          finish(new ResearchError("too_large", "Source exceeds the 256 KiB response limit.")); return;
        }
        const chunks = []; let bytes = 0;
        res.on("data", part => {
          const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
          bytes += chunk.length;
          if (bytes > MAX_BYTES) { finish(new ResearchError("too_large", "Source exceeds the 256 KiB response limit.")); return; }
          chunks.push(chunk);
        });
        res.on("end", () => finish(null, { status, headers, body: Buffer.concat(chunks) }));
        res.on("aborted", () => finish(new ResearchError("network_error", "Source connection ended before its response completed.")));
        res.on("error", () => finish(new ResearchError("network_error", "The source connection failed.")));
      });
      req.on("error", () => finish(new ResearchError("network_error", "The source connection failed.")));
      req.end();
      if (signal.aborted) abort();
    } catch { finish(new ResearchError("network_error", "The source connection failed.")); }
  });
}

async function get(value, options, internal = false) {
  let url = checkedUrl(value, options.hosts, internal);
  for (let redirects = 0; redirects <= 2; redirects++) {
    const response = await download(url, options);
    if (response.status === 200) return { ...response, url: url.href };
    if (redirects === 2) fail("redirect_limit", "Source exceeded the two-redirect limit.");
    const location = response.headers.location;
    if (typeof location !== "string") fail("invalid_redirect", "Source returned an invalid redirect.");
    let next;
    try { next = new URL(location, url).href; } catch { fail("invalid_redirect", "Source returned an invalid redirect."); }
    url = checkedUrl(next, options.hosts, internal);
  }
}
function entities(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, key) => {
    if (key[0] !== "#") return named[key.toLowerCase()] || all;
    const n = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : " ";
  });
}
function cleanText(value, html = false) {
  let text = value;
  if (html) text = text.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return entities(text).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n/g, "\n\n").trim().slice(0, MAX_TEXT);
}
function source(response, title) {
  const raw = response.body.toString("utf8");
  const html = /(?:text\/html|application\/xhtml\+xml)/i.test(String(response.headers["content-type"] || ""));
  const inferred = html ? raw.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] : raw.match(/^#{1,3}\s+(.+)$/m)?.[1];
  const text = cleanText(raw, html);
  if (!text) fail("empty_source", "Source contained no readable text.");
  return { url: response.url, title: cleanText(title || inferred || new URL(response.url).hostname, true).slice(0, 200), text, fetchedAt: new Date().toISOString() };
}

/**
 * Read-only, bounded public-source collection. Returned text is UNTRUSTED DATA:
 * it cannot grant agent authority or establish that a statement has been verified.
 * No browser execution, model calls, private credentials, or paid search API.
 */
export async function researchSources({ query = "", urls = [], signal, env = process.env, lookup = dnsLookup, request = https.request, timeoutMs = 25_000 } = {}) {
  if (typeof query !== "string" || query.trim().length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(query) ||
      !Array.isArray(urls) || urls.length > MAX_SOURCES || urls.some(x => typeof x !== "string") ||
      (!query.trim() && !urls.length)) fail("invalid_input", "Provide a research question of up to 1000 characters or up to three public source URLs.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 25_000)
    fail("invalid_config", "Research time limit must be between 1 and 25000 milliseconds.");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timer = setTimeout(cancel, timeoutMs);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const result = { query: query.trim(), sources: [], errors: [] };
  const attempted = new Set();
  const report = (url, error) => result.errors.push({ url: safeUrl(url), error: error instanceof ResearchError ? error.message : "The source could not be read." });
  try {
    const options = { signal: controller.signal, hosts: allowedHosts(env), lookup, request };
    checkAbort(options.signal);
    for (const value of urls) {
      if (attempted.has(value)) continue;
      attempted.add(value);
      try { result.sources.push(source(await get(value, options))); }
      catch (error) {
        if (options.signal.aborted) throw error;
        report(value, error);
      }
    }
    if (query.trim() && result.sources.length < MAX_SOURCES) {
      const search = new URL("https://api.github.com/search/repositories");
      search.searchParams.set("q", query.trim().replace(/\s+/g, " ").slice(0, 200));
      search.searchParams.set("per_page", String(MAX_SOURCES - result.sources.length));
      try {
        const response = await get(search.href, options, true);
        let items;
        try { items = JSON.parse(response.body.toString("utf8")).items; }
        catch { fail("invalid_response", "GitHub returned an unreadable search response."); }
        if (!Array.isArray(items)) fail("invalid_response", "GitHub returned an unreadable search response.");
        for (const repo of items.slice(0, MAX_SOURCES - result.sources.length)) {
          checkAbort(options.signal);
          if (repo?.private === true) continue;
          const name = repo?.full_name;
          if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(name)) continue;
          const citation = `https://github.com/${name}`;
          if (attempted.has(citation)) continue;
          attempted.add(citation);
          try {
            const readme = await get(`https://api.github.com/repos/${name}/readme`, options);
            let data;
            try { data = JSON.parse(readme.body.toString("utf8")); }
            catch { fail("invalid_response", "GitHub returned an unreadable README response."); }
            if (data.encoding !== "base64" || typeof data.content !== "string" || !/^[A-Za-z0-9+/=\s]*$/.test(data.content))
              fail("invalid_response", "GitHub did not return a supported README document.");
            const body = Buffer.from(data.content, "base64");
            if (body.length > MAX_BYTES) fail("too_large", "Source exceeds the 256 KiB response limit.");
            result.sources.push(source({ body, url: citation, headers: { "content-type": "text/markdown" } }, name));
          } catch (error) {
            if (options.signal.aborted) throw error;
            report(citation, error);
          }
        }
      } catch (error) {
        if (options.signal.aborted) throw error;
        report("https://api.github.com/search/repositories", error);
      }
    }
    checkAbort(options.signal);
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
