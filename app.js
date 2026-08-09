const SUPABASE_URL='https://czdvttwkhpfeyekqcbcy.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_Jm7xS7B1a3-jODa67HU9Jg_g_YLd4WJ';
const SESSION_KEY='ed-systems-license-session';
const $=id=>document.getElementById(id);
const labels={trial:'Em teste',active:'Ativa',expired:'Vencida',blocked:'Bloqueada',inactive:'Inativa',tampered:'Alerta'};
let session=null,installations=[],selected=null,issuing=false;

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const formatDate=value=>value?new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
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
    const select=encodeURIComponent('id,installation_id,machine_hash,app_version,installed_at,first_seen_at,last_seen_at,trial_ends_at,status,tamper_reason,academy_id,academies(id,name,legal_name,cnpj,responsible_name,phone,email,status),licenses(id,issued_at,expires_at,status,notes)');
    installations=await api(`/rest/v1/installations?select=${select}&order=last_seen_at.desc`)||[];render();
  }catch(error){$('installationList').innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;if(/sessão|autorizada/i.test(error.message))logout();}
}

function render(){
  const count=status=>installations.filter(item=>item.status===status).length;
  $('metrics').innerHTML=[['Total',installations.length],['Em teste',count('trial')],['Ativas',count('active')],['Vencidas',count('expired')],['Bloqueadas',count('blocked')+count('tampered')]].map(([label,total])=>`<article class="metric"><span>${label}</span><strong>${total}</strong></article>`).join('');
  const query=$('search').value.trim().toLowerCase(),status=$('statusFilter').value;
  const filtered=installations.filter(item=>{const academy=item.academies||{};return(!status||item.status===status)&&(!query||`${academy.name||''} ${academy.cnpj||''} ${item.installation_id}`.toLowerCase().includes(query));});
  if(!filtered.length){$('installationList').innerHTML='<div class="empty">Nenhuma instalação encontrada.</div>';return;}
  $('installationList').innerHTML=filtered.map(item=>{
    const academy=item.academies||{},activeLicense=(item.licenses||[]).find(license=>license.status==='active');
    const blocked=['blocked','inactive'].includes(item.status);
    return `<article class="installation"><div><h3>${escapeHtml(academy.name||'Academia em configuração')}</h3><span class="badge ${item.status}">${labels[item.status]||item.status}</span><div class="muted">CNPJ: ${escapeHtml(academy.cnpj||'não informado')}</div></div><div class="facts"><div><strong>Instalação:</strong> ${formatDate(item.installed_at)}</div><div><strong>Último contato:</strong> ${formatDate(item.last_seen_at)}</div><div><strong>Versão:</strong> ${escapeHtml(item.app_version||'—')}</div></div><div class="facts"><div><strong>Teste até:</strong> ${formatDate(item.trial_ends_at)}</div><div><strong>Licença até:</strong> ${formatDate(activeLicense?.expires_at)}</div><div class="muted">${escapeHtml(item.installation_id)}</div></div><div class="actions"><button class="button primary" data-issue="${item.id}" type="button">Licenciar</button><button class="button secondary" data-status="${blocked?'trial':'blocked'}" data-id="${item.id}" type="button">${blocked?'Desbloquear':'Bloquear'}</button><button class="button secondary" data-status="inactive" data-id="${item.id}" type="button">Inativar</button></div></article>`;
  }).join('');
}

function openLicense(id){selected=installations.find(item=>item.id===id);if(!selected)return;$('licenseAcademy').textContent=`${selected.academies?.name||'Academia'} · ${selected.installation_id}`;$('licenseDays').value=365;$('licenseNotes').value='';$('licensePerpetual').checked=false;$('licenseResult').classList.add('hidden');$('licenseToken').value='';$('modalError').textContent='';$('licenseModal').classList.remove('hidden');$('licenseDays').focus();}
function closeLicense(){if(issuing)return;$('licenseModal').classList.add('hidden');}

async function issue(){
  if(issuing||!selected)return;issuing=true;$('issueButton').disabled=true;$('issueButton').textContent='Gerando com segurança...';$('modalError').textContent='';
  try{
    const data=await api('/functions/v1/license-issue',{method:'POST',body:{installationId:selected.id,days:Math.max(1,Math.min(3650,Number($('licenseDays').value||365))),perpetual:$('licensePerpetual').checked,notes:$('licenseNotes').value.slice(0,500)}});
    $('licenseToken').value=data.token;$('licenseResult').classList.remove('hidden');showToast('Licença emitida com sucesso.');await loadInstallations();
  }catch(error){$('modalError').textContent=error.message;}
  finally{issuing=false;$('issueButton').disabled=false;$('issueButton').textContent='Gerar contrassenha';}
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

$('loginForm').addEventListener('submit',login);$('logoutButton').addEventListener('click',logout);$('refreshButton').addEventListener('click',loadInstallations);$('search').addEventListener('input',render);$('statusFilter').addEventListener('change',render);$('installationList').addEventListener('click',event=>{if(event.target.dataset.issue)openLicense(event.target.dataset.issue);if(event.target.dataset.id)setStatus(event.target.dataset.id,event.target.dataset.status);});document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',closeLicense));$('issueButton').addEventListener('click',issue);$('copyToken').addEventListener('click',copyToken);$('licensePerpetual').addEventListener('change',()=>{$('licenseDays').disabled=$('licensePerpetual').checked;});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('licenseModal').classList.contains('hidden'))closeLicense();});

(async()=>{try{const saved=sessionStorage.getItem(SESSION_KEY);if(!saved)return;session=JSON.parse(saved);await ensureAdmin();openDashboard();await loadInstallations();}catch(_){logout();}})();
