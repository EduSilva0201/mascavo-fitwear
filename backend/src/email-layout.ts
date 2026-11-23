const logo = 'https://mascavofit.com.br/assets/brand/mascavo-logo.png';
const entities: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
const escape = (value: string) => value.replace(/[&<>"']/g, character => entities[character]);

type EmailContent = {
  title: string;
  paragraphs: string[];
  action: { url: string; label: string };
  footer?: string[];
};

export function emailLayout({ title, paragraphs, action, footer = [] }: EmailContent) {
  const paragraph = (value: string) => `<p style="margin:0 0 16px">${escape(value).replace(/\n/g, '<br>')}</p>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;background:#f5ede3;color:#38271d;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5ede3">
      <tr><td align="center" style="padding:28px 14px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;background:#fffaf4;border:1px solid #ddc7b2">
          <tr><td align="center" style="padding:26px 24px 20px;border-bottom:1px solid #ddc7b2">
            <img src="${logo}" width="180" alt="Mascavo Fitwear" style="display:block;width:180px;max-width:100%;height:auto;margin:0 auto">
          </td></tr>
          <tr><td style="padding:28px 24px;font-size:16px;line-height:1.6;overflow-wrap:anywhere">
            <h1 style="font-family:Georgia,serif;font-size:26px;line-height:1.2;margin:0 0 18px">${escape(title)}</h1>
            ${paragraphs.map(paragraph).join('')}
            <p style="margin:22px 0"><a href="${escape(action.url)}" style="display:inline-block;padding:12px 18px;background:#563823;color:#fffaf4;border-radius:5px;text-decoration:none;font-weight:bold">${escape(action.label)}</a></p>
            ${footer.map(paragraph).join('')}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}
