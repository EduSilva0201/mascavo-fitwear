import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import reporter from '../support/report.mjs';
test('reports: pending and skipped never count as passed; errors are escaped and redacted', async (t) => {
  const folder = resolve('.wrangler/tests/report-fixture', crypto.randomUUID());
  await mkdir(folder, { recursive: true });
  const oldDir = process.env.TEST_REPORT_DIR,
    oldSuite = process.env.TEST_SUITE;
  process.env.TEST_REPORT_DIR = folder;
  process.env.TEST_SUITE = 'fixture';
  t.after(() => {
    if (oldDir === undefined) delete process.env.TEST_REPORT_DIR;
    else process.env.TEST_REPORT_DIR = oldDir;
    if (oldSuite === undefined) delete process.env.TEST_SUITE;
    else process.env.TEST_SUITE = oldSuite;
  });
  async function* events() {
    yield {
      type: 'test:pass',
      data: { name: 'approved', file: 'fixture.mjs', line: 1, details: { duration_ms: 1 } },
    };
    yield {
      type: 'test:pass',
      data: { name: 'not built', todo: true, details: { duration_ms: 0 } },
    };
    yield { type: 'test:pass', data: { name: 'not run', skip: true, details: { duration_ms: 0 } } };
    yield {
      type: 'test:fail',
      data: {
        name: '<script>alert(1)</script>',
        details: { duration_ms: 2, error: { stack: 'failure Bearer fake-token' } },
      },
    };
  }
  let terminal = '';
  for await (const chunk of reporter(events())) terminal += chunk;
  const json = JSON.parse(await readFile(resolve(folder, 'results.json'), 'utf8'));
  assert.deepEqual([json.passed, json.failed, json.pending, json.skipped], [1, 1, 1, 1]);
  assert.match(terminal, /TOTAL 4/);
  assert.equal(terminal.includes('fake-token'), false);
  const html = await readFile(resolve(folder, 'index.html'), 'utf8');
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&lt;script&gt;/);
  const xml = await readFile(resolve(folder, 'junit.xml'), 'utf8');
  assert.match(xml, /failures="1" skipped="2"/);
});
