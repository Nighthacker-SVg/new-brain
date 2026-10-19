export default String.raw`
import ast, io, json, os, sys, traceback, unittest

LIMIT = 48 * 1024
original_stdout = sys.stdout
class BoundedOutput(io.TextIOBase):
    def __init__(self):
        self.parts = []
        self.length = 0
        self.overflow = False
    def write(self, value):
        text = str(value)
        size = len(text.encode('utf-8'))
        if self.length + size > LIMIT:
            self.overflow = True
            raise RuntimeError('Test output exceeded the limit.')
        self.parts.append(text)
        self.length += size
        return len(text)
    def flush(self):
        pass
    def getvalue(self):
        return ''.join(self.parts)

output = BoundedOutput()
def finish(ok, count, verification, stderr=''):
    report = {'ok': bool(ok and not output.overflow), 'testCount': count,
        'verification': verification, 'stdout': output.getvalue(),
        'stderr': 'Test output exceeded the limit.' if output.overflow else stderr}
    original_stdout.write(json.dumps(report))
    original_stdout.flush()
    raise SystemExit(0 if report['ok'] else 1)

try:
    payload = json.loads(sys.stdin.read())
    for item in payload['files']:
        destination = os.path.join('/work', item['path'])
        os.makedirs(os.path.dirname(destination), mode=0o700, exist_ok=True)
        with open(destination, 'x', encoding='utf-8') as handle:
            os.chmod(destination, 0o600)
            handle.write(item['content'])
    if payload['testCommand'] == 'static-check':
        checked = 0
        for item in payload['files']:
            if item['path'].endswith('.py'):
                ast.parse(item['content'], filename=item['path'])
                checked += 1
            elif item['path'].endswith('.json'):
                json.loads(item['content'])
                checked += 1
            elif item['path'].endswith('.html'):
                import re
                if not re.search(r'<html(?:\s|>)', item['content'], re.I) or not re.search(r'</html\s*>', item['content'], re.I):
                    raise ValueError('HTML document requires opening and closing html elements.')
                checked += 1
        output.write('Static checks only: %d Python syntax, JSON, or HTML document-structure checks. No application behavior, dependencies, browser rendering, or production readiness was verified.\n' % checked)
        finish(checked > 0, 0, 'static-only', '' if checked else 'No supported static-check files.')
    sys.path.insert(0, '/work')
    sys.stdout = output
    sys.stderr = output
    suite = unittest.defaultTestLoader.discover('/work', pattern='test*.py', top_level_dir='/work')
    result = unittest.TextTestRunner(stream=output, verbosity=2).run(suite)
    count = max(0, result.testsRun - len(result.skipped))
    finish(result.wasSuccessful() and count > 0, count, 'tests',
        '' if count else 'Zero executable tests; empty/skipped tests are not successful verification.')
except SystemExit:
    raise
except BaseException as error:
    finish(False, 0, 'tests', ''.join(traceback.format_exception_only(type(error), error)))
`;
