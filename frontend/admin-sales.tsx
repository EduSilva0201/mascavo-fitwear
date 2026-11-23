import { createRoot } from 'react-dom/client';
import GlassyDashboard, { type SalesReport } from '../components/ui/glassy-dashboard';

export function mountSalesDashboard(host: HTMLElement, loadReport: (days: number) => Promise<SalesReport>) {
  const root = createRoot(host);
  root.render(<GlassyDashboard loadReport={loadReport} />);
  return () => root.unmount();
}
