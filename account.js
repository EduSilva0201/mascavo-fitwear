(() => {
  const dialog = document.querySelector('#account-dialog');
  const form = document.querySelector('#account-form');
  const fields = document.querySelector('#account-fields');
  const submit = document.querySelector('#account-submit');
  const note = dialog.querySelector('.demo-note');
  const feedback = document.createElement('p');
  feedback.className = 'form-feedback account-feedback';
  feedback.id = 'account-feedback';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-atomic', 'true');
  feedback.hidden = true;
  submit.before(feedback);
  function toast(message, kind = 'error') {
    feedback.textContent = message || 'Operação concluída.';
    feedback.dataset.kind = kind;
    feedback.hidden = false;
    feedback.scrollIntoView({ block: 'nearest' });
  }
  let tab = 'login',
    customer = null,
    csrfToken = '',
    busy = false;
  const labels = {
    login: 'Entrar',
    register: 'Criar conta',
    forgot: 'Recuperar senha',
    reset: 'Salvar nova senha',
    verify: 'Confirmar e-mail',
  };

  async function readAccountResponse(response) {
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.toLowerCase().startsWith('application/json')) {
      const result = await response.json().catch(() => null);
      if (result && typeof result === 'object') return result;
    }
    if (response.status === 401 || response.status === 403 || response.redirected) {
      throw new Error('Recarregue a loja para renovar o acesso e tente novamente.');
    }
    throw new Error('O serviço de conta está indisponível no momento. Tente novamente.');
  }
  async function csrf() {
    const response = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
    const result = await readAccountResponse(response);
    if (!response.ok || !result.csrfToken) throw new Error(result.error || 'Não foi possível acessar a conta.');
    csrfToken = result.csrfToken;
  }
  async function request(path, data) {
    if (!csrfToken) await csrf();
    const response = await fetch('/api/v1/auth/' + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(data),
    });
    if (response.status === 403) csrfToken = '';
    const result = await readAccountResponse(response);
    if (result.csrfToken) csrfToken = result.csrfToken;
    if (!response.ok) {
      throw new Error(result.error || 'Não foi possível concluir a operação.');
    }
    return result;
  }
  async function refresh() {
    const response = await fetch('/api/v1/auth/session', { credentials: 'same-origin' });
    const result = await readAccountResponse(response);
    if (!response.ok) throw new Error(result.error || 'Não foi possível acessar a conta.');
    customer = result.customer;
    document.querySelector('#account-toggle').title = customer
      ? 'Minha conta: ' + customer.name
      : 'Minha conta';
    document.querySelector('#mobile-account').textContent = customer
      ? 'Minha conta'
      : 'Entrar / Criar conta';
  }
  function input(label, name, type = 'text', autocomplete = '') {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const el = document.createElement('input');
    el.name = name;
    el.type = type;
    el.required = true;
    if (autocomplete) el.autocomplete = autocomplete;
    if (type === 'password') {
      el.minLength = tab === 'login' ? 1 : 12;
      el.maxLength = 128;
    }
    if (name === 'name') {
      el.minLength = 3;
      el.maxLength = 100;
    }
    if (name === 'email') el.maxLength = 254;
    if (name === 'cpf') {
      el.inputMode = 'numeric';
      el.maxLength = 14;
    }
    if (type === 'tel') el.maxLength = 24;
    if (name === 'token') {
      el.pattern = '[a-f0-9]{64}';
      el.maxLength = 64;
      el.autocomplete = 'off';
      el.minLength = 64;
      el.spellcheck = false;
      el.addEventListener('input', () => el.setCustomValidity(''));
      el.addEventListener('invalid', () => el.setCustomValidity('Cole o código completo de 64 caracteres, sem espaços.'));
    }
    wrapper.append(el);
    wrapper.className = 'auth-field';
    const icon = document.createElement('span');
    icon.className = 'auth-field-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' + (type === 'email' ? '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/>' : type === 'password' ? '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>' : '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>') + '</svg>';
    wrapper.append(icon);
    if (type === 'password') {
      const toggle = document.createElement('button');
      toggle.type = 'button'; toggle.className = 'password-toggle'; toggle.textContent = 'Mostrar';
      toggle.setAttribute('aria-label', 'Mostrar ' + label.toLowerCase());
      toggle.setAttribute('aria-pressed', 'false');
      toggle.onclick = () => {
        const visible = el.type === 'password'; el.type = visible ? 'text' : 'password';
        toggle.textContent = visible ? 'Ocultar' : 'Mostrar';
        toggle.setAttribute('aria-label', (visible ? 'Ocultar ' : 'Mostrar ') + label.toLowerCase());
        toggle.setAttribute('aria-pressed', String(visible));
      };
      wrapper.append(toggle);
    }
    fields.append(wrapper);
  }

  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function profileField(host, label, name, value, options = {}) {
    const wrapper = element('label', label);
    const field = document.createElement(options.states ? 'select' : 'input');
    field.name = name;
    if (options.states) {
      for (const uf of ['', 'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']) {
        const option = element('option', uf || 'Selecione'); option.value = uf; field.append(option);
      }
    } else { field.type = options.type || 'text'; field.maxLength = options.max || 100; }
    field.value = value || '';
    field.required = !!options.required;
    if (options.autocomplete) field.autocomplete = options.autocomplete;
    if (options.inputMode) field.inputMode = options.inputMode;
    wrapper.append(field); host.append(wrapper);
  }
  async function loadProfile(root) {
    root.textContent = 'Carregando seus dados...';
    try {
      const response = await fetch('/api/v1/auth/profile', {credentials:'same-origin'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar seus dados.');
      if (!root.isConnected) return;
      root.replaceChildren();
      const personal = element('details'); personal.open = true;
      personal.append(element('summary', 'Meus dados'));
      const personalForm = element('form', '', 'profile-form');
      profileField(personalForm, 'Nome completo', 'name', data.profile.name, {required:true, autocomplete:'name'});
      const email = element('p', data.profile.email, 'profile-email'); personalForm.append(email);
      profileField(personalForm, 'CPF', 'cpf', data.profile.cpf, {max:14,inputMode:'numeric',required:true});
      profileField(personalForm, 'Telefone com DDD', 'phone', data.profile.phone, {type:'tel',autocomplete:'tel',max:24,required:true});
      const save = element('button','Salvar meus dados','primary'); save.type='submit'; personalForm.append(save);
      personal.append(personalForm); root.append(personal);
      personalForm.onsubmit = async event => {
        event.preventDefault(); if (busy) return; busy=true; save.disabled=true;
        try { const result = await request('profile',Object.fromEntries(new FormData(personalForm))); await refresh(); toast(result.message,'success'); }
        catch(error) { toast(error.message); } finally { busy=false; save.disabled=false; }
      };
      const addresses = element('details'); addresses.open=true; addresses.append(element('summary','Endereços'));
      const list = element('div','','address-list'); addresses.append(list); root.append(addresses);
      if (!data.addresses.length) list.append(element('p','Você ainda não adicionou um endereço.'));
      const editor = element('div'); addresses.append(editor);
      function editAddress(address = {}) {
        editor.replaceChildren();
        const f = element('form','','profile-form address-form');
        f.append(element('h3',address.id ? 'Editar endereço' : 'Novo endereço'));
        for (const [name,label,max,autocomplete] of [
          ['label','Identificação (ex.: Casa)',40,''],['recipient','Destinatário',100,'shipping name'],
          ['cep','CEP',9,'shipping postal-code'],['street','Rua / Avenida',150,'shipping address-line1'],
          ['number','Número (ou S/N)',20,''],['complement','Complemento (opcional)',100,'shipping address-line2'],
          ['neighborhood','Bairro',100,''],['city','Cidade',100,'shipping address-level2'],
        ]) profileField(f,label,name,address[name],{max,autocomplete,required:name!=='complement',inputMode:name==='cep'?'numeric':undefined});
        profileField(f,'Estado','state',address.state,{states:true,required:true,autocomplete:'shipping address-level1'});
        const submitAddress=element('button','Salvar endereço','primary');submitAddress.type='submit';
        const cancel=element('button','Cancelar','account-link');cancel.type='button';cancel.onclick=()=>editor.replaceChildren();f.append(submitAddress,cancel);editor.append(f);
        f.onsubmit=async event=>{
          event.preventDefault();if(busy)return;busy=true;submitAddress.disabled=true;
          try{const body=Object.fromEntries(new FormData(f));if(address.id)body.id=address.id;const result=await request('profile/addresses',body);await loadProfile(root);toast(result.message,'success');}
          catch(error){toast(error.message);}finally{busy=false;submitAddress.disabled=false;}
        };
        f.querySelector('input').focus({preventScroll:true});
      }
      for (const address of data.addresses) {
        const card=element('article','','address-card');card.append(element('h3',address.label),element('p',address.recipient),element('p',address.street+', '+address.number+(address.complement?' / '+address.complement:'')),element('p',address.neighborhood+' - '+address.city+'/'+address.state),element('p','CEP '+address.cep));
        const edit=element('button','Editar','account-link');edit.type='button';edit.onclick=()=>{if(!busy)editAddress(address);};
        const remove=element('button','Remover','account-link');remove.type='button';remove.onclick=()=>{
          if(busy)return;
          const confirm=element('button','Confirmar remoção','account-link');confirm.type='button';const cancel=element('button','Cancelar','account-link');cancel.type='button';
          remove.hidden=true;card.append(confirm,cancel);cancel.onclick=()=>{confirm.remove();cancel.remove();remove.hidden=false;};
          confirm.onclick=async()=>{if(busy)return;busy=true;confirm.disabled=true;try{const result=await request('profile/addresses/'+encodeURIComponent(address.id)+'/delete',{});await loadProfile(root);toast(result.message,'success');}catch(error){toast(error.message);}finally{busy=false;confirm.disabled=false;}};
        };card.append(edit,remove);list.append(card);
      }
      const add=element('button','Adicionar endereço','account-link');add.type='button';add.onclick=()=>{if(!busy)editAddress();};addresses.append(add);
    } catch(error) { root.replaceChildren(element('p',error.message)); const retry=element('button','Tentar novamente','account-link');retry.type='button';retry.onclick=()=>loadProfile(root);root.append(retry); }
  }

  function render() {
    feedback.hidden = true;
    feedback.textContent = "";
    fields.replaceChildren();
    const showProfile = Boolean(customer) && !['verify', 'reset'].includes(tab);
    form.hidden = showProfile;
    if (showProfile) form.before(feedback);
    else submit.before(feedback);
    dialog.querySelector('.account-tabs').hidden = !!customer;
    document.querySelector('#account-extra')?.remove();
    const extra = document.createElement('div');
    extra.id = 'account-extra';
    (dialog.querySelector('.account-content') || dialog).append(extra);
    dialog.dataset.view = showProfile ? 'profile' : tab;
    const title = dialog.querySelector('#account-title');
    if (title) title.textContent = showProfile ? 'Minha conta.' : ({ login: 'Bom ter você aqui.', register: 'Seu próximo movimento.', forgot: 'Vamos recuperar seu acesso.', reset: 'Um novo começo.', verify: 'Falta só confirmar.' }[tab]);
    if (showProfile) {
      const text = document.createElement('p');
      text.textContent =
        'Olá, ' +
        customer.name +
        '. ' +
        (customer.emailVerified ? 'E-mail confirmado.' : 'Seu e-mail ainda aguarda confirmação.');
      extra.append(text);
      if (!customer.emailVerified) {
        const verification = element('form', '', 'profile-form profile-panel');
        profileField(verification, 'Código de confirmação recebido por e-mail', 'token', '', {
          required: true, max: 64, autocomplete: 'off',
        });
        const code = verification.elements.namedItem('token');
        code.pattern = '[a-f0-9]{64}';
        code.spellcheck = false;
        const verify = element('button', 'Confirmar meu e-mail', 'primary');
        verify.type = 'submit';
        verification.append(verify);
        verification.onsubmit = async event => {
          event.preventDefault();
          if (busy) return;
          busy = true;
          verify.disabled = true;
          try {
            const result = await request('verify-email', { token: code.value.trim() });
            await refresh();
            render();
            toast(result.message, 'success');
          } catch (error) {
            toast(error.message);
          } finally {
            busy = false;
            verify.disabled = false;
          }
        };
        extra.append(verification);
      }
      const logout = document.createElement('button');
      logout.className = 'primary';
      logout.textContent = 'Sair da conta';
      logout.onclick = async () => {
        if (busy) return;
        busy = true;
        logout.disabled = true;
        try {
          await request('logout', {});
          customer = null;
          await refresh();
          render();
          toast('Você saiu da conta.', 'success');
        } catch (error) {
          toast(error.message);
        } finally {
          busy = false;
          logout.disabled = false;
        }
      };
      const profilePanel = element('section', '', 'profile-panel');
      extra.append(profilePanel, logout);
      loadProfile(profilePanel);
      const ordersPanel = element('section', '', 'profile-panel');
      extra.append(ordersPanel);
      loadOrders(ordersPanel);
      note.textContent =
        'Seus dados e endereços, sempre à mão.';
      return;
    }
    document
      .querySelectorAll('[data-account-tab]')
      .forEach((b) => b.classList.toggle('active', b.dataset.accountTab === tab));
    document.querySelectorAll('[data-account-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.accountTab === tab)));
    if (tab === 'register') input('Nome completo', 'name', 'text', 'name');
    if (['login', 'register', 'forgot'].includes(tab)) input('E-mail', 'email', 'email', 'email');
    if (tab === 'register') {
      input('CPF', 'cpf');
      input('Telefone com DDD', 'phone', 'tel', 'tel');
    }
    if (tab === 'reset') input('Código do e-mail Recupere sua senha', 'token');
    if (tab === 'verify') input('Código do e-mail Confirme seu e-mail', 'token');
    if (['login', 'register', 'reset'].includes(tab))
      input(
        tab === 'reset' ? 'Nova senha' : 'Senha',
        'password',
        'password',
        tab === 'login' ? 'current-password' : 'new-password',
      );
    if (['register', 'reset'].includes(tab))
      input('Confirmar senha', 'confirm', 'password', 'new-password');
    submit.textContent = labels[tab];
    for (const [target, label] of [
      ['forgot', 'Esqueci minha senha'],
      ['reset', 'Já tenho código de recuperação'],
      ['verify', 'Confirmar meu e-mail'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'account-link';
      button.textContent = label;
      button.onclick = () => {
        if (!busy) {
          tab = target;
          render();
        }
      };
      extra.append(button);
    }
    note.textContent =
      tab === 'register' || tab === 'reset'
        ? 'Use uma senha de 12 a 128 caracteres.'
        : '';
  }
  async function loadOrders(root) {
    root.replaceChildren(element('h3', 'Meus pedidos'));
    try {
      const response = await fetch('/api/v1/orders');
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      if (!root.isConnected) return;
      if (!data.orders.length) root.append(element('p', 'Você ainda não tem pedidos.'));
      const states = { pending:'Aguardando pagamento', paid:'Pagamento confirmado', review:'Revisão da cobrança', creating:'Preparando cobrança', refund:'Estorno em análise ou concluído', chargeback:'Contestação', late_payment:'Pagamento após expiração: em revisão', blocked:'Pagamento não aprovado' };
      const deliveryLabels = { to_arrange: 'A combinar', scheduled: 'Agendada', delivered: 'Entregue' };
      const deliveryText = (state, date) => {
        const label = deliveryLabels[state] || deliveryLabels.to_arrange;
        return 'Entrega pela loja: ' + label + (date ? ' · ' + date.split('-').reverse().join('/') : '');
      };
      for (const order of data.orders) {
        const card = element('details'); card.append(element('summary', 'Pedido ' + order.id.slice(0,8) + ' · ' + (order.amount_cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})));
        const status = element('p', states[order.payment_state] || order.payment_state);
        const delivery = element('p', deliveryText(order.delivery_state, order.delivery_date));
        const refresh = element('button','Atualizar pedido','account-link'); refresh.type='button';
        refresh.onclick = async () => {
          refresh.disabled = true;
          try {
            if (!csrfToken) await csrf();
            const r = await fetch('/api/v1/orders/'+order.id+'/reconcile', {method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:'{}'});
            const payment = await r.json(); if (!r.ok) throw Error(payment.error);
            status.textContent = states[payment.paymentState] || payment.paymentState;
            const detail = await fetch('/api/v1/orders/'+order.id);
            if (detail.ok) {
              const { order: updated } = await detail.json();
              delivery.textContent = deliveryText(updated.deliveryState, updated.deliveryDate);
            }
          } catch(error) { toast(error.message); } finally { refresh.disabled=false; }
        };
        card.append(status, delivery, refresh);
        window.storeSettingsReady?.then(settings => {
          const contact = window.deliveryContactLink(settings);
          if (card.isConnected && contact) delivery.after(contact);
        });
        if (order.invoice_url) {
          const url = new URL(order.invoice_url);
          if (['https://sandbox.asaas.com', 'https://www.asaas.com', 'https://asaas.com'].includes(url.origin) && !url.username && !url.password) {
            const link = element('a', 'Abrir pagamento');
            link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link);
          }
        }
        root.append(card);
      }
    } catch(error) { root.append(element('p',error.message || 'Pedidos indisponíveis.')); }
  }
  async function openAccount(mode = 'login', code = '') {
    if (busy) return;
    tab = mode;
    render();
    if (code) form.elements.namedItem('token').value = code;
    if (!dialog.open) dialog.showModal();
    try {
      await refresh();
      if (!code) render();
    } catch (error) {
      toast(error.message);
    }
  }
  window.openAccount = openAccount;
  document.querySelectorAll('[data-account-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!busy) {
        tab = b.dataset.accountTab;
        render();
      }
    }),
  );
  dialog.addEventListener('invalid', (event) => {
    const field = event.target;
    field.setAttribute('aria-invalid', 'true');
    if (field !== field.form?.querySelector(':invalid')) return;
    const label = field.labels?.[0]?.firstChild?.textContent?.trim();
    const message = field.validity.valueMissing && label
      ? 'Preencha o campo ' + label + '.'
      : field.name === 'token'
        ? 'Confira o código: ele deve conter 64 caracteres, sem espaços.'
        : field.validationMessage;
    const alert = field.form === form ? feedback : field.labels?.[0];
    if (alert === feedback) toast(message);
    else if (alert) {
      alert.querySelector('.form-feedback')?.remove();
      const fieldFeedback = element('span', message, 'form-feedback');
      fieldFeedback.dataset.kind = 'error';
      fieldFeedback.setAttribute('role', 'alert');
      alert.append(fieldFeedback);
    }
  }, true);
  function clearFieldError(event) {
    const field = event.target;
    if (!field.validity?.valid || !field.hasAttribute('aria-invalid')) return;
    field.removeAttribute('aria-invalid');
    if (field.form === form && feedback.dataset.kind === 'error') feedback.hidden = true;
    field.labels?.[0]?.querySelector('.form-feedback')?.remove();
  }
  dialog.addEventListener('input', clearFieldError);
  dialog.addEventListener('change', clearFieldError);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const data = Object.fromEntries(new FormData(form));
    if (data.confirm !== undefined && data.confirm !== data.password) {
      form.elements.confirm.setAttribute('aria-invalid', 'true');
      form.elements.confirm.focus();
      toast('As senhas não coincidem.');
      return;
    }
    delete data.confirm;
    busy = true;
    submit.disabled = true;
    const operation = tab;
    try {
      const endpoint =
        { forgot: 'forgot-password', reset: 'reset-password', verify: 'verify-email' }[operation] ||
        operation;
      const result = await request(endpoint, data);
      form.reset();
      if (operation === 'login') {
        await refresh();
        render();
        toast('Você entrou na sua conta.', 'success');
      } else {
        tab = 'login';
        if (operation === 'reset') customer = null;
        if (operation === 'verify' && customer) await refresh();
        render();
        toast(result.message, 'success');
      }
    } catch (error) {
      toast(error.message);
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });
  render();
  const hash = location.hash.match(/^#mascavo-(confirmar|redefinir)=([a-f0-9]{64})$/);
  if (hash) {
    history.replaceState(history.state, '', location.pathname + location.search);
    openAccount(hash[1] === 'confirmar' ? 'verify' : 'reset', hash[2]);
  } else if (location.protocol !== 'file:') refresh().catch(() => {});
})();
