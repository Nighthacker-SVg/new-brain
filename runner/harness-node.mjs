// This fixed harness is supplied by the broker, never by an agent. All candidate
// code, including its tests, executes only inside the disposable job container.
export default String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const LIMIT = 48 * 1024;
let output = '', overflow = false;
function append(value) {
  const text = String(value);
  if (Buffer.byteLength(output + text) > LIMIT) { overflow = true; return; }
  output += text;
}
function message(error) { return error?.stack || error?.message || String(error); }
function finish(ok, testCount, verification, stderr = '') {
  process.stdout.write(JSON.stringify({ ok: ok && !overflow, testCount, verification,
    stdout: output, stderr: overflow ? 'Test output exceeded the limit.' : stderr }));
  process.exitCode = ok && !overflow ? 0 : 1;
}
(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  for (const file of input.files) {
    const destination = path.join('/work', file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, file.content, { flag: 'wx', mode: 0o600 });
  }
  if (input.testCommand === 'static-check') {
    let checked = 0;
    for (const file of input.files) {
      if (/\.(?:mjs|cjs|js)$/.test(file.path)) {
        const result = spawnSync(process.execPath, ['--check', path.join('/work', file.path)],
          { encoding: 'utf8', timeout: 10000, maxBuffer: LIMIT });
        if (result.error || result.status !== 0) {
          append(result.stderr || message(result.error));
          return finish(false, 0, 'static-only', 'JavaScript syntax check failed.');
        }
        checked += 1;
      } else if (file.path.endsWith('.json')) {
        JSON.parse(file.content); checked += 1;
      } else if (file.path.endsWith('.html')) {
        if (!/<html(?:\s|>)/i.test(file.content) || !/<\/html\s*>/i.test(file.content))
          return finish(false, 0, 'static-only', 'HTML document must contain opening and closing html elements.');
        checked += 1;
      }
    }
    append('Static checks only: ' + checked + ' JavaScript syntax, JSON, or HTML document-structure checks. No application behavior, dependencies, browser rendering, or production readiness was verified.\n');
    return finish(checked > 0, 0, 'static-only', checked ? '' : 'No supported static-check files.');
  }
  const tests = input.files.map(file => file.path).filter(file =>
    /(?:^|\/)(?:test|tests)\/.*\.(?:mjs|cjs|js)$/.test(file) ||
    /(?:^|\/)(?:test(?:[-_.].+)?|.+\.(?:test|spec))\.(?:mjs|cjs|js)$/.test(file));
  if (!tests.length) return finish(false, 0, 'tests', 'No Node test files found. Use *.test.mjs, *.test.js, or test/ files.');
  // Spawn a fresh CLI rather than programmatic run() from an eval entrypoint:
  // Node can otherwise inherit the parent eval script and recursively run it.
  const reporter = "export default async function* (source) { for await (const event of source) { if (['test:summary','test:pass','test:fail','test:stdout','test:stderr'].includes(event.type)) yield JSON.stringify({type:event.type,data:event.data})+'\\n'; } }";
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1',
    '--test-reporter=data:text/javascript,' + encodeURIComponent(reporter),
    ...tests.map(file => path.join('/work', file))],
    { encoding: 'utf8', timeout: 110000, maxBuffer: LIMIT });
  let testCount = 0, failed = !!result.error || result.status !== 0;
  for (const line of (result.stdout || '').split('\n').filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); } catch { failed = true; continue; }
    if (event.type === 'test:stdout' || event.type === 'test:stderr') append(event.data.message);
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      append((event.type === 'test:pass' ? 'PASS ' : 'FAIL ') + event.data.name + '\n');
      if (event.type === 'test:fail') failed = true;
    }
    if (event.type === 'test:summary' && event.data.file) {
      const count = event.data.counts;
      testCount += Math.max(0, count.tests - count.skipped - count.todo);
      if (!event.data.success || count.failed || count.cancelled) failed = true;
    }
  }
  if (result.error || result.stderr) append(result.stderr || message(result.error));
  append('Executed ' + testCount + ' non-skipped Node tests.\n');
  finish(!failed && testCount > 0, testCount, 'tests', testCount ? '' : 'Zero executable tests; empty/skipped test files are not successful verification.');
})().catch(error => finish(false, 0, 'tests', message(error)));
`;
