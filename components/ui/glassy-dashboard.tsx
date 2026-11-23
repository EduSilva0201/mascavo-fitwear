import { useEffect, useState } from 'react';

type SalesRow = { day: string; method: string; state: string; orders: number; amountCents: number };
export type SalesReport = {
  dates: string[];
  sales: SalesRow[];
  products: { id: number; name: string; units: number }[];
};
type LoadReport = (days: number) => Promise<SalesReport>;

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = new Intl.NumberFormat('pt-BR');
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const methods: Record<string, string> = { PIX: 'Pix', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão de crédito' };
const dateLabel = (day: string) => shortDate.format(new Date(day + 'T00:00:00Z'));
const money = (cents: number) => currency.format(cents / 100);
const totals = (orders = 0, paid = 0, paidCents = 0) => ({ orders, paid, paidCents });

function summarize(report: SalesReport) {
  const daily = new Map(report.dates.map(day => [day, totals()]));
  const byMethod = new Map<string, number>();
  const summary = totals();
  for (const row of report.sales) {
    const day = daily.get(row.day);
    if (!day) continue;
    day.orders += row.orders;
    summary.orders += row.orders;
    if (row.state !== 'paid') continue;
    day.paid += row.orders;
    day.paidCents += row.amountCents;
    summary.paid += row.orders;
    summary.paidCents += row.amountCents;
    byMethod.set(row.method, (byMethod.get(row.method) ?? 0) + row.amountCents);
  }
  return {
    daily: [...daily].map(([day, value]) => ({ day, ...value })),
    summary,
    byMethod: [...byMethod].sort((a, b) => b[1] - a[1]),
  };
}

function exportCsv(daily: ReturnType<typeof summarize>['daily']) {
  const rows = daily.map(({ day, orders, paid, paidCents }) =>
    [day, orders, paid, (paidCents / 100).toFixed(2).replace('.', ',')].join(';'),
  );
  const csv = ['Data;Pedidos criados;Pedidos pagos;Valor confirmado (BRL)', ...rows].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mascavo-vendas-' + daily[0].day + '-a-' + daily.at(-1)!.day + '.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function GlassyDashboard({ loadReport }: { loadReport: LoadReport }) {
  const [days, setDays] = useState(30);
  const [attempt, setAttempt] = useState(0);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    loadReport(days).then(
      result => { if (active) setReport(result); },
      reason => { if (active) setError(reason instanceof Error ? reason.message : 'Falha ao carregar o relatório.'); },
    );
    return () => { active = false; };
  }, [days, attempt, loadReport]);

  const data = report && summarize(report);
  const daily = data?.daily ?? [];
  const peak = Math.max(1, ...daily.map(day => day.paidCents));
  return (
    <section className="sales-dashboard" aria-labelledby="sales-title">
      <header className="sales-heading">
        <div>
          <h1 id="sales-title">Relatório de vendas</h1>
          <p>Pedidos agrupados pela data em que foram criados, no horário de Brasília.</p>
        </div>
        <div className="sales-controls">
          <label>Período
            <select value={days} onChange={event => {
              setDays(Number(event.target.value));
              setReport(null);
              setError('');
            }}>
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
            </select>
          </label>
          <button className="primary" type="button" disabled={!data} onClick={() => exportCsv(daily)}>Exportar CSV</button>
        </div>
      </header>
      {error && <div className="sales-card sales-error" role="alert">
        <p>{error}</p>
        <button className="secondary" type="button" onClick={() => {
          setError('');
          setAttempt(value => value + 1);
        }}>Tentar novamente</button>
      </div>}
      {!data && !error && <p className="sales-card" role="status">Carregando relatório…</p>}
      {data && report && <>
        <dl className="sales-kpis">
          <div className="sales-card sales-revenue"><dt>Valor confirmado</dt><dd>{money(data.summary.paidCents)}</dd></div>
          <div className="sales-card"><dt>Pedidos criados</dt><dd>{integer.format(data.summary.orders)}</dd></div>
          <div className="sales-card"><dt>Pedidos pagos</dt><dd>{integer.format(data.summary.paid)}</dd></div>
          <div className="sales-card"><dt>Ticket médio dos pagos</dt><dd>{data.summary.paid ? money(data.summary.paidCents / data.summary.paid) : '—'}</dd></div>
        </dl>
        {data.summary.orders === 0 ? <p className="sales-card">Nenhum pedido foi criado neste período.</p> : <>
          <div className="sales-grid">
            <section className="sales-card">
              <h2>Vendas por dia</h2>
              <p>Valor dos pedidos atualmente pagos. Inclui o frete quando cobrado no pedido.</p>
              {data.summary.paid > 0 && <div className="sales-chart" aria-hidden="true">
                <div className="sales-bars">
                  {daily.map(day => <div key={day.day} title={dateLabel(day.day) + ' · ' + money(day.paidCents)}
                    style={{ height: day.paidCents ? Math.max(2, (day.paidCents / peak) * 100) + '%' : '1px' }} />)}
                </div>
                <div className="sales-axis"><span>{dateLabel(daily[0].day)}</span><span>{dateLabel(daily.at(-1)!.day)}</span></div>
              </div>}
              {!data.summary.paid && <p className="sales-empty">Nenhum pagamento confirmado neste período.</p>}
              <details>
                <summary>Ver dados por dia</summary>
                <div className="sales-table"><table>
                  <thead><tr><th scope="col">Data</th><th scope="col">Pedidos</th><th scope="col">Pagos</th><th scope="col">Valor confirmado</th></tr></thead>
                  <tbody>{daily.map(day => <tr key={day.day}>
                    <th scope="row">{dateLabel(day.day)}</th><td>{day.orders}</td><td>{day.paid}</td><td>{money(day.paidCents)}</td>
                  </tr>)}</tbody>
                </table></div>
              </details>
            </section>
            <section className="sales-card">
              <h2>Formas de pagamento</h2>
              {data.byMethod.length ? <dl className="sales-list">
                {data.byMethod.map(([method, value]) => <div key={method}>
                  <dt>{methods[method] ?? method}</dt><dd>{money(value)}</dd>
                </div>)}
              </dl> : <p className="sales-empty">Os valores aparecem após a confirmação dos pagamentos.</p>}
            </section>
          </div>
          <section className="sales-card">
            <h2>Produtos mais vendidos</h2>
            <p>Até cinco produtos, por unidades em pedidos pagos.</p>
            {report.products.length ? <ol className="sales-list sales-products">
              {report.products.map(product => <li key={product.id}>
                <span>{product.name}</span><strong>{integer.format(product.units)} {product.units === 1 ? 'unidade' : 'unidades'}</strong>
              </li>)}
            </ol> : <p className="sales-empty">Nenhuma unidade em pedidos pagos neste período.</p>}
          </section>
        </>}
      </>}
    </section>
  );
}

export default GlassyDashboard;
