const SUPABASE_URL='https://czdvttwkhpfeyekqcbcy.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_Jm7xS7B1a3-jODa67HU9Jg_g_YLd4WJ';
const SESSION_KEY='ed-systems-license-session';
const $=id=>document.getElementById(id);
const labels={trial:'Em teste',active:'Ativa',expired:'Vencida',blocked:'Bloqueada',inactive:'Inativa',tampered:'Alerta'};
let session=null,installations=[],financialCharges=[],messageTemplates=[],emailDeliveries=[],emailProviderConfigured=false,selected=null,issuing=false,editingBilling=null,savingBilling=false,savingTemplate=false,sendingEmail=false,delinquencies=[];

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const formatDate=value=>value?new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
const formatDateOnly=value=>value?new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString('pt-BR'):'—';
const formatMoneyCents=value=>(Number(value||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const todayIso=()=>{const now=new Date(),offset=now.getTimezoneOffset()*60000;return new Date(now-offset).toISOString().slice(0,10);};
const currentMonthIso=()=>todayIso().slice(0,7);
const monthBounds=value=>{const match=/^(\d{4})-(\d{2})$/.exec(value||'');if(!match)return null;const year=Number(match[1]),month=Number(match[2]);if(month<1||month>12)return null;const start=`${year}-${String(month).padStart(2,'0')}-01`,next=new Date(Date.UTC(year,month,1)),end=next.toISOString().slice(0,10);return {start,end,startTime:`${start}T00:00:00.000Z`,endTime:`${end}T00:00:00.000Z`};};
const addLocalMonthsIso=months=>{const now=new Date(),day=now.getDate();now.setDate(1);now.setMonth(now.getMonth()+months);const lastDay=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();now.setDate(Math.min(day,lastDay));return new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);};
const saveSession=value=>{session=value;if(value)sessionStorage.setItem(SESSION_KEY,JSON.stringify(value));else sessionStorage.removeItem(SESSION_KEY);};
const showToast=(message,error=false)=>{const element=$('toast');element.textContent=message;element.className=`toast${error?' error-toast':''}`;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>element.classList.add('hidden'),3500);};

async function refreshSession(){
  if(!session?.refresh_token)throw new Error('Sua sessão expirou. Entre novamente.');
  const response=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:PUBLISHABLE_KEY,'content-type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});
  const data=await response.json();if(!response.ok)throw new Error(data.error_description||data.message||'Não foi possível renovar a sessão.');saveSession(data);return data;
}

