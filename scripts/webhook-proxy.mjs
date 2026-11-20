import { createServer } from 'node:http';
import { callback, callbackPath, page, testPath } from './melhorenvio-oauth.mjs';

// Publish only this receiver. Never forward cookies, Host or browser sessions.
const paths = ['/api/v1/webhooks/asaas', '/api/v1/webhooks/melhorenvio'];
createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const url = new URL(req.url, 'http://127.0.0.1:8788');
  if (req.method === 'GET' && (url.pathname === testPath || url.pathname === callbackPath)) {
    try {
      const [status, html] = url.pathname === callbackPath ? await callback(url) : [200, page('Integração Melhor Envio', 'Ambiente de testes da Mascavo Fitwear para integração com o Melhor Envio Sandbox. A loja possui cotação e seleção de fretes no checkout local. Esta página é o ponto público de apresentação da integração; a autorização é iniciada localmente após o cadastro do aplicativo. Não realiza envios reais nem emite etiquetas.')];
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    } catch {
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' }).end(page('Configuração pendente', 'As credenciais do aplicativo ainda precisam ser configuradas no computador responsável pela integração.'));
    }
    req.resume();
    return;
  }
  if (!paths.includes(req.url) || req.method !== 'POST') {
    res.writeHead(404).end();
    req.resume();
    return;
  }
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(chunk);
    }
    const upstream = await fetch(`http://127.0.0.1:8787${req.url}`, {
      method: 'POST',
      headers: {
        'content-type': req.headers['content-type'] || '',
        'asaas-access-token': req.headers['asaas-access-token'] || '',
        'x-me-signature': req.headers['x-me-signature'] || '',
      },
      body: Buffer.concat(chunks),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    res.writeHead(upstream.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(await upstream.text());
  } catch {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  }
}).listen(8788, '127.0.0.1', () => console.log('Webhook proxy: http://127.0.0.1:8788/api/v1/webhooks/asaas'));
