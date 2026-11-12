(() => {
  const dialog = document.querySelector('#account-dialog');
  const form = document.querySelector('#account-form');
  const fields = document.querySelector('#account-fields');
  const submit = document.querySelector('#account-submit');
  const note = dialog.querySelector('.demo-note');
  const feedback = document.createElement('p');
  feedback.className = 'account-feedback';
  feedback.id = 'account-feedback';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  feedback.hidden = true;
  form.before(feedback);
  function toast(message, kind = 'error') {
    feedback.textContent = message || 'Operação concluída.';
    feedback.dataset.kind = kind;
    feedback.hidden = false;
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

  async function csrf() {
    const response = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Abra a loja pelo ambiente local do backend.');
    csrfToken = (await response.json()).csrfToken;
  }
  async function request(path, data) {
    if (!csrfToken) await csrf();
    const response = await fetch('/api/v1/auth/' + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (result.csrfToken) csrfToken = result.csrfToken;
    if (!response.ok) {
      if (response.status === 403) csrfToken = '';
      throw new Error(result.error || 'Não foi possível concluir a operação.');
    }
    return result;
  }
  async function refresh() {
    const response = await fetch('/api/v1/auth/session', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Conta indisponível. Inicie o ambiente local.');
    customer = (await response.json()).customer;
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
      profileField(personalForm, 'CPF (opcional)', 'cpf', data.profile.cpf, {max:14,inputMode:'numeric'});
      profileField(personalForm, 'Telefone com DDD (opcional)', 'phone', data.profile.phone, {type:'tel',autocomplete:'tel',max:20});
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
    form.hidden = !!customer;
    dialog.querySelector('.account-tabs').hidden = !!customer;
    document.querySelector('#account-extra')?.remove();
    const extra = document.createElement('div');
    extra.id = 'account-extra';
    dialog.append(extra);
    if (customer) {
      const text = document.createElement('p');
      text.textContent =
        'Olá, ' +
        customer.name +
        '. ' +
        (customer.emailVerified ? 'E-mail confirmado.' : 'Seu e-mail ainda aguarda confirmação.');
      extra.append(text);
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
      note.textContent =
        'A compra será habilitada após a integração de estoque, pagamento e frete.';
      return;
    }
    document
      .querySelectorAll('[data-account-tab]')
      .forEach((b) => b.classList.toggle('active', b.dataset.accountTab === tab));
    if (tab === 'register') input('Nome completo', 'name', 'text', 'name');
    if (['login', 'register', 'forgot'].includes(tab)) input('E-mail', 'email', 'email', 'email');
    if (['reset', 'verify'].includes(tab)) input('Código recebido por e-mail', 'token');
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
        ? 'Use uma senha de 12 a 128 caracteres. Neste ambiente, utilize apenas dados fictícios.'
        : 'Ambiente de desenvolvimento: utilize apenas dados fictícios.';
  }
  window.openAccount = async () => {
    if (busy) return;
    tab = 'login';
    render();
    if (!dialog.open) dialog.showModal();
    try {
      await refresh();
      render();
    } catch (error) {
      toast(error.message);
    }
  };
  document.querySelectorAll('[data-account-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!busy) {
        tab = b.dataset.accountTab;
        render();
      }
    }),
  );
  form.addEventListener('invalid', (event) => {
    toast(event.target.name === 'token' ? 'Confira o código: ele deve conter 64 caracteres, sem espaços.' : 'Confira os campos destacados para continuar.');
  }, true);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const data = Object.fromEntries(new FormData(form));
    if (data.confirm !== undefined && data.confirm !== data.password) {
      toast('As senhas não coincidem');
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
  if (location.protocol !== 'file:') refresh().catch(() => {});
})();
