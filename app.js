const SUPABASE_URL='https://czdvttwkhpfeyekqcbcy.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_Jm7xS7B1a3-jODa67HU9Jg_g_YLd4WJ';
const SESSION_KEY='ed-systems-license-session';
const $=id=>document.getElementById(id);
const labels={trial:'Em teste',active:'Ativa',expired:'Vencida',blocked:'Bloqueada',inactive:'Inativa',tampered:'Alerta'};
let session=null,installations=[],selected=null,issuing=false,editingBilling=null,savingBilling=false,delinquencies=[];

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const formatDate=value=>value?new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
const formatDateOnly=value=>value?new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString('pt-BR'):'—';
const formatMoneyCents=value=>(Number(value||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const todayIso=()=>{const now=new Date(),offset=now.getTimezoneOffset()*60000;return new Date(now-offset).toISOString().slice(0,10);};
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
function logout(){saveSession(null);installations=[];$('appView').classList.add('hidden');$('loginView').classList.remove('hidden');$('password').value='';}

async function loadInstallations(){
  $('installationList').innerHTML='<div class="empty">Atualizando a Central...</div>';
  try{
    await ensureAdmin();
    const select=encodeURIComponent('id,installation_id,machine_hash,app_version,installed_at,first_seen_at,last_seen_at,trial_ends_at,status,tamper_reason,academy_id,academies(id,name,legal_name,cnpj,responsible_name,phone,email,status),licenses(id,issued_at,expires_at,status,notes,billing_cycle,billing_amount_cents,billing_due_date,billing_status,paid_at)');
    installations=await api(`/rest/v1/installations?select=${select}&order=last_seen_at.desc`)||[];render();
  }catch(error){$('installationList').innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;if(/sessão|autorizada/i.test(error.message))logout();}
}

function render(){
  const count=status=>installations.filter(item=>item.status===status).length;
  delinquencies=installations.flatMap(item=>(item.licenses||[]).map(license=>({license,installation:item,academy:item.academies||{}}))).filter(item=>Number(item.license.billing_amount_cents)>0&&['pending','overdue'].includes(item.license.billing_status)&&item.license.billing_due_date&&item.license.billing_due_date<todayIso());
  const overdueTotal=delinquencies.reduce((sum,item)=>sum+Number(item.license.billing_amount_cents||0),0);
  $('metrics').innerHTML=[['Total',installations.length],['Em teste',count('trial')],['Ativas',count('active')],['Vencidas',count('expired')],['Bloqueadas',count('blocked')+count('tampered')],['Em atraso',formatMoneyCents(overdueTotal)]].map(([label,total])=>`<article class="metric"><span>${label}</span><strong>${total}</strong></article>`).join('');
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

function renderDelinquencies(total){
  $('billingSummary').textContent=delinquencies.length?`${delinquencies.length} cobrança(s) vencida(s), totalizando ${formatMoneyCents(total)}.`:'Nenhuma cobrança vencida.';
  $('exportDelinquency').disabled=!delinquencies.length;
  if(!delinquencies.length){$('delinquencyList').innerHTML='<div class="billing-empty">Tudo em dia no licenciamento.</div>';return;}
  $('delinquencyList').innerHTML=`<div class="table-scroll"><table><thead><tr><th>Academia</th><th>CNPJ</th><th>WhatsApp</th><th>Vencimento</th><th>Valor</th><th></th></tr></thead><tbody>${delinquencies.map(({license,academy})=>`<tr><td><strong>${escapeHtml(academy.name||'Academia')}</strong><span>${escapeHtml(academy.legal_name||'Razão social não informada')}</span></td><td>${escapeHtml(academy.cnpj||'—')}</td><td>${escapeHtml(academy.phone||'—')}</td><td>${formatDateOnly(license.billing_due_date)}</td><td><strong>${formatMoneyCents(license.billing_amount_cents)}</strong></td><td><button class="button secondary compact" data-paid="${license.id}" type="button">Marcar paga</button></td></tr>`).join('')}</tbody></table></div>`;
}

function openLicense(id){selected=installations.find(item=>item.id===id);if(!selected)return;$('licenseAcademy').textContent=`${selected.academies?.name||'Academia'} · ${selected.installation_id}`;$('licenseBillingCycle').value='monthly';$('licenseDays').value=30;$('licenseAmount').value='0.00';$('licenseBillingDueDate').value=addLocalMonthsIso(1);$('licenseComplimentary').checked=true;toggleBillingCycle();toggleComplimentary();$('licenseNotes').value='';$('licenseResult').classList.add('hidden');$('licenseToken').value='';$('modalError').textContent='';$('licenseModal').classList.remove('hidden');$('licenseBillingCycle').focus();}
function closeLicense(){if(issuing)return;$('licenseModal').classList.add('hidden');}
function toggleComplimentary(){const complimentary=$('licenseComplimentary').checked;$('licenseAmount').disabled=complimentary;$('licenseBillingDueDate').disabled=complimentary;if(complimentary)$('licenseAmount').value='0.00';}
function toggleBillingCycle(){const cycle=$('licenseBillingCycle').value;$('licenseCustomDays').classList.toggle('hidden',cycle!=='custom');if(cycle==='monthly'){$('licenseDays').value=30;$('licenseBillingDueDate').value=addLocalMonthsIso(1);}else if(cycle==='annual'){$('licenseDays').value=365;$('licenseBillingDueDate').value=addLocalMonthsIso(12);}else if(cycle==='perpetual')$('licenseBillingDueDate').value='';}

function openBilling(id){
  const installation=installations.find(item=>item.id===id),license=(installation?.licenses||[]).find(item=>item.status==='active');if(!installation||!license){showToast('Esta instalação não possui licença ativa.',true);return;}
  editingBilling={installation,license};$('billingAcademy').textContent=installation.academies?.name||'Academia';$('billingTechnicalValidity').textContent=`Validade técnica: ${formatDate(license.expires_at)}`;$('billingEditCycle').value=license.billing_cycle||'custom';$('billingEditAmount').value=(Number(license.billing_amount_cents||0)/100).toFixed(2);$('billingEditDueDate').value=license.billing_due_date||'';$('billingEditStatus').value=['pending','paid','waived','cancelled'].includes(license.billing_status)?license.billing_status:(Number(license.billing_amount_cents)>0?'pending':'waived');$('billingEditError').textContent='';$('billingModal').classList.remove('hidden');$('billingEditCycle').focus();
}
function closeBilling(){if(savingBilling)return;editingBilling=null;$('billingModal').classList.add('hidden');}
async function saveBilling(){
  if(savingBilling||!editingBilling)return;const amount=Number($('billingEditAmount').value||0),dueDate=$('billingEditDueDate').value,status=$('billingEditStatus').value;$('billingEditError').textContent='';
  if(!Number.isFinite(amount)||amount<0) {$('billingEditError').textContent='Informe um valor válido.';return;}if(amount>0&&!dueDate){$('billingEditError').textContent='Informe o vencimento da cobrança.';return;}
  savingBilling=true;$('billingSaveButton').disabled=true;$('billingSaveButton').textContent='Salvando...';
  try{await api('/functions/v1/license-billing-update',{method:'POST',body:{licenseId:editingBilling.license.id,billingCycle:$('billingEditCycle').value,billingAmountCents:Math.round(amount*100),billingDueDate:amount>0?dueDate:null,billingStatus:amount>0?status:'waived'}});editingBilling=null;$('billingModal').classList.add('hidden');showToast('Plano e cobrança atualizados.');await loadInstallations();}catch(error){$('billingEditError').textContent=error.message;}finally{savingBilling=false;$('billingSaveButton').disabled=false;$('billingSaveButton').textContent='Salvar plano e cobrança';}
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
  try{await api(`/rest/v1/licenses?id=eq.${encodeURIComponent(licenseId)}`,{method:'PATCH',body:{billing_status:'paid',paid_at:new Date().toISOString()}});await api('/rest/v1/license_events',{method:'POST',body:{installation_id:item?.installation.id||null,academy_id:item?.academy.id||null,event_type:'billing_paid',description:'Cobrança de licenciamento marcada como paga',details:{license_id:licenseId,amount_cents:item?.license.billing_amount_cents||0}}});showToast('Cobrança marcada como paga.');await loadInstallations();}catch(error){showToast(error.message,true);}
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

$('loginForm').addEventListener('submit',login);$('logoutButton').addEventListener('click',logout);$('refreshButton').addEventListener('click',loadInstallations);$('exportDelinquency').addEventListener('click',exportDelinquencies);$('search').addEventListener('input',render);$('statusFilter').addEventListener('change',render);$('installationList').addEventListener('click',event=>{if(event.target.dataset.issue)openLicense(event.target.dataset.issue);if(event.target.dataset.billing)openBilling(event.target.dataset.billing);if(event.target.dataset.id)setStatus(event.target.dataset.id,event.target.dataset.status);});$('delinquencyList').addEventListener('click',event=>{if(event.target.dataset.paid)markPaid(event.target.dataset.paid);});document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',closeLicense));document.querySelectorAll('[data-close-billing]').forEach(button=>button.addEventListener('click',closeBilling));$('issueButton').addEventListener('click',issue);$('billingSaveButton').addEventListener('click',saveBilling);$('copyToken').addEventListener('click',copyToken);$('licenseComplimentary').addEventListener('change',toggleComplimentary);$('licenseBillingCycle').addEventListener('change',toggleBillingCycle);document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!$('licenseModal').classList.contains('hidden'))closeLicense();if(!$('billingModal').classList.contains('hidden'))closeBilling();}});

(async()=>{try{const saved=sessionStorage.getItem(SESSION_KEY);if(!saved)return;session=JSON.parse(saved);await ensureAdmin();openDashboard();await loadInstallations();}catch(_){logout();}})();
