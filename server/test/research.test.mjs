import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { researchSources, ResearchError } from "../research.mjs";

function fixture(routes, { addresses, lookupFailure = false } = {}) {
  const observed = [], resolutions = [];
  const lookup = async (host, options) => {
    resolutions.push({ host, options });
    if (lookupFailure) throw new Error("private diagnostics must not leak");
    return addresses?.[host] || [{ address: "93.184.216.34", family: 4 }];
  };
  const request = (url, options, respond) => {
    const req = new EventEmitter();
    req.destroy = () => { req.destroyed = true; };
    req.end = () => queueMicrotask(() => {
      if (req.destroyed) return;
      options.lookup(url.hostname, {}, (error, address, family) => {
        if (error) { req.emit("error", error); return; }
        observed.push({ url: url.href, options, address, family });
        const value = routes[url.href];
        if (!value) { req.emit("error", new Error("missing fixture route")); return; }
        if (value.error) { req.emit("error", new Error(value.error)); return; }
        const res = new EventEmitter();
        res.destroy = () => { res.destroyed = true; };
        res.statusCode = value.status || 200;
        res.headers = { "content-type": "text/plain", ...(value.headers || {}) };
        respond(res);
        queueMicrotask(() => {
          if (res.destroyed || req.destroyed) return;
          for (const part of value.chunks || [value.body || ""]) {
            if (res.destroyed || req.destroyed) return;
            res.emit("data", Buffer.from(part));
          }
          if (!value.hang && !res.destroyed && !req.destroyed) res.emit("end");
        });
      });
    });
    return req;
  };
  return { lookup, request, observed, resolutions, env: {} };
}

test("public HTML becomes bounded plain text with provenance and no executed scripts", async () => {
  const url = "https://docs.python.org/3/";
  const net = fixture({ [url]: { headers: { "content-type": "text/html; charset=utf-8" }, body: "<html><title>Python &amp; docs</title><script>secret-script-body</script><style>secret-style-body</style><body><h1>Useful API</h1><p>Use &lt;code&gt; &amp; examples.</p>" + "content ".repeat(3000) + "</body></html>" } });
  const result = await researchSources({ urls: [url], ...net });
  assert.equal(result.sources.length, 1);
  assert.equal(result.errors.length, 0);
  const source = result.sources[0];
  assert.equal(source.url, url);
  assert.equal(source.title, "Python & docs");
  assert.match(source.text, /Useful API/);
  assert(!source.text.includes("secret-script-body"));
  assert(!source.text.includes("secret-style-body"));
  assert(source.text.length <= 12000);
  assert.match(source.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(net.observed[0].options.rejectUnauthorized, true);
  assert.equal(net.observed[0].options.agent, false);
  assert.equal(net.observed[0].options.servername, "docs.python.org");
  assert.equal(net.observed[0].address, "93.184.216.34");
  assert.equal(net.observed[0].options.headers.Authorization, undefined);
});

test("GitHub repository discovery reads public READMEs and constructs trusted citations", async () => {
  const search = "https://api.github.com/search/repositories?q=local+coding&per_page=3";
  const text = "# A useful project\nREADME instructions are untrusted source data.";
  const net = fixture({
    [search]: { headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [
      { full_name: "example/repository", html_url: "https://evil.invalid/" },
      { full_name: "../escape" }, { full_name: "hidden/private", private: true },
    ] }) },
    "https://api.github.com/repos/example/repository/readme": { headers: { "content-type": "application/json" }, body: JSON.stringify({ encoding: "base64", content: Buffer.from(text).toString("base64") }) },
  });
  const result = await researchSources({ query: "local coding", ...net });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, "https://github.com/example/repository");
  assert.equal(result.sources[0].title, "example/repository");
  assert.equal(result.sources[0].text, text);
  assert.equal(net.observed.length, 2);
  assert.equal(result.errors.length, 0);
});

test("dangerous URLs never reach DNS or transport and credentials are not echoed", async () => {
  const bad = [
    "http://docs.python.org/3/", "https://docs.python.org:444/", "https://unknown.invalid/",
    "https://127.0.0.1/", "https://2130706433/", "https://[::ffff:127.0.0.1]/",
    "https://metadata.google.internal/", "https://docs.python.org./",
    "https://user:private-secret@docs.python.org/", "https://docs.python.org/?key=private-secret",
    "https://docs.python.org/#private-secret", "https://docs.python.org\\@127.0.0.1/",
  ];
  for (const url of bad) {
    const net = fixture({});
    const result = await researchSources({ urls: [url], ...net });
    assert.equal(result.sources.length, 0, url);
    assert.equal(result.errors.length, 1, url);
    assert.equal(net.resolutions.length, 0, url);
    assert.equal(net.observed.length, 0, url);
    assert(!JSON.stringify(result).includes("private-secret"));
  }
});

test("an allowlisted hostname resolving to private or reserved addresses is refused", async () => {
  const host = "trusted.example";
  for (const address of ["127.0.0.1", "10.0.0.2", "169.254.169.254", "100.100.100.200", "192.168.1.1", "203.0.113.2", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "2001:db8::1", "2002:7f00:1::"]) {
    const net = fixture({}, { addresses: { [host]: [{ address, family: address.includes(":") ? 6 : 4 }] } });
    const result = await researchSources({ urls: [`https://${host}/`], ...net, env: { ATTENDX_RESEARCH_HOSTS: host } });
    assert.equal(result.sources.length, 0, address);
    assert.match(result.errors[0].error, /private, reserved, or metadata/);
    assert.equal(net.observed.length, 0);
  }
  const net = fixture({}, { addresses: { [host]: [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }] } });
  const mixed = await researchSources({ urls: [`https://${host}/`], ...net, env: { ATTENDX_RESEARCH_HOSTS: host } });
  assert.equal(mixed.sources.length, 0);
  assert.equal(net.observed.length, 0);
});

