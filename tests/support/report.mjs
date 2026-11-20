import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
function safe(value) {
  return String(value ?? '')
    .replace(/\$aact_[\w$.-]+/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED]');
}
export default async function* report(source) {
  const rows = [];
  let coverage = null;
  const started = Date.now();
  for await (const { type, data } of source) {
    if (type === 'test:pass' || type === 'test:fail') {
      if (data.details?.type === 'suite') continue;
      rows.push({
        name: safe(data.name),
        status: data.todo
          ? 'pending'
          : data.skip
            ? 'skipped'
            : type === 'test:pass'
              ? 'passed'
              : 'failed',
        durationMs: data.details?.duration_ms ?? 0,
        file: safe(data.file),
        line: data.line ?? null,
        error:
          type === 'test:fail' && !data.todo
            ? safe(data.details?.error?.stack || data.details?.error?.message || 'Test failed')
            : null,
      });
      const row = rows.at(-1);
      yield `[${row.status.toUpperCase()}] ${row.name} (${row.durationMs.toFixed(1)} ms)\n`;
      if (row.error) yield row.error + '\n';
    }
    if (type === 'test:stderr') yield safe(data.message) + '\n';
    if (type === 'test:coverage') coverage = data.summary;
  }
  const counts = { passed: 0, failed: 0, skipped: 0, pending: 0 };
  for (const row of rows) counts[row.status]++;
  const result = {
    suite: process.env.TEST_SUITE,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    total: rows.length,
    ...counts,
    coverage,
    tests: rows,
  };
  await writeFile(
    resolve(process.env.TEST_REPORT_DIR, 'results.json'),
    JSON.stringify(result, null, 2),
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?><testsuites><testsuite name="${esc(result.suite)}" tests="${rows.length}" failures="${counts.failed}" skipped="${counts.skipped + counts.pending}" time="${result.durationMs / 1000}">${rows.map((r) => `<testcase name="${esc(r.name)}" file="${esc(r.file)}" time="${r.durationMs / 1000}">${r.error ? '<failure message="' + esc(r.error) + '">' + esc(r.error) + '</failure>' : r.status === 'pending' || r.status === 'skipped' ? '<skipped message="' + r.status + '"/>' : ''}</testcase>`).join('')}</testsuite></testsuites>`;
  await writeFile(resolve(process.env.TEST_REPORT_DIR, 'junit.xml'), xml);
  if (coverage) {
    const lcov = coverage.files
      .map((f) =>
        [
          'TN:',
          `SF:${f.path}`,
          ...f.functions.flatMap((v, i) => [
            `FN:${v.line},${v.name || 'anonymous-' + i}`,
            `FNDA:${v.count},${v.name || 'anonymous-' + i}`,
          ]),
          `FNF:${f.totalFunctionCount}`,
          `FNH:${f.coveredFunctionCount}`,
          ...f.lines.map((v) => `DA:${v.line},${v.count}`),
          `LF:${f.totalLineCount}`,
          `LH:${f.coveredLineCount}`,
          ...f.branches.map((v, i) => `BRDA:${v.line},0,${i},${v.count}`),
          `BRF:${f.totalBranchCount}`,
          `BRH:${f.coveredBranchCount}`,
          'end_of_record',
        ].join('\n'),
      )
      .join('\n');
    await writeFile(resolve(process.env.TEST_REPORT_DIR, 'lcov.info'), lcov + '\n');
    for (const f of coverage.files)
      yield `COVERAGE ${f.path}: lines ${f.coveredLinePercent.toFixed(2)}%, branches ${f.coveredBranchPercent.toFixed(2)}%, functions ${f.coveredFunctionPercent.toFixed(2)}%\n`;
  }
  const coverageNote = coverage
    ? '<h2>Cobertura Node</h2><p>Somente providers.ts e checkout.ts. Não mede o Worker executado pelo workerd, navegador ou integrações reais.</p><pre>' +
      esc(JSON.stringify(coverage, null, 2)) +
      '</pre>'
    : '<p>Esta execução não mede cobertura de código.</p>';
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mascavo · Testes</title><style>body{font:14px Arial;background:#faf4ed;color:#39271b;margin:0;padding:35px;line-height:1.6}main{max-width:1200px;margin:auto}h1{font:38px Georgia}small{color:#826d5c}section{display:flex;gap:15px;flex-wrap:wrap;margin:25px 0}article{background:#fffdf9;border:1px solid #d9c9b7;border-radius:16px;padding:18px;min-width:100px}article strong{font-size:30px;display:block}table{width:100%;border-collapse:collapse;background:#fffdf9}td,th{padding:13px;text-align:left;border-bottom:1px solid #e4d9cd;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;max-height:450px;overflow:auto}.failed{color:#9b3c28}.passed{color:#516c42}.pending,.skipped{color:#94702f}code{font-size:11px;overflow-wrap:anywhere}input{padding:12px;border:1px solid #d9c9b7;border-radius:10px;margin-bottom:20px;width:min(90%,400px)}</style><main><small>MASCAVO / QUALIDADE</small><h1>Relatório de testes · ${esc(result.suite)}</h1><p>${esc(result.generatedAt)} · ${(result.durationMs / 1000).toFixed(2)} s</p><section>${Object.entries(
    counts,
  )
    .map(
      ([key, n]) =>
        `<article class="${key}">${esc({ passed: 'Aprovados', failed: 'Falhas', pending: 'Pendentes', skipped: 'Ignorados' }[key])}<strong>${n}</strong></article>`,
    )
    .join(
      '',
    )}</section><p><b>Pendentes e ignorados não são aprovados.</b> Mocks validam o código contra respostas simuladas; não comprovam o funcionamento das APIs reais.</p><input id="filter" placeholder="Filtrar cenários" aria-label="Filtrar cenários"><table><thead><tr><th>Cenário</th><th>Resultado</th><th>Tempo</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}<br><code>${esc(r.file)}${r.line ? ':' + r.line : ''}</code>${r.error ? '<pre>' + esc(r.error) + '</pre>' : ''}</td><td class="${r.status}">${esc(r.status)}</td><td>${r.durationMs.toFixed(1)} ms</td></tr>`).join('')}</tbody></table>${coverageNote}<script>document.querySelector('#filter').oninput=e=>document.querySelectorAll('tbody tr').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(e.target.value.toLowerCase()))</script></main></html>`;
  await writeFile(resolve(process.env.TEST_REPORT_DIR, 'index.html'), html);
  yield `TOTAL ${result.total} | PASS ${counts.passed} | FAIL ${counts.failed} | SKIP ${counts.skipped} | PENDING ${counts.pending} | ${(result.durationMs / 1000).toFixed(2)}s\n`;
}
