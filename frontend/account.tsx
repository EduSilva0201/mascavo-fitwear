import { createRoot } from 'react-dom/client';
import { SignIn2 } from '../components/ui/clean-minimal-sign-in';

const dialog = document.querySelector<HTMLDialogElement>('#account-dialog');
if (dialog) {
  const content = [...dialog.children].filter((node): node is HTMLElement =>
    node instanceof HTMLElement && !node.matches('.close, .legacy-account-heading'),
  );
  dialog.querySelectorAll('.legacy-account-heading').forEach(node => node.remove());
  const root = document.createElement('div');
  dialog.append(root);
  createRoot(root).render(<SignIn2 content={content} />);
}
