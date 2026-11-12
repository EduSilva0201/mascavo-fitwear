const origin = 'http://127.0.0.1:8787';
const response = await fetch(origin + '/api/v1/auth/csrf');
if (!response.ok) throw new Error('Inicie npm run dev.');
const { csrfToken } = await response.json();
const cookie = response.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
const mail = await fetch(origin + '/api/v1/dev/mail', {
  headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrfToken },
});
if (!mail.ok) throw new Error('Caixa de testes indisponível.');
console.log(JSON.stringify(await mail.json(), null, 2));