async function api(pathname,{method='GET',body,auth=true,retry=true}={}){
  if(auth&&session?.expires_at&&Date.now()/1000>Number(session.expires_at)-60)await refreshSession();
  const response=await fetch(`${SUPABASE_URL}${pathname}`,{method,headers:{apikey:PUBLISHABLE_KEY,...(auth&&session?.access_token?{authorization:`Bearer ${session.access_token}`} : {}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  if(response.status===401&&auth&&retry&&session?.refresh_token){await refreshSession();return api(pathname,{method,body,auth,retry:false});}
  const raw=await response.text();let data=null;try{data=raw?JSON.parse(raw):null;}catch(_){data=raw;}
  if(!response.ok)throw new Error(data?.error_description||data?.message||data?.msg||data?.error||`Falha HTTP ${response.status}`);return data;
}

async function ensureAdmin(){
  if(!session?.user?.id)throw new Error('Sessão administrativa ausente.');
  const rows=await api(`/rest/v1/license_admins?select=user_id&user_id=eq.${encodeURIComponent(session.user.id)}`);
  if(!rows?.length)throw new Error('Esta conta não está autorizada na Central ED SYSTEMS.');
}

async function login(event){
  event.preventDefault();$('loginError').textContent='';$('loginButton').disabled=true;$('loginButton').textContent='Verificando...';
  try{
    const data=await api('/auth/v1/token?grant_type=password',{method:'POST',auth:false,body:{email:$('email').value.trim(),password:$('password').value}});
    saveSession(data);await ensureAdmin();openDashboard();await loadInstallations();
  }catch(error){saveSession(null);$('loginError').textContent=error.message;}
  finally{$('loginButton').disabled=false;$('loginButton').textContent='Entrar com segurança';}
}

function openDashboard(){$('accountEmail').textContent=session.user?.email||'';$('loginView').classList.add('hidden');$('appView').classList.remove('hidden');}
function logout(){saveSession(null);installations=[];financialCharges=[];messageTemplates=[];emailDeliveries=[];emailProviderConfigured=false;$('appView').classList.add('hidden');$('loginView').classList.remove('hidden');$('password').value='';}

async function loadFinancialCharges(renderAfter=true){
  const bounds=monthBounds($('financeMonth').value);if(!bounds)return;
  $('financeMetrics').innerHTML='<article class="finance-card"><span>Atualizando</span><strong>...</strong></article>';
  const fields='id,academy_id,amount_cents,due_date,status,paid_at,billing_cycle';
  const [dueRows,paidRows]=await Promise.all([
    api(`/rest/v1/license_charges?select=${fields}&due_date=gte.${bounds.start}&due_date=lt.${bounds.end}&order=due_date.desc`),
    api(`/rest/v1/license_charges?select=${fields}&paid_at=gte.${encodeURIComponent(bounds.startTime)}&paid_at=lt.${encodeURIComponent(bounds.endTime)}&order=paid_at.desc`)
  ]);
  financialCharges=[...new Map([...(dueRows||[]),...(paidRows||[])].map(charge=>[charge.id,charge])).values()];
  if(renderAfter)renderFinancialSummary();
}

async function loadMessageTemplates(renderAfter=true){messageTemplates=await api('/rest/v1/license_message_templates?select=template_key,label,subject,body,enabled,updated_at&order=template_key')||[];if(renderAfter)renderMessageTemplates();}

async function loadEmailIntegration(renderAfter=true){
  const [status,deliveries]=await Promise.all([
    api('/functions/v1/license-email-send',{method:'POST',body:{action:'status'}}),
    api('/rest/v1/license_notifications?select=id,academy_id,recipient,template_key,status,provider_message_id,error_message,sent_at,created_at&order=created_at.desc&limit=8')
  ]);
  emailProviderConfigured=status?.configured===true;emailDeliveries=deliveries||[];if(renderAfter)renderEmailIntegration();
}

async function loadInstallations(){
  $('installationList').innerHTML='<div class="empty">Atualizando a Central...</div>';
  try{
    await ensureAdmin();
    const select=encodeURIComponent('id,installation_id,machine_hash,app_version,installed_at,first_seen_at,last_seen_at,trial_ends_at,status,tamper_reason,academy_id,academies(id,name,legal_name,cnpj,responsible_name,phone,email,status),licenses(id,issued_at,expires_at,status,notes,billing_cycle,billing_amount_cents,billing_due_date,billing_status,paid_at,billing_collection_mode,billing_notice_enabled,billing_notice_days,billing_notification_channel,billing_enforcement_mode,billing_grace_days,billing_auto_blocked_at)');
    installations=await api(`/rest/v1/installations?select=${select}&order=last_seen_at.desc`)||[];
    try{await loadFinancialCharges(false);}catch(error){financialCharges=[];$('financeCaption').textContent=`Não foi possível carregar o financeiro: ${error.message}`;}
    try{await loadMessageTemplates(false);}catch(error){messageTemplates=[];$('templateSummary').innerHTML=`<div class="finance-empty">${escapeHtml(error.message)}</div>`;}
    try{await loadEmailIntegration(false);}catch(error){emailProviderConfigured=false;emailDeliveries=[];$('emailProviderStatus').innerHTML=`<span class="status-dot off"></span><div><strong>Integração de e-mail indisponível</strong><small>${escapeHtml(error.message)}</small></div>`;}
    render();
  }catch(error){$('installationList').innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;if(/sessão|autorizada/i.test(error.message))logout();}
}

function render(){
  const count=status=>installations.filter(item=>item.status===status).length;
  delinquencies=installations.flatMap(item=>(item.licenses||[]).map(license=>({license,installation:item,academy:item.academies||{}}))).filter(item=>Number(item.license.billing_amount_cents)>0&&['pending','overdue'].includes(item.license.billing_status)&&item.license.billing_due_date&&item.license.billing_due_date<todayIso());
  const overdueTotal=delinquencies.reduce((sum,item)=>sum+Number(item.license.billing_amount_cents||0),0);
  $('metrics').innerHTML=[['Total',installations.length],['Em teste',count('trial')],['Ativas',count('active')],['Vencidas',count('expired')],['Bloqueadas',count('blocked')+count('tampered')],['Em atraso',formatMoneyCents(overdueTotal)]].map(([label,total])=>`<article class="metric"><span>${label}</span><strong>${total}</strong></article>`).join('');
  renderFinancialSummary();
  renderMessageTemplates();
  renderEmailIntegration();
  renderDelinquencies(overdueTotal);
  const query=$('search').value.trim().toLowerCase(),status=$('statusFilter').value;
  const filtered=installations.filter(item=>{const academy=item.academies||{};return(!status||item.status===status)&&(!query||`${academy.name||''} ${academy.cnpj||''} ${item.installation_id}`.toLowerCase().includes(query));});
  if(!filtered.length){$('installationList').innerHTML='<div class="empty">Nenhuma instalação encontrada.</div>';return;}
  $('installationList').innerHTML=filtered.map(item=>{
    const academy=item.academies||{},activeLicense=(item.licenses||[]).find(license=>license.status==='active');
    const blocked=['blocked','inactive'].includes(item.status);
    const cycleLabel={monthly:'Mensalidade',annual:'Anuidade',custom:'Personalizada',perpetual:'Sem vencimento'}[activeLicense?.billing_cycle]||'—';
    return `<article class="installation"><div><h3>${escapeHtml(academy.name||'Academia em configuração')}</h3><span class="badge ${item.status}">${labels[item.status]||item.status}</span><div class="muted">CNPJ: ${escapeHtml(academy.cnpj||'não informado')}</div></div><div class="facts"><div><strong>Instalação:</strong> ${formatDate(item.installed_at)}</div><div><strong>Último contato:</strong> ${formatDate(item.last_seen_at)}</div><div><strong>Versão:</strong> ${escapeHtml(item.app_version||'—')}</div></div><div class="facts"><div><strong>Plano:</strong> ${cycleLabel}</div><div><strong>Licença até:</strong> ${formatDate(activeLicense?.expires_at)}</div><div class="muted">${escapeHtml(item.installation_id)}</div></div><div class="actions"><button class="button primary" data-issue="${item.id}" type="button">Licenciar</button>${activeLicense?`<button class="button secondary" data-billing="${item.id}" type="button">Plano e cobrança</button>`:''}<button class="button secondary" data-status="${blocked?'trial':'blocked'}" data-id="${item.id}" type="button">${blocked?'Desbloquear':'Bloquear'}</button><button class="button secondary" data-status="inactive" data-id="${item.id}" type="button">Inativar</button></div></article>`;
  }).join('');
}

function renderFinancialSummary(){
  const bounds=monthBounds($('financeMonth').value);if(!bounds)return;
  const due=financialCharges.filter(charge=>charge.due_date>=bounds.start&&charge.due_date<bounds.end),paid=financialCharges.filter(charge=>charge.paid_at&&charge.paid_at>=bounds.startTime&&charge.paid_at<bounds.endTime);
  const expected=due.filter(charge=>!['cancelled','waived'].includes(charge.status)).reduce((sum,charge)=>sum+Number(charge.amount_cents||0),0);
  const received=paid.reduce((sum,charge)=>sum+Number(charge.amount_cents||0),0);
  const open=due.filter(charge=>['pending','overdue'].includes(charge.status)).reduce((sum,charge)=>sum+Number(charge.amount_cents||0),0);
  const overdue=due.filter(charge=>charge.status==='overdue'||(charge.status==='pending'&&charge.due_date<todayIso())).reduce((sum,charge)=>sum+Number(charge.amount_cents||0),0);
  $('financeMetrics').innerHTML=[['Receita prevista',expected,''],['Recebida no mês',received,'received'],['Em aberto',open,''],['Vencida',overdue,'overdue']].map(([label,value,className])=>`<article class="finance-card ${className}"><span>${label}</span><strong>${formatMoneyCents(value)}</strong></article>`).join('');
  $('financeCaption').textContent=`${due.length} cobrança(s) com vencimento no período e ${paid.length} pagamento(s) recebido(s).`;
  const academyName=id=>installations.find(item=>item.academy_id===id)?.academies?.name||'Academia';
  const statusLabels={pending:'Pendente',paid:'Paga',overdue:'Vencida',waived:'Isenta',cancelled:'Cancelada'};
  const recent=[...financialCharges].sort((a,b)=>String(b.paid_at||b.due_date).localeCompare(String(a.paid_at||a.due_date))).slice(0,8);
  $('financeRecent').innerHTML=recent.length?recent.map(charge=>`<div class="finance-row"><strong>${escapeHtml(academyName(charge.academy_id))}</strong><span>Vence ${formatDateOnly(charge.due_date)}</span><span>${statusLabels[charge.status]||escapeHtml(charge.status)}</span><strong>${formatMoneyCents(charge.amount_cents)}</strong></div>`).join(''):'<div class="finance-empty">Ainda não existem cobranças neste período.</div>';
}

function renderMessageTemplates(){
  if(!messageTemplates.length){$('templateSummary').innerHTML='<div class="finance-empty">Nenhum modelo cadastrado.</div>';return;}
  $('templateSummary').innerHTML=messageTemplates.map(template=>`<article class="template-card"><strong>${escapeHtml(template.label)}</strong><span>${escapeHtml(template.subject)}</span><small class="${template.enabled?'':'off'}">${template.enabled?'Ativo':'Inativo'}</small></article>`).join('');
}

function renderEmailIntegration(){
  $('emailProviderStatus').innerHTML=emailProviderConfigured?'<span class="status-dot"></span><div><strong>E-mail configurado</strong><small>Envio manual disponível; as entregas são registradas abaixo.</small></div>':'<span class="status-dot off"></span><div><strong>Aguardando configuração do Resend</strong><small>Cadastre a chave e o remetente no Supabase para liberar os envios.</small></div>';
  const templateLabels={due_soon:'Próxima do vencimento',overdue:'Vencida',blocked:'Bloqueio'},statusLabels={processing:'Processando',sent:'Enviado',failed:'Falhou'};
  $('emailDeliveryHistory').innerHTML=emailDeliveries.length?emailDeliveries.map(item=>`<div class="delivery-row"><div><strong>${escapeHtml(installations.find(row=>row.academy_id===item.academy_id)?.academies?.name||item.recipient)}</strong><small>${escapeHtml(templateLabels[item.template_key]||item.template_key)}</small></div><div><span class="delivery-status ${escapeHtml(item.status)}">${statusLabels[item.status]||escapeHtml(item.status)}</span><small>${formatDate(item.sent_at||item.created_at)}</small></div></div>`).join(''):'<div class="finance-empty">Nenhum e-mail enviado ainda.</div>';
}

function fillTemplateForm(){const template=messageTemplates.find(item=>item.template_key===$('templateSelect').value);if(!template)return;$('templateEnabled').checked=template.enabled;$('templateSubject').value=template.subject;$('templateBody').value=template.body;$('templateError').textContent='';}
function openTemplateModal(){if(!messageTemplates.length){showToast('Nenhum modelo disponível.',true);return;}$('templateSelect').innerHTML=messageTemplates.map(template=>`<option value="${escapeHtml(template.template_key)}">${escapeHtml(template.label)}</option>`).join('');fillTemplateForm();$('templateModal').classList.remove('hidden');$('templateSelect').focus();}
function closeTemplateModal(){if(savingTemplate)return;$('templateModal').classList.add('hidden');}
async function saveMessageTemplate(){
  if(savingTemplate)return;const key=$('templateSelect').value,subject=$('templateSubject').value.trim(),body=$('templateBody').value.trim(),allowed=new Set(['academia','valor','vencimento','dias']),unknown=[...body.matchAll(/\{([^{}]+)\}/g)].map(match=>match[1]).filter(name=>!allowed.has(name));$('templateError').textContent='';
  if(!subject||!body){$('templateError').textContent='Preencha o título e a mensagem.';return;}if(unknown.length){$('templateError').textContent=`Campo desconhecido: {${unknown[0]}}.`;return;}
  savingTemplate=true;$('templateSaveButton').disabled=true;$('templateSaveButton').textContent='Salvando...';
  try{await api(`/rest/v1/license_message_templates?template_key=eq.${encodeURIComponent(key)}`,{method:'PATCH',body:{subject,body,enabled:$('templateEnabled').checked,updated_at:new Date().toISOString(),updated_by:session.user.id}});await loadMessageTemplates();fillTemplateForm();showToast('Modelo salvo e pronto para sincronização.');}catch(error){$('templateError').textContent=error.message;}finally{savingTemplate=false;$('templateSaveButton').disabled=false;$('templateSaveButton').textContent='Salvar modelo';}
}

function renderDelinquencies(total){
  $('billingSummary').textContent=delinquencies.length?`${delinquencies.length} cobrança(s) vencida(s), totalizando ${formatMoneyCents(total)}.`:'Nenhuma cobrança vencida.';
  $('exportDelinquency').disabled=!delinquencies.length;
  if(!delinquencies.length){$('delinquencyList').innerHTML='<div class="billing-empty">Tudo em dia no licenciamento.</div>';return;}
  $('delinquencyList').innerHTML=`<div class="table-scroll"><table><thead><tr><th>Academia</th><th>CNPJ</th><th>WhatsApp</th><th>Vencimento</th><th>Valor</th><th></th></tr></thead><tbody>${delinquencies.map(({license,academy})=>`<tr><td><strong>${escapeHtml(academy.name||'Academia')}</strong><span>${escapeHtml(academy.legal_name||'Razão social não informada')}</span></td><td>${escapeHtml(academy.cnpj||'—')}</td><td>${escapeHtml(academy.phone||'—')}</td><td>${formatDateOnly(license.billing_due_date)}</td><td><strong>${formatMoneyCents(license.billing_amount_cents)}</strong></td><td><div class="row-actions"><button class="button secondary compact" data-email="${license.id}" type="button" ${emailProviderConfigured&&academy.email?'':'disabled'}>Enviar e-mail</button><button class="button secondary compact" data-paid="${license.id}" type="button">Marcar paga</button></div></td></tr>`).join('')}</tbody></table></div>`;
}

function openLicense(id){selected=installations.find(item=>item.id===id);if(!selected)return;$('licenseAcademy').textContent=`${selected.academies?.name||'Academia'} · ${selected.installation_id}`;$('licenseBillingCycle').value='monthly';$('licenseDays').value=30;$('licenseAmount').value='0.00';$('licenseBillingDueDate').value=addLocalMonthsIso(1);$('licenseComplimentary').checked=true;toggleBillingCycle();toggleComplimentary();$('licenseNotes').value='';$('licenseResult').classList.add('hidden');$('licenseToken').value='';$('modalError').textContent='';$('licenseModal').classList.remove('hidden');$('licenseBillingCycle').focus();}
function closeLicense(){if(issuing)return;$('licenseModal').classList.add('hidden');}
function toggleComplimentary(){const complimentary=$('licenseComplimentary').checked;$('licenseAmount').disabled=complimentary;$('licenseBillingDueDate').disabled=complimentary;if(complimentary)$('licenseAmount').value='0.00';}
function toggleBillingCycle(){const cycle=$('licenseBillingCycle').value;$('licenseCustomDays').classList.toggle('hidden',cycle!=='custom');if(cycle==='monthly'){$('licenseDays').value=30;$('licenseBillingDueDate').value=addLocalMonthsIso(1);}else if(cycle==='annual'){$('licenseDays').value=365;$('licenseBillingDueDate').value=addLocalMonthsIso(12);}else if(cycle==='perpetual')$('licenseBillingDueDate').value='';}

async function openBilling(id){
  const installation=installations.find(item=>item.id===id),license=(installation?.licenses||[]).find(item=>item.status==='active');if(!installation||!license){showToast('Esta instalação não possui licença ativa.',true);return;}
  editingBilling={installation,license,charges:[]};$('billingAcademy').textContent=installation.academies?.name||'Academia';$('billingTechnicalValidity').textContent=`Validade técnica: ${formatDate(license.expires_at)}`;$('billingEditCycle').value=license.billing_cycle||'custom';$('billingEditAmount').value=(Number(license.billing_amount_cents||0)/100).toFixed(2);$('billingEditDueDate').value=license.billing_due_date||'';$('billingEditStatus').value=['pending','paid','waived','cancelled'].includes(license.billing_status)?license.billing_status:(Number(license.billing_amount_cents)>0?'pending':'waived');$('billingEditCollectionMode').value=license.billing_collection_mode||'manual';$('billingEditNoticeEnabled').checked=license.billing_notice_enabled!==false;$('billingEditNoticeDays').value=license.billing_notice_days??3;$('billingEditChannel').value=license.billing_notification_channel||'none';$('billingEditEnforcementMode').value=license.billing_enforcement_mode||'manual';$('billingEditGraceDays').value=license.billing_grace_days??3;$('billingEmailButton').disabled=!emailProviderConfigured||!installation.academies?.email||Number(license.billing_amount_cents)<=0||!license.billing_due_date;toggleBillingAutomation();$('billingEditError').textContent='';$('billingHistoryList').innerHTML='<div class="billing-empty">Carregando histórico...</div>';$('billingModal').classList.remove('hidden');$('billingEditCycle').focus();
  try{const charges=await api(`/rest/v1/license_charges?select=id,billing_cycle,amount_cents,due_date,status,paid_at,created_at&academy_id=eq.${encodeURIComponent(installation.academy_id)}&order=due_date.desc`);if(editingBilling?.license.id===license.id){editingBilling.charges=charges||[];renderBillingHistory(charges||[]);}}catch(error){if(editingBilling?.license.id===license.id)$('billingHistoryList').innerHTML=`<div class="billing-empty">${escapeHtml(error.message)}</div>`;}
}
function closeBilling(){if(savingBilling)return;editingBilling=null;$('billingModal').classList.add('hidden');}
function toggleBillingAutomation(){$('billingEditNoticeDays').disabled=!$('billingEditNoticeEnabled').checked;$('billingEditGraceDays').disabled=$('billingEditEnforcementMode').value!=='automatic';}
function billingPayload(license,overrides={}){return {licenseId:license.id,billingCycle:license.billing_cycle||'custom',billingAmountCents:Number(license.billing_amount_cents||0),billingDueDate:license.billing_due_date||null,billingStatus:license.billing_status||'waived',billingCollectionMode:license.billing_collection_mode||'manual',billingNoticeEnabled:license.billing_notice_enabled!==false,billingNoticeDays:Number(license.billing_notice_days??3),billingNotificationChannel:license.billing_notification_channel||'none',billingEnforcementMode:license.billing_enforcement_mode||'manual',billingGraceDays:Number(license.billing_grace_days??3),...overrides};}
function renderBillingHistory(charges){const statusLabels={pending:'Pendente',paid:'Paga',overdue:'Vencida',waived:'Isenta',cancelled:'Cancelada'};if(!charges.length){$('billingHistoryList').innerHTML='<div class="billing-empty">Nenhuma cobrança registrada.</div>';return;}$('billingHistoryList').innerHTML=charges.map(charge=>`<div class="history-row"><div><strong>${formatDateOnly(charge.due_date)}</strong><small>Vencimento</small></div><div><strong>${formatMoneyCents(charge.amount_cents)}</strong><small>${charge.paid_at?`Pago em ${formatDateOnly(charge.paid_at)}`:'Aguardando pagamento'}</small></div><div class="history-status ${escapeHtml(charge.status)}">${statusLabels[charge.status]||escapeHtml(charge.status)}</div></div>`).join('');}
async function saveBilling(){
  if(savingBilling||!editingBilling)return;const amount=Number($('billingEditAmount').value||0),dueDate=$('billingEditDueDate').value,status=$('billingEditStatus').value,noticeDays=Number($('billingEditNoticeDays').value),graceDays=Number($('billingEditGraceDays').value);$('billingEditError').textContent='';
  if(!Number.isFinite(amount)||amount<0) {$('billingEditError').textContent='Informe um valor válido.';return;}if(amount>0&&!dueDate){$('billingEditError').textContent='Informe o vencimento da cobrança.';return;}if(!Number.isInteger(noticeDays)||noticeDays<0||noticeDays>30||!Number.isInteger(graceDays)||graceDays<0||graceDays>30){$('billingEditError').textContent='Aviso e tolerância devem estar entre 0 e 30 dias.';return;}
  savingBilling=true;$('billingSaveButton').disabled=true;$('billingSaveButton').textContent='Salvando...';
  try{const result=await api('/functions/v1/license-billing-update',{method:'POST',body:billingPayload(editingBilling.license,{billingCycle:$('billingEditCycle').value,billingAmountCents:Math.round(amount*100),billingDueDate:amount>0?dueDate:null,billingStatus:amount>0?status:'waived',billingCollectionMode:$('billingEditCollectionMode').value,billingNoticeEnabled:$('billingEditNoticeEnabled').checked,billingNoticeDays:noticeDays,billingNotificationChannel:$('billingEditChannel').value,billingEnforcementMode:$('billingEditEnforcementMode').value,billingGraceDays:graceDays})});editingBilling=null;$('billingModal').classList.add('hidden');showToast(result.renewed?'Pagamento registrado e próximo vencimento gerado.':'Plano, avisos e automações atualizados.');await loadInstallations();}catch(error){$('billingEditError').textContent=error.message;}finally{savingBilling=false;$('billingSaveButton').disabled=false;$('billingSaveButton').textContent='Salvar plano e cobrança';}
}

async function issue(){
  if(issuing||!selected)return;issuing=true;$('issueButton').disabled=true;$('issueButton').textContent='Gerando com segurança...';$('modalError').textContent='';
  try{
    const complimentary=$('licenseComplimentary').checked,amount=Number($('licenseAmount').value||0),dueDate=$('licenseBillingDueDate').value,billingCycle=$('licenseBillingCycle').value;
    if(!complimentary&&amount<=0)throw new Error('Informe um valor maior que zero ou marque como cortesia.');
    if(!complimentary&&!dueDate)throw new Error('Informe o vencimento da cobrança.');
    const data=await api('/functions/v1/license-issue',{method:'POST',body:{installationId:selected.id,days:Math.max(1,Math.min(3650,Number($('licenseDays').value||365))),perpetual:billingCycle==='perpetual',billingCycle,notes:$('licenseNotes').value.slice(0,500),complimentary,billingAmountCents:complimentary?0:Math.round(amount*100),billingDueDate:complimentary?null:dueDate}});
    $('licenseToken').value=data.token;$('licenseResult').classList.remove('hidden');showToast('Licença emitida com sucesso.');await loadInstallations();
  }catch(error){$('modalError').textContent=error.message;}
  finally{issuing=false;$('issueButton').disabled=false;$('issueButton').textContent='Gerar contrassenha';}
}

async function markPaid(licenseId){
  if(!confirm('Confirmar o recebimento desta cobrança?'))return;
  const item=delinquencies.find(entry=>entry.license.id===licenseId);
  try{if(!item)throw new Error('Cobrança não encontrada.');const result=await api('/functions/v1/license-billing-update',{method:'POST',body:billingPayload(item.license,{billingStatus:'paid'})});showToast(result.renewed?'Cobrança paga e próximo vencimento gerado.':'Cobrança marcada como paga.');await loadInstallations();}catch(error){showToast(error.message,true);}
}

async function sendBillingEmail(licenseId){
  if(sendingEmail)return;
  const entry=installations.flatMap(installation=>(installation.licenses||[]).map(license=>({license,installation,academy:installation.academies||{}}))).find(item=>item.license.id===licenseId);
  if(!entry){showToast('Licença não encontrada.',true);return;}
  if(!entry.academy.email){showToast('Cadastre o e-mail da academia antes do envio.',true);return;}
  if(!confirm(`Enviar a mensagem de cobrança para ${entry.academy.email}?`))return;
  sendingEmail=true;$('billingEmailButton').disabled=true;
  try{
    const templateKey=entry.license.billing_auto_blocked_at?'blocked':entry.license.billing_due_date<todayIso()?'overdue':'due_soon';
    const result=await api('/functions/v1/license-email-send',{method:'POST',body:{licenseId,templateKey,requestId:crypto.randomUUID()}});
    showToast(`E-mail enviado para ${result.recipient}.`);await loadEmailIntegration();
  }catch(error){const messages={email_provider_not_configured:'Configure o Resend e o remetente no Supabase.',academy_email_required:'Cadastre um e-mail válido para a academia.',billing_not_applicable:'Esta licença não possui cobrança vigente.',template_disabled:'O modelo desta mensagem está desativado.',email_delivery_failed:'O provedor recusou o envio. Consulte o histórico.'};showToast(messages[error.message]||error.message,true);}
  finally{sendingEmail=false;if(editingBilling)$('billingEmailButton').disabled=!emailProviderConfigured||!editingBilling.installation.academies?.email;}
}

function exportDelinquencies(){
  if(!delinquencies.length){showToast('Não há inadimplências para exportar.',true);return;}
  const quote=value=>{let text=String(value??'');if(/^[=+\-@]/.test(text))text=`'${text}`;return `"${text.replace(/"/g,'""')}"`;};
  const rows=[['Nome','CNPJ','Razão Social','Número WhatsApp','E-mail','Data Vencimento','Valor'],...delinquencies.map(({license,academy})=>[academy.name||'',academy.cnpj||'',academy.legal_name||'',academy.phone||'',academy.email||'',formatDateOnly(license.billing_due_date),formatMoneyCents(license.billing_amount_cents)])];
  const csv='\ufeff'+rows.map(row=>row.map(quote).join(';')).join('\r\n'),blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`inadimplencias-licenciamento-${todayIso()}.csv`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);showToast('Lista de inadimplências exportada.');
}

async function copyToken(){
  try{await navigator.clipboard.writeText($('licenseToken').value);}catch(_){$('licenseToken').select();document.execCommand('copy');}
  $('copyToken').textContent='Chave copiada';showToast('Chave copiada para a área de transferência.');
}

async function setStatus(id,status){
  const item=installations.find(row=>row.id===id);if(!item)return;
  const action=status==='blocked'?'bloquear':status==='inactive'?'inativar':'desbloquear';
  if(!confirm(`Deseja realmente ${action} ${item.academies?.name||'esta instalação'}?`))return;
  try{
    const reason=status==='blocked'?'Bloqueio administrativo pelo painel web':`Estado alterado para ${status} pelo painel web`;
    await api(`/rest/v1/installations?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{status,tamper_reason:status==='blocked'?reason:null}});
    if(item.academy_id)await api(`/rest/v1/academies?id=eq.${encodeURIComponent(item.academy_id)}`,{method:'PATCH',body:{status,updated_at:new Date().toISOString()}});
    await api('/rest/v1/license_events',{method:'POST',body:{installation_id:id,academy_id:item.academy_id||null,event_type:`web_admin_${status}`,description:reason}});
    showToast(`Instalação ${labels[status]?.toLowerCase()||status}.`);await loadInstallations();
  }catch(error){showToast(error.message,true);}
}

$('loginForm').addEventListener('submit',login);$('logoutButton').addEventListener('click',logout);$('refreshButton').addEventListener('click',loadInstallations);$('exportDelinquency').addEventListener('click',exportDelinquencies);$('search').addEventListener('input',render);$('statusFilter').addEventListener('change',render);$('financeMonth').addEventListener('change',()=>loadFinancialCharges().catch(error=>showToast(error.message,true)));$('editTemplatesButton').addEventListener('click',openTemplateModal);$('templateSelect').addEventListener('change',fillTemplateForm);$('templateSaveButton').addEventListener('click',saveMessageTemplate);$('installationList').addEventListener('click',event=>{if(event.target.dataset.issue)openLicense(event.target.dataset.issue);if(event.target.dataset.billing)openBilling(event.target.dataset.billing);if(event.target.dataset.id)setStatus(event.target.dataset.id,event.target.dataset.status);});$('delinquencyList').addEventListener('click',event=>{if(event.target.dataset.email)sendBillingEmail(event.target.dataset.email);if(event.target.dataset.paid)markPaid(event.target.dataset.paid);});document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',closeLicense));document.querySelectorAll('[data-close-billing]').forEach(button=>button.addEventListener('click',closeBilling));document.querySelectorAll('[data-close-template]').forEach(button=>button.addEventListener('click',closeTemplateModal));$('issueButton').addEventListener('click',issue);$('billingSaveButton').addEventListener('click',saveBilling);$('billingEmailButton').addEventListener('click',()=>editingBilling&&sendBillingEmail(editingBilling.license.id));$('copyToken').addEventListener('click',copyToken);$('licenseComplimentary').addEventListener('change',toggleComplimentary);$('licenseBillingCycle').addEventListener('change',toggleBillingCycle);document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!$('licenseModal').classList.contains('hidden'))closeLicense();if(!$('billingModal').classList.contains('hidden'))closeBilling();if(!$('templateModal').classList.contains('hidden'))closeTemplateModal();}});
$('billingEditNoticeEnabled').addEventListener('change',toggleBillingAutomation);
$('billingEditEnforcementMode').addEventListener('change',toggleBillingAutomation);

$('financeMonth').value=currentMonthIso();
(async()=>{try{const saved=sessionStorage.getItem(SESSION_KEY);if(!saved)return;session=JSON.parse(saved);await ensureAdmin();openDashboard();await loadInstallations();}catch(_){logout();}})();
