# Limites deste marco local

Este backend ainda não está habilitado para ambientes remotos. Antes de homologação/produção:

- Separar bindings, bancos, buckets, origens e segredos por ambiente; remover o adaptador `dev_mail` do ambiente remoto e conectar um provedor de e-mail.
- Validar CPU, memória, concorrência e custo do Argon2id no plano Workers escolhido. A biblioteca usa JavaScript e o teste local não demonstra capacidade/custo remoto. Não reduzir parâmetros de segurança para se adequar ao plano.
- Configurar HTTPS, cookies Secure, CSP compatível com os estilos e banners atuais, proteção contra abuso na borda e recuperação de backups.
- Implementar limpeza periódica de sessões, tokens e metadados expirados, política de retenção e auditoria administrativa. Hoje o limite de tentativas limpa buckets vencidos e a caixa local só exibe mensagens das últimas 24 horas; não há retenção automatizada das demais tabelas.
- Verificar expiração absoluta, concorrência de reset/login, sessão em HTTPS, acessibilidade e serviços externos em homologação.
- Exigir confirmação de e-mail e sessão válida para checkout, autorização por proprietário e proteção CSRF em toda futura operação de escrita.
- Nunca aceitar preço, desconto, frete ou estoque do navegador como fonte de verdade. O endpoint atual de pedidos não realiza operações.

Limites de tentativa locais: 60 operações por IP e dez por conta em 15 minutos; verificação e reset também têm limites compartilhados por operação. Todas as chamadas locais compartilham o bucket de IP. Não há bloqueio permanente de conta. Proteção distribuída e ajuste desses limites serão necessários antes de uso público.

Não há credenciais de Mercado Pago, Melhor Envio ou Cloudflare no código. Não inserir dados reais no banco local, nos testes ou na caixa simulada. `.dev.vars`, estado do Wrangler e screenshots são ignorados pelo Git.