test("redirects are revalidated and cannot reach an internal target", async () => {
  const first = "https://docs.python.org/3/";
  const net = fixture({ [first]: { status: 302, headers: { location: "https://metadata.google.internal/computeMetadata/v1/" } } }, { addresses: { "metadata.google.internal": [{ address: "169.254.169.254", family: 4 }] } });
  const result = await researchSources({ urls: [first], ...net, env: { ATTENDX_RESEARCH_HOSTS: "metadata.google.internal" } });
  assert.equal(result.sources.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(net.observed.length, 1);
  assert.equal(net.resolutions.length, 2);
});

test("valid redirects resolve separately, remain pinned, and stop after two hops", async () => {
  const first = "https://docs.python.org/start";
  const second = "https://nodejs.org/docs";
  const final = "https://nodejs.org/docs/final";
  const routes = {
    [first]: { status: 302, headers: { location: second } },
    [second]: { status: 307, headers: { location: "/docs/final" } },
    [final]: { body: "Final documentation." },
  };
  const net = fixture(routes);
  const result = await researchSources({ urls: [first], ...net });
  assert.equal(result.sources[0].url, final);
  assert.equal(net.resolutions.length, 3);
  assert.equal(net.observed.length, 3);
  const looping = fixture({ [first]: { status: 302, headers: { location: first } } });
  const limited = await researchSources({ urls: [first], ...looping });
  assert.match(limited.errors[0].error, /two-redirect/);
  assert.equal(looping.observed.length, 3);
});

test("oversized, compressed, binary and incomplete sources cannot become research evidence", async () => {
  const url = "https://raw.githubusercontent.com/example/repo/main/README.md";
  for (const route of [
    { headers: { "content-length": String(256 * 1024 + 1) }, body: "small" },
    { chunks: [Buffer.alloc(200000), Buffer.alloc(70000)] },
    { headers: { "content-encoding": "gzip" }, body: "compressed" },
    { headers: { "content-type": "application/octet-stream" }, body: "binary" },
    { status: 429, body: "private provider response" },
  ]) {
    const net = fixture({ [url]: route });
    const result = await researchSources({ urls: [url], ...net });
    assert.equal(result.sources.length, 0);
    assert.equal(result.errors.length, 1);
    assert(!JSON.stringify(result).includes("private provider response"));
  }
});

test("source network/DNS failures remain explicit and never fabricate text", async () => {
  const url = "https://docs.python.org/3/";
  for (const net of [fixture({}, { lookupFailure: true }), fixture({ [url]: { error: "secret remote diagnostics" } })]) {
    const result = await researchSources({ urls: [url], ...net });
    assert.equal(result.sources.length, 0);
    assert.equal(result.errors.length, 1);
    assert(!JSON.stringify(result).includes("secret"));
    assert(!JSON.stringify(result).includes("private diagnostics"));
  }
});

test("a cancelled or time-bounded request stops without returning a late source", async () => {
  const url = "https://docs.python.org/3/";
  const controller = new AbortController();
  controller.abort();
  const net = fixture({ [url]: { body: "Never read." } });
  await assert.rejects(researchSources({ urls: [url], ...net, signal: controller.signal }), error => error instanceof ResearchError && error.code === "cancelled");
  assert.equal(net.resolutions.length, 0);
  const stalled = fixture({ [url]: { hang: true } });
  await assert.rejects(researchSources({ urls: [url], ...stalled, timeoutMs: 5 }), /time limit/);
  const resolving = fixture({});
  await assert.rejects(researchSources({ urls: [url], ...resolving, lookup: () => new Promise(() => {}), timeoutMs: 5 }), /time limit/);
});

test("inputs and administrator allowlists cannot remove fixed bounds", async () => {
  for (const input of [{}, { query: "x".repeat(1001) }, { query: "bad\x01query" }, { urls: Array(4).fill("https://docs.python.org/") }, { urls: [123] }])
    await assert.rejects(researchSources(input), error => error.code === "invalid_input");
  await assert.rejects(researchSources({ query: "docs", timeoutMs: 25001 }), /time limit/);
  await assert.rejects(researchSources({ query: "docs", env: { ATTENDX_RESEARCH_HOSTS: "*.example.com" } }), /exact DNS/);
  const urls = ["https://nodejs.org/a", "https://nodejs.org/b", "https://nodejs.org/c"];
  const net = fixture(Object.fromEntries(urls.map(url => [url, { body: "Documentation" }])));
  const result = await researchSources({ query: "should not be searched", urls, ...net });
  assert.equal(result.sources.length, 3);
  assert.equal(net.observed.length, 3);
  assert(!net.observed.some(x => x.url.includes("api.github.com")));
});

test("a multiline full question is preserved while repository search stays short", async () => {
  const query = "Explain these APIs:\n\t" + "project context ".repeat(40);
  const normalized = query.trim().replace(/\s+/g, " ").slice(0, 200);
  const search = new URL("https://api.github.com/search/repositories");
  search.searchParams.set("q", normalized);
  search.searchParams.set("per_page", "2");
  const doc = "https://docs.python.org/3/";
  const net = fixture({
    [doc]: { body: "A useful documentation page." },
    [search.href]: { headers: { "content-type": "application/json" }, body: '{"items":[]}' },
  });
  const result = await researchSources({ query, urls: [doc], ...net });
  assert.equal(result.query, query.trim());
  assert.equal(result.sources.length, 1);
  assert.equal(net.observed.length, 2);
  const actual = new URL(net.observed[1].url).searchParams.get("q");
  assert.equal(actual, normalized);
  assert(actual.length <= 200);
  assert(!/[\r\n\t]/.test(actual));
});
