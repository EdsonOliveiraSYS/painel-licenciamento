const SUPABASE_URL='https://czdvttwkhpfeyekqcbcy.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_Jm7xS7B1a3-jODa67HU9Jg_g_YLd4WJ';
const SESSION_KEY='fitnexus-license-session';
const $=id=>document.getElementById(id);
const labels={trial:'Em teste',active:'Ativa',expired:'Vencida',blocked:'Bloqueada',inactive:'Inativa',tampered:'Alerta'};
let session=null,installations=[],financialCharges=[],delinquentCharges=[],messageTemplates=[],emailDeliveries=[],appReleases=[],partners=[],partnerSchemaError='',emailProviderConfigured=false,selected=null,issuing=false,editingBilling=null,savingBilling=false,savingTemplate=false,sendingEmail=false,publishingUpdate=false,delinquencies=[],clientView='active',centralPanel='overview',installationQrReader=null;

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
  if(!rows?.length)throw new Error('Esta conta não está autorizada na Central FitNexus.');
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
function logout(){saveSession(null);installations=[];financialCharges=[];delinquentCharges=[];messageTemplates=[];emailDeliveries=[];emailProviderConfigured=false;$('appView').classList.add('hidden');$('loginView').classList.remove('hidden');$('password').value='';}

async function loadDelinquentCharges(){
  const fields='id,license_id,installation_id,academy_id,billing_cycle,amount_cents,due_date,status,paid_at';
  delinquentCharges=await api(`/rest/v1/license_charges?select=${fields}&status=in.(pending,overdue)&due_date=lt.${todayIso()}&order=due_date.asc`)||[];
}

async function loadFinancialCharges(renderAfter=true){
  const bounds=monthBounds($('financeMonth').value);if(!bounds)return;
  $('financeMetrics').innerHTML='<article class="finance-card"><span>Atualizando</span><strong>...</strong></article>';
  const fields='id,license_id,installation_id,academy_id,partner_id,amount_cents,due_date,status,paid_at,billing_cycle';
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

const versionParts=value=>String(value||'0').replace(/^v/i,'').split('.').slice(0,4).map(part=>Number((part.match(/^\d+/)||['0'])[0]));
const compareVersions=(left,right)=>{const a=versionParts(left),b=versionParts(right);for(let index=0;index<Math.max(a.length,b.length,3);index++){const difference=(a[index]||0)-(b[index]||0);if(difference)return difference;}return 0;};
const latestRelease=channel=>appReleases.filter(item=>item.status==='published'&&item.channel===channel).sort((a,b)=>compareVersions(b.version,a.version))[0]||null;

async function loadAppReleases(){
  appReleases=await api('/rest/v1/app_releases?select=id,version,channel,status,release_notes,mandatory,min_version,delivery_mode,installer_path,installer_sha256,installer_size_bytes,published_at,created_at,updated_at&order=created_at.desc')||[];
}

function updateStatusLabel(item){
  if(item.update_error)return 'Falha';
  return {unknown:'Aguardando contato',up_to_date:'Atualizado',available:'Disponível',downloading:'Baixando',downloaded:'Pronto para instalar',installing:'Instalando',failed:'Falha'}[item.update_status]||'Aguardando';
}

function renderUpdateCenter(){
  const stable=latestRelease('stable'),beta=latestRelease('beta');
  const targetFor=item=>latestRelease(item.update_channel==='beta'?'beta':'stable');
  const activeInstallations=installations.filter(item=>item.status==='active'||item.status==='trial');
  const outdated=activeInstallations.filter(item=>{const target=targetFor(item);return target&&compareVersions(item.app_version||'0',target.version)<0;});
  const updated=activeInstallations.filter(item=>{const target=targetFor(item);return target&&compareVersions(item.app_version||'0',target.version)>=0;}).length;
  $('updateOverview').innerHTML=`<article><span>Versão estável</span><strong>${escapeHtml(stable?.version||'Não publicada')}</strong><small>${stable?formatDate(stable.published_at):'Envie o primeiro instalador'}</small></article><article><span>Clientes atualizados</span><strong>${updated}</strong><small>Na versão do canal escolhido</small></article><article class="${outdated.length?'attention':''}"><span>Precisam atualizar</span><strong>${outdated.length}</strong><small>${outdated.length?'Veja a lista abaixo':'Todos em dia'}</small></article><article><span>Canal beta</span><strong>${escapeHtml(beta?.version||'—')}</strong><small>${beta?'Disponível para testes':'Sem versão beta'}</small></article>`;
  renderReleaseManagement();
  if(!outdated.length){$('outdatedClients').innerHTML='<div class="update-empty">Nenhum cliente precisa atualizar neste momento.</div>';return;}
  $('outdatedClients').innerHTML=`<div class="update-list-head"><strong>Clientes que precisam atualizar</strong><span>${outdated.length} instalação(ões)</span></div><div class="table-scroll"><table><thead><tr><th>Academia</th><th>Instalada</th><th>Disponível</th><th>Andamento</th><th>Último contato</th><th>Automático</th></tr></thead><tbody>${outdated.map(item=>{const academy=item.academies||{},target=targetFor(item);return `<tr><td><strong>${escapeHtml(academy.name||'Academia')}</strong><span>${escapeHtml(academy.cnpj||'CNPJ não informado')}</span></td><td>${escapeHtml(item.app_version||'Não informada')}</td><td><strong>${escapeHtml(target?.version||'—')}</strong>${target?.mandatory?'<span class="update-required">Obrigatória</span>':''}</td><td><span class="update-progress ${escapeHtml(item.update_status||'unknown')}">${escapeHtml(updateStatusLabel(item))}</span>${item.update_error?`<small>${escapeHtml(item.update_error)}</small>`:''}</td><td>${formatDate(item.last_seen_at)}</td><td><button class="button secondary compact" data-update-auto="${item.id}" data-enabled="${item.update_auto_enabled!==false?'true':'false'}" type="button">${item.update_auto_enabled!==false?'Ligado':'Desligado'}</button></td></tr>`;}).join('')}</tbody></table></div>`;
}

async function loadPartners(renderAfter=true){
  try{partners=await api('/rest/v1/license_partners?select=id,name,cnpj,responsible_name,phone,email,default_amount_cents,active,notes,created_at,updated_at&order=name.asc')||[];partnerSchemaError='';}
  catch(error){partners=[];partnerSchemaError=/license_partners|schema cache|relation .* does not exist/i.test(error.message)?'A estrutura de parceiros ainda não foi publicada no Supabase. Execute a migração 20260826180000_license_partners_and_quarterly.sql no SQL Editor e atualize esta página.':error.message;console.warn('partners unavailable',error.message);}
  if(renderAfter){renderPartnerOptions();renderPartners();}
}
function partnerName(id){return partners.find(item=>item.id===id)?.name||'Cliente direto';}
function partnerOptions(selectedId=''){return `<option value="">Cliente direto FitNexus</option>${partners.filter(item=>item.active||item.id===selectedId).map(item=>`<option value="${escapeHtml(item.id)}" ${item.id===selectedId?'selected':''}>${escapeHtml(item.name)}${item.active?'':' (inativo)'}</option>`).join('')}`;}
function renderPartnerOptions(){['licensePartner','billingPartner'].forEach(id=>{const field=$(id);if(!field)return;const current=field.value;field.innerHTML=partnerOptions(current);field.value=current;});const filter=$('financePartnerFilter');if(filter){const current=filter.value;filter.innerHTML=`<option value="">Todos os clientes</option><option value="direct">Clientes diretos</option>${partners.filter(item=>item.active).map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}`;filter.value=current;}}
function renderPartners(){
  const target=$('partnersList');if(!target)return;
  if(partnerSchemaError){target.innerHTML=`<div class="empty error">${escapeHtml(partnerSchemaError)}</div>`;return;}
  if(!partners.length){target.innerHTML='<div class="empty">Nenhum parceiro cadastrado. Clientes próprios continuam disponíveis normalmente.</div>';return;}
  const linked=installations.flatMap(item=>(item.licenses||[]).filter(license=>license.status==='active').map(license=>({license,item})));
  target.innerHTML=partners.map(partner=>{const academies=linked.filter(entry=>entry.license.partner_id===partner.id);const open=financialCharges.filter(charge=>charge.partner_id===partner.id&&['pending','overdue'].includes(charge.status)).reduce((sum,charge)=>sum+Number(charge.amount_cents||0),0);return `<article class="partner-card ${partner.active?'':'inactive'}"><div><span class="badge ${partner.active?'active':'inactive'}">${partner.active?'Ativo':'Inativo'}</span><h3>${escapeHtml(partner.name)}</h3><p>${escapeHtml(partner.cnpj||'CNPJ não informado')} · ${escapeHtml(partner.responsible_name||'Responsável não informado')}</p></div><div class="partner-stats"><strong>${academies.length}</strong><span>academia(s) vinculada(s)</span></div><div class="partner-stats"><strong>${formatMoneyCents(open)}</strong><span>em aberto</span></div><div class="actions"><button class="button secondary compact" data-partner-report="${partner.id}">PDF mensal</button><button class="button secondary compact" data-partner-edit="${partner.id}">Editar</button></div></article>`;}).join('');
}

function releaseSummary(release){return `${escapeHtml(release.version)} · ${release.channel==='beta'?'Beta':'Estável'}${release.delivery_mode==='manual'?' · Aviso manual':''}`;}
function renderReleaseManagement(){
  const active=appReleases.filter(item=>item.status==='published'),history=appReleases.filter(item=>item.status!=='published');
  $('activeReleases').innerHTML=active.length?active.map(item=>`<article class="release-row"><div><strong>${releaseSummary(item)}</strong><p>${escapeHtml(item.release_notes||'Sem descrição.')}</p><small>Publicado em ${formatDate(item.published_at)}</small></div><div class="release-actions"><button class="button secondary compact" data-release-action="edit" data-release-id="${item.id}">Editar</button><button class="button secondary compact warning" data-release-action="withdraw" data-release-id="${item.id}">Desativar aviso</button><button class="button secondary compact danger" data-release-action="delete" data-release-id="${item.id}">Excluir</button></div></article>`).join(''):'<div class="release-empty">Nenhum aviso ativo. As instalações não verão notificações de atualização.</div>';
  $('releaseHistory').innerHTML=history.length?history.map(item=>`<article class="release-row historical"><div><strong>${releaseSummary(item)}</strong><p>${escapeHtml(item.release_notes||'Sem descrição.')}</p><small>${item.status==='withdrawn'?'Encerrado':'Rascunho'} em ${formatDate(item.updated_at||item.created_at)}</small></div><div class="release-actions"><button class="button secondary compact" data-release-action="restore" data-release-id="${item.id}">Restaurar</button><button class="button secondary compact danger" data-release-action="delete" data-release-id="${item.id}">Excluir</button></div></article>`).join(''):'<div class="release-empty">Nenhuma atualização foi encerrada ainda.</div>';
}

async function manageRelease(action,id){
  const release=appReleases.find(item=>item.id===id);if(!release)return;
  try{
    if(action==='edit'){
      const notes=prompt(`Editar descrição da versão ${release.version}:`,release.release_notes||'');if(notes===null)return;
      const mandatory=confirm('Esta atualização deve ser obrigatória?\n\nOK = obrigatória · Cancelar = opcional.');
      await api(`/rest/v1/app_releases?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{release_notes:notes.trim()||'Sem descrição.',mandatory,updated_at:new Date().toISOString()}});showToast(`Versão ${release.version} atualizada.`);
    }else if(action==='withdraw'){
      if(!confirm(`Desativar o aviso ${release.version}? Ele deixará de aparecer nos clientes após a próxima sincronização e ficará no histórico.`))return;
      await api(`/rest/v1/app_releases?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{status:'withdrawn',updated_at:new Date().toISOString()}});showToast(`Aviso ${release.version} encerrado e movido ao histórico.`);
    }else if(action==='restore'){
      if(!confirm(`Restaurar o aviso ${release.version} para os clientes?`))return;
      await api(`/rest/v1/app_releases?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{status:'published',published_at:new Date().toISOString(),updated_at:new Date().toISOString()}});showToast(`Aviso ${release.version} restaurado.`);
    }else if(action==='delete'){
      if(!confirm(`Excluir permanentemente a versão ${release.version}? Esta ação não poderá ser desfeita.`))return;
      await api(`/rest/v1/app_releases?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});showToast(`Versão ${release.version} excluída.`);
    }
    await loadInstallations();
  }catch(error){showToast(error.message,true);}
}

async function sha256File(file){const bytes=await file.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');}

async function uploadUpdateInstaller(pathname,file){
  if(session?.expires_at&&Date.now()/1000>Number(session.expires_at)-60)await refreshSession();
  if(!globalThis.tus?.Upload)throw new Error('O componente de envio retomável não foi carregado. Atualize a página e tente novamente.');
  return new Promise((resolve,reject)=>{
    const upload=new globalThis.tus.Upload(file,{
      endpoint:'https://czdvttwkhpfeyekqcbcy.storage.supabase.co/storage/v1/upload/resumable',
      retryDelays:[0,3000,5000,10000,20000],
      headers:{authorization:`Bearer ${session.access_token}`,apikey:PUBLISHABLE_KEY,'x-upsert':'false'},
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      chunkSize:6*1024*1024,
      metadata:{bucketName:'app-updates',objectName:pathname,contentType:file.type||'application/octet-stream',cacheControl:'3600'},
      onError:error=>reject(new Error(error?.originalResponse?.getBody?.()||error?.message||'Falha no envio retomável do instalador.')),
      onProgress:(uploaded,total)=>{
        const percentage=total?Math.min(100,Math.round(uploaded/total*100)):0;
        $('updatePublishStatus').textContent=`Enviando o instalador privado... ${percentage}%`;
        $('publishUpdateButton').textContent=`Enviando ${percentage}%`;
      },
      onSuccess:()=>resolve({path:pathname,url:upload.url})
    });
    upload.findPreviousUploads().then(previous=>{
      if(previous.length)upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(reject);
  });
}

function toggleUpdatePublisher(show){$('updatePublisher').classList.toggle('hidden',!show);if(show)$('updateVersion').focus();}

async function publishUpdate(event){
  event.preventDefault();if(publishingUpdate)return;
  const version=$('updateVersion').value.trim().replace(/^v/i,''),channel=$('updateChannel').value,minVersion=$('updateMinVersion').value.trim().replace(/^v/i,''),file=$('updateInstaller').files[0],manualDelivery=$('updateManualDelivery').checked;
  $('updatePublishError').textContent='';
  if(!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)){ $('updatePublishError').textContent='Informe a versão no formato 1.2.3.';return; }
  if(minVersion&&!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(minVersion)){ $('updatePublishError').textContent='A versão mínima deve usar o formato 1.2.3.';return; }
  if(!manualDelivery&&(!file||!file.name.toLowerCase().endsWith('.exe'))){ $('updatePublishError').textContent='Selecione o instalador .exe ou marque o aviso manual.';return; }
  if(appReleases.some(item=>item.version===version&&item.channel===channel)){ $('updatePublishError').textContent='Esta versão já existe nesse canal.';return; }
  publishingUpdate=true;$('publishUpdateButton').disabled=true;$('publishUpdateButton').textContent='Preparando...';
  try{
    let sha256=null,installerPath=null,installerSize=null;
    if(!manualDelivery){$('updatePublishStatus').textContent='Calculando a integridade SHA-256 do instalador...';sha256=await sha256File(file);installerPath=`${channel}/${version}/Academia-Setup-${version}.exe`;installerSize=file.size;$('updatePublishStatus').textContent='Enviando o instalador para o armazenamento privado...';await uploadUpdateInstaller(installerPath,file);}
    $('updatePublishStatus').textContent='Publicando a versão para os clientes...';
    await api('/rest/v1/app_releases',{method:'POST',body:{version,channel,status:'published',release_notes:$('updateNotes').value.trim(),mandatory:$('updateMandatory').checked,min_version:minVersion||null,delivery_mode:manualDelivery?'manual':'automatic',installer_path:installerPath,installer_sha256:sha256,installer_size_bytes:installerSize,published_at:new Date().toISOString(),created_by:session.user.id}});
    event.target.reset();$('updateChannel').value='stable';toggleUpdatePublisher(false);showToast(`Versão ${version} publicada com segurança.`);await loadInstallations();
  }catch(error){$('updatePublishError').textContent=error.message;$('updatePublishStatus').textContent='A publicação não foi concluída.';}
  finally{publishingUpdate=false;$('publishUpdateButton').disabled=false;$('publishUpdateButton').textContent='Enviar e publicar';}
}

async function toggleClientAutomaticUpdate(id,enabled){
  try{await api(`/rest/v1/installations?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{update_auto_enabled:!enabled}});showToast(`Atualização automática ${!enabled?'ativada':'desativada'} para este cliente.`);await loadInstallations();}catch(error){showToast(error.message,true);}
}

async function loadInstallations(){
  $('installationList').innerHTML='<div class="empty">Atualizando a Central...</div>';
  try{
    await ensureAdmin();
    const select=encodeURIComponent('id,installation_id,machine_hash,app_version,installed_at,first_seen_at,last_seen_at,trial_ends_at,status,tamper_reason,academy_id,update_channel,update_auto_enabled,update_status,update_target_version,update_checked_at,update_downloaded_at,update_error,academies(id,name,legal_name,cnpj,responsible_name,phone,email,status),licenses(id,issued_at,expires_at,status,notes,partner_id,billing_payer,billing_cycle,billing_amount_cents,billing_due_date,billing_status,paid_at,billing_collection_mode,billing_notice_enabled,billing_notice_days,billing_notification_channel,billing_enforcement_mode,billing_grace_days,billing_auto_blocked_at)');
    try{installations=await api(`/rest/v1/installations?select=${select}&order=last_seen_at.desc`)||[];}
    catch(error){
      if(!/partner_id|billing_payer/i.test(error.message))throw error;
      const legacy=encodeURIComponent('id,installation_id,machine_hash,app_version,installed_at,first_seen_at,last_seen_at,trial_ends_at,status,tamper_reason,academy_id,update_channel,update_auto_enabled,update_status,update_target_version,update_checked_at,update_downloaded_at,update_error,academies(id,name,legal_name,cnpj,responsible_name,phone,email,status),licenses(id,issued_at,expires_at,status,notes,billing_cycle,billing_amount_cents,billing_due_date,billing_status,paid_at,billing_collection_mode,billing_notice_enabled,billing_notice_days,billing_notification_channel,billing_enforcement_mode,billing_grace_days,billing_auto_blocked_at)');
      installations=await api(`/rest/v1/installations?select=${legacy}&order=last_seen_at.desc`)||[];
    }
    try{await Promise.all([loadFinancialCharges(false),loadDelinquentCharges(),loadAppReleases(),loadPartners(false)]);}catch(error){financialCharges=[];delinquentCharges=[];appReleases=[];partners=[];$('financeCaption').textContent=`Não foi possível carregar parte da Central: ${error.message}`;}
    try{await loadMessageTemplates(false);}catch(error){messageTemplates=[];$('templateSummary').innerHTML=`<div class="finance-empty">${escapeHtml(error.message)}</div>`;}
    try{await loadEmailIntegration(false);}catch(error){emailProviderConfigured=false;emailDeliveries=[];$('emailProviderStatus').innerHTML=`<span class="status-dot off"></span><div><strong>Integração de e-mail indisponível</strong><small>${escapeHtml(error.message)}</small></div>`;}
    render();
  }catch(error){$('installationList').innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;if(/sessão|autorizada/i.test(error.message))logout();}
}

function render(){
  const count=status=>installations.filter(item=>item.status===status).length;
  delinquencies=delinquentCharges.map(charge=>{const installation=installations.find(item=>item.id===charge.installation_id),license=(installation?.licenses||[]).find(item=>item.id===charge.license_id);return {charge,license,installation,academy:installation?.academies||{}};}).filter(item=>item.installation);
  const overdueTotal=delinquencies.reduce((sum,item)=>sum+Number(item.charge.amount_cents||0),0);
  $('metrics').innerHTML=[['Total',installations.length],['Em teste',count('trial')],['Ativas',count('active')],['Vencidas',count('expired')],['Bloqueadas',count('blocked')+count('tampered')],['Em atraso',formatMoneyCents(overdueTotal)]].map(([label,total])=>`<article class="metric"><span>${label}</span><strong>${total}</strong></article>`).join('');
  renderUpdateCenter();
  renderFinancialSummary();
  renderPartnerOptions();
  renderPartners();
  renderMessageTemplates();
  renderEmailIntegration();
  renderDelinquencies(overdueTotal);
  const query=$('search').value.trim().toLowerCase(),status=$('statusFilter').value;
  const targetFor=item=>latestRelease(item.update_channel==='beta'?'beta':'stable');
  const countByStatus=statusValue=>installations.filter(item=>item.status===statusValue).length;
  const countUpdates=installations.filter(item=>{const target=targetFor(item);return target&&compareVersions(item.app_version||'0',target.version)<0;}).length;
  $('clientCountActive').textContent=countByStatus('active');$('clientCountTrial').textContent=countByStatus('trial');$('clientCountExpired').textContent=countByStatus('expired');$('clientCountUpdates').textContent=countUpdates;$('clientCountInactive').textContent=countByStatus('inactive');$('clientCountAll').textContent=installations.length;
  const inSelectedView=item=>{if(clientView==='all')return true;if(clientView==='updates'){const target=targetFor(item);return Boolean(target&&compareVersions(item.app_version||'0',target.version)<0);}return item.status===clientView;};
  const filtered=installations.filter(item=>{const academy=item.academies||{};return inSelectedView(item)&&(!status||item.status===status)&&(!query||`${academy.name||''} ${academy.cnpj||''} ${item.installation_id}`.toLowerCase().includes(query));});
  $('clientDirectoryCount').textContent=`${filtered.length} de ${installations.length} instalação(ões)`;
  if(!filtered.length){$('installationList').innerHTML='<div class="empty">Nenhuma instalação encontrada.</div>';return;}
  $('installationList').innerHTML=filtered.map(item=>{
    const academy=item.academies||{},activeLicense=(item.licenses||[]).find(license=>license.status==='active');
    const blocked=['blocked','inactive'].includes(item.status);
    const cycleLabel={monthly:'Mensalidade',quarterly:'Trimestral',annual:'Anuidade',custom:'Personalizada',perpetual:'Sem vencimento'}[activeLicense?.billing_cycle]||'—';
    return `<article class="installation"><div><h3>${escapeHtml(academy.name||'Academia em configuração')}</h3><span class="badge ${item.status}">${labels[item.status]||item.status}</span><div class="muted">CNPJ: ${escapeHtml(academy.cnpj||'não informado')}</div></div><div class="facts"><div><strong>Instalação:</strong> ${formatDate(item.installed_at)}</div><div><strong>Último contato:</strong> ${formatDate(item.last_seen_at)}</div><div><strong>Versão:</strong> ${escapeHtml(item.app_version||'—')}</div></div><div class="facts"><div><strong>Plano:</strong> ${cycleLabel}</div><div><strong>Origem:</strong> ${activeLicense?.partner_id?escapeHtml(partnerName(activeLicense.partner_id)):'Direta'}</div><div><strong>Licença até:</strong> ${formatDate(activeLicense?.expires_at)}</div></div><div class="actions"><button class="button primary" data-issue="${item.id}" type="button">Licenciar</button>${activeLicense?`<button class="button secondary" data-billing="${item.id}" type="button">Editar licença</button><button class="button secondary danger" data-license-delete="${activeLicense.id}" type="button">Excluir licença</button>`:''}<button class="button secondary" data-status="${blocked?'trial':'blocked'}" data-id="${item.id}" type="button">${blocked?'Desbloquear':'Bloquear'}</button><button class="button secondary" data-status="inactive" data-id="${item.id}" type="button">Inativar</button></div></article>`;
  }).join('');
}

function renderFinancialSummary(){
  const bounds=monthBounds($('financeMonth').value);if(!bounds)return;
  const filter=$('financePartnerFilter')?.value||'',matchesPartner=charge=>!filter||(filter==='direct'?!charge.partner_id:charge.partner_id===filter);
  const due=financialCharges.filter(charge=>matchesPartner(charge)&&charge.due_date>=bounds.start&&charge.due_date<bounds.end),paid=financialCharges.filter(charge=>matchesPartner(charge)&&charge.paid_at&&charge.paid_at>=bounds.startTime&&charge.paid_at<bounds.endTime);
  const expected=due.filter(charge=>!['cancelled','waived'].includes(charge.status)).reduce((sum,charge)=>sum+Number(charge.amount_cents||0),0);
  const received=paid.reduce((sum,charge)=>sum+Number(charge.amount_cents||0),0);
  const open=due.filter(charge=>['pending','overdue'].includes(charge.status)).reduce((sum,charge)=>sum+Number(charge.amount_cents||0),0);
  const overdue=due.filter(charge=>charge.status==='overdue'||(charge.status==='pending'&&charge.due_date<todayIso())).reduce((sum,charge)=>sum+Number(charge.amount_cents||0),0);
  $('financeMetrics').innerHTML=[['Receita prevista',expected,''],['Recebida no mês',received,'received'],['Em aberto',open,''],['Vencida',overdue,'overdue']].map(([label,value,className])=>`<article class="finance-card ${className}"><span>${label}</span><strong>${formatMoneyCents(value)}</strong></article>`).join('');
  $('financeCaption').textContent=`${due.length} cobrança(s) com vencimento no período e ${paid.length} pagamento(s) recebido(s)${filter?` · ${filter==='direct'?'clientes diretos':partnerName(filter)}`:''}.`;
  const academyName=id=>installations.find(item=>item.academy_id===id)?.academies?.name||'Academia';
  const statusLabels={pending:'Pendente',paid:'Paga',overdue:'Vencida',waived:'Isenta',cancelled:'Cancelada'};
  const recent=[...financialCharges].filter(matchesPartner).sort((a,b)=>String(b.paid_at||b.due_date).localeCompare(String(a.paid_at||a.due_date))).slice(0,8);
  $('financeRecent').innerHTML=recent.length?recent.map(charge=>`<div class="finance-row"><strong>${escapeHtml(academyName(charge.academy_id))}</strong><span>${charge.partner_id?`Parceiro: ${escapeHtml(partnerName(charge.partner_id))}`:'Direto'}</span><span>Vence ${formatDateOnly(charge.due_date)}</span><span>${statusLabels[charge.status]||escapeHtml(charge.status)}</span><strong>${formatMoneyCents(charge.amount_cents)}</strong><div class="row-actions"><button class="button secondary compact" data-revenue-edit="${charge.id}">Editar</button><button class="button secondary compact danger" data-revenue-delete="${charge.id}">Excluir</button></div></div>`).join(''):'<div class="finance-empty">Ainda não existem cobranças neste período.</div>';
}

function printPartnerReport(partnerId){
  const partner=partners.find(item=>item.id===partnerId);if(!partner){showToast('Parceiro não encontrado.',true);return;}
  const bounds=monthBounds($('financeMonth').value)||monthBounds(currentMonthIso());const charges=financialCharges.filter(item=>item.partner_id===partnerId&&item.due_date>=bounds.start&&item.due_date<bounds.end);const rows=charges.map(item=>`<tr><td>${escapeHtml(installations.find(entry=>entry.academy_id===item.academy_id)?.academies?.name||'Academia')}</td><td>${formatDateOnly(item.due_date)}</td><td>${escapeHtml({pending:'Pendente',paid:'Paga',overdue:'Vencida',waived:'Isenta',cancelled:'Cancelada'}[item.status]||item.status)}</td><td>${formatMoneyCents(item.amount_cents)}</td></tr>`).join('')||'<tr><td colspan="4">Nenhuma cobrança no período.</td></tr>';const total=charges.filter(item=>!['cancelled','waived'].includes(item.status)).reduce((sum,item)=>sum+Number(item.amount_cents||0),0);const win=window.open('','_blank','noopener,noreferrer');if(!win){showToast('Permita janelas pop-up para gerar o PDF.',true);return;}win.document.write(`<!doctype html><html lang="pt-BR"><head><title>Relatório ${partner.name} ${bounds.start}</title><style>body{font:14px Arial;color:#182033;padding:38px}h1{margin:0}p{color:#66758a}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{border-bottom:1px solid #dfe4eb;padding:10px;text-align:left}th{background:#f2f4f7}.total{margin-top:20px;font-size:18px;font-weight:bold}@media print{body{padding:0}}</style></head><body><h1>FitNexus · Relatório de licenças</h1><p><strong>Parceiro:</strong> ${escapeHtml(partner.name)}${partner.cnpj?` · CNPJ ${escapeHtml(partner.cnpj)}`:''}<br><strong>Período:</strong> ${formatDateOnly(bounds.start)} a ${formatDateOnly(new Date(new Date(`${bounds.end}T00:00:00`).getTime()-86400000).toISOString().slice(0,10))}</p><table><thead><tr><th>Academia</th><th>Vencimento</th><th>Situação</th><th>Valor FitNexus</th></tr></thead><tbody>${rows}</tbody></table><p class="total">Total previsto: ${formatMoneyCents(total)}</p><p>Documento gerado em ${formatDate(new Date().toISOString())}.</p><script>window.onload=()=>window.print()<\/script></body></html>`);win.document.close();}

async function manageRevenue(action,id){
  const charge=financialCharges.find(item=>item.id===id);if(!charge)return;
  try{
    if(action==='edit'){
      const amount=prompt('Valor da receita (R$):',(Number(charge.amount_cents)/100).toFixed(2).replace('.',','));if(amount===null)return;
      const normalized=Number(String(amount).replace(',','.'));if(!Number.isFinite(normalized)||normalized<=0)throw new Error('Informe um valor maior que zero.');
      const dueDate=prompt('Data de vencimento (AAAA-MM-DD):',charge.due_date);if(dueDate===null)return;if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))throw new Error('Use a data no formato AAAA-MM-DD.');
      await api(`/rest/v1/license_charges?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{amount_cents:Math.round(normalized*100),due_date:dueDate,updated_at:new Date().toISOString()}});showToast('Receita atualizada.');
    }else{
      if(!confirm('Excluir este lançamento de receita? Use apenas para testes ou registros lançados por engano.'))return;
      await api(`/rest/v1/license_charges?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});showToast('Receita excluída do painel.');
    }
    await loadInstallations();
  }catch(error){showToast(error.message,true);}
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
  $('delinquencyList').innerHTML=`<div class="table-scroll"><table><thead><tr><th>Academia</th><th>CNPJ</th><th>WhatsApp</th><th>Vencimento</th><th>Valor</th><th>Ações</th></tr></thead><tbody>${delinquencies.map(({charge,license,academy})=>`<tr><td><strong>${escapeHtml(academy.name||'Academia')}</strong><span>${escapeHtml(academy.legal_name||'Razão social não informada')}</span></td><td>${escapeHtml(academy.cnpj||'—')}</td><td>${escapeHtml(academy.phone||'—')}</td><td>${formatDateOnly(charge.due_date)}</td><td><strong>${formatMoneyCents(charge.amount_cents)}</strong></td><td><div class="row-actions"><button class="button secondary compact" data-email="${license?.id||charge.license_id}" type="button" ${emailProviderConfigured&&academy.email?'':'disabled'}>Enviar e-mail</button><button class="button secondary compact" data-paid="${charge.id}" type="button">Marcar como paga</button></div></td></tr>`).join('')}</tbody></table></div>`;
}

function openLicense(id){selected=installations.find(item=>item.id===id);if(!selected)return;$('licenseAcademy').textContent=`${selected.academies?.name||'Academia'} · ${selected.installation_id}`;renderPartnerOptions();$('licensePartner').value='';$('licenseBillingCycle').value='monthly';$('licenseDays').value=30;$('licenseAmount').value='0.00';$('licenseBillingDueDate').value=addLocalMonthsIso(1);$('licenseComplimentary').checked=true;toggleBillingCycle();toggleComplimentary();$('licenseNotes').value='';$('licenseResult').classList.add('hidden');$('licenseToken').value='';$('modalError').textContent='';$('licenseModal').classList.remove('hidden');$('licenseBillingCycle').focus();}
function closeLicense(){if(issuing)return;$('licenseModal').classList.add('hidden');}
function toggleComplimentary(){const complimentary=$('licenseComplimentary').checked;$('licenseAmount').disabled=complimentary;$('licenseBillingDueDate').disabled=complimentary;if(complimentary)$('licenseAmount').value='0.00';}
function toggleBillingCycle(){const cycle=$('licenseBillingCycle').value;$('licenseCustomDays').classList.toggle('hidden',cycle!=='custom');if(cycle==='monthly'){$('licenseDays').value=30;$('licenseBillingDueDate').value=addLocalMonthsIso(1);}else if(cycle==='quarterly'){$('licenseDays').value=90;$('licenseBillingDueDate').value=addLocalMonthsIso(3);}else if(cycle==='annual'){$('licenseDays').value=365;$('licenseBillingDueDate').value=addLocalMonthsIso(12);}else if(cycle==='perpetual')$('licenseBillingDueDate').value='';}

async function openBilling(id){
  const installation=installations.find(item=>item.id===id),license=(installation?.licenses||[]).find(item=>item.status==='active');if(!installation||!license){showToast('Esta instalação não possui licença ativa.',true);return;}
  editingBilling={installation,license,charges:[]};const academy=installation.academies||{};$('billingAcademy').textContent=academy.name||'Academia';$('billingAcademyName').value=academy.name||'';$('billingAcademyCnpj').value=academy.cnpj||'';$('billingAcademyLegalName').value=academy.legal_name||'';$('billingAcademyPhone').value=academy.phone||'';$('billingAcademyEmail').value=academy.email||'';$('billingTechnicalValidity').textContent=`Validade técnica: ${formatDate(license.expires_at)}`;renderPartnerOptions();$('billingPartner').value=license.partner_id||'';$('billingEditCycle').value=license.billing_cycle||'custom';$('billingEditAmount').value=(Number(license.billing_amount_cents||0)/100).toFixed(2);$('billingEditDueDate').value=license.billing_due_date||'';$('billingEditStatus').value=['pending','paid','waived','cancelled'].includes(license.billing_status)?license.billing_status:(Number(license.billing_amount_cents)>0?'pending':'waived');$('billingEditCollectionMode').value=license.billing_collection_mode||'manual';$('billingEditNoticeEnabled').checked=license.billing_notice_enabled!==false;$('billingEditNoticeDays').value=license.billing_notice_days??3;$('billingEditChannel').value=license.billing_notification_channel||'none';$('billingEditEnforcementMode').value=license.billing_enforcement_mode||'manual';$('billingEditGraceDays').value=license.billing_grace_days??3;$('billingEmailButton').disabled=!emailProviderConfigured||!academy.email||Number(license.billing_amount_cents)<=0||!license.billing_due_date;toggleBillingAutomation();$('billingEditError').textContent='';$('billingHistoryList').innerHTML='<div class="billing-empty">Carregando histórico...</div>';$('billingModal').classList.remove('hidden');$('billingEditCycle').focus();
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
  try{const identity={name:$('billingAcademyName').value.trim(),cnpj:$('billingAcademyCnpj').value.replace(/\D/g,'').slice(0,14)||null,legal_name:$('billingAcademyLegalName').value.trim()||null,phone:$('billingAcademyPhone').value.trim()||null,email:$('billingAcademyEmail').value.trim().toLowerCase()||null,updated_at:new Date().toISOString()};if(!identity.name){throw new Error('Informe o nome da academia.');}await api(`/rest/v1/academies?id=eq.${encodeURIComponent(editingBilling.installation.academy_id)}`,{method:'PATCH',body:identity});const partnerId=$('billingPartner').value||null;await api(`/rest/v1/licenses?id=eq.${encodeURIComponent(editingBilling.license.id)}`,{method:'PATCH',body:{partner_id:partnerId,billing_payer:partnerId?'partner':'academy'}});const result=await api('/functions/v1/license-billing-update',{method:'POST',body:billingPayload(editingBilling.license,{billingCycle:$('billingEditCycle').value,billingAmountCents:Math.round(amount*100),billingDueDate:amount>0?dueDate:null,billingStatus:amount>0?status:'waived',billingCollectionMode:$('billingEditCollectionMode').value,billingNoticeEnabled:$('billingEditNoticeEnabled').checked,billingNoticeDays:noticeDays,billingNotificationChannel:$('billingEditChannel').value,billingEnforcementMode:$('billingEditEnforcementMode').value,billingGraceDays:graceDays})});editingBilling=null;$('billingModal').classList.add('hidden');showToast(result.renewed?'Pagamento registrado e próximo vencimento gerado.':'Dados da academia, plano, avisos e automações atualizados.');await loadInstallations();}catch(error){$('billingEditError').textContent=error.message;}finally{savingBilling=false;$('billingSaveButton').disabled=false;$('billingSaveButton').textContent='Salvar plano e cobrança';}
}

async function issue(){
  if(issuing||!selected)return;issuing=true;$('issueButton').disabled=true;$('issueButton').textContent='Gerando com segurança...';$('modalError').textContent='';
  try{
    const complimentary=$('licenseComplimentary').checked,amount=Number($('licenseAmount').value||0),dueDate=$('licenseBillingDueDate').value,billingCycle=$('licenseBillingCycle').value;
    if(!complimentary&&amount<=0)throw new Error('Informe um valor maior que zero ou marque como cortesia.');
    if(!complimentary&&!dueDate)throw new Error('Informe o vencimento da cobrança.');
    const data=await api('/functions/v1/license-issue',{method:'POST',body:{installationId:selected.id,days:Math.max(1,Math.min(3650,Number($('licenseDays').value||365))),perpetual:billingCycle==='perpetual',billingCycle,partnerId:$('licensePartner').value||null,notes:$('licenseNotes').value.slice(0,500),complimentary,billingAmountCents:complimentary?0:Math.round(amount*100),billingDueDate:complimentary?null:dueDate}});
    $('licenseToken').value=data.token;$('licenseResult').classList.remove('hidden');renderLicenseQrCode(data.token);showToast('Licença emitida com sucesso.');await loadInstallations();
  }catch(error){$('modalError').textContent=error.message;}
  finally{issuing=false;$('issueButton').disabled=false;$('issueButton').textContent='Gerar contrassenha';}
}

async function markPaid(chargeId){
  if(!confirm('Confirmar o recebimento desta cobrança?'))return;
  const item=delinquencies.find(entry=>entry.charge.id===chargeId);
  try{if(!item)throw new Error('Cobrança não encontrada.');const result=await api('/functions/v1/license-billing-update',{method:'POST',body:{action:'mark_charge_paid',chargeId}});showToast(result.reactivated?'Pagamento confirmado e sistema reativado automaticamente.':result.renewed?'Cobrança paga e próximo vencimento gerado.':result.historical?'Cobrança histórica marcada como paga.':'Cobrança marcada como paga.');await loadInstallations();}catch(error){showToast(error.message==='charge_not_payable'?'Esta cobrança não está mais aberta para pagamento.':error.message,true);}
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
  const rows=[['Nome','CNPJ','Razão Social','Número WhatsApp','E-mail','Data Vencimento','Valor'],...delinquencies.map(({charge,academy})=>[academy.name||'',academy.cnpj||'',academy.legal_name||'',academy.phone||'',academy.email||'',formatDateOnly(charge.due_date),formatMoneyCents(charge.amount_cents)])];
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
async function deleteLicense(id){
  if(!id||!confirm('Excluir esta licença e seu histórico de cobranças? A instalação permanecerá cadastrada para receber uma nova licença.'))return;
  try{await api(`/rest/v1/licenses?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});showToast('Licença excluída.');await loadInstallations();}
  catch(error){showToast(`Não foi possível excluir a licença: ${error.message}`,true);}
}

$('loginForm').addEventListener('submit',login);$('logoutButton').addEventListener('click',logout);$('refreshButton').addEventListener('click',loadInstallations);$('exportDelinquency').addEventListener('click',exportDelinquencies);$('search').addEventListener('input',render);$('statusFilter').addEventListener('change',render);$('financeMonth').addEventListener('change',()=>loadFinancialCharges().catch(error=>showToast(error.message,true)));$('editTemplatesButton').addEventListener('click',openTemplateModal);$('templateSelect').addEventListener('change',fillTemplateForm);$('templateSaveButton').addEventListener('click',saveMessageTemplate);$('installationList').addEventListener('click',event=>{if(event.target.dataset.issue)openLicense(event.target.dataset.issue);if(event.target.dataset.billing)openBilling(event.target.dataset.billing);if(event.target.dataset.id)setStatus(event.target.dataset.id,event.target.dataset.status);if(event.target.dataset.licenseDelete)deleteLicense(event.target.dataset.licenseDelete);});$('delinquencyList').addEventListener('click',event=>{if(event.target.dataset.email)sendBillingEmail(event.target.dataset.email);if(event.target.dataset.paid)markPaid(event.target.dataset.paid);});document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',closeLicense));document.querySelectorAll('[data-close-billing]').forEach(button=>button.addEventListener('click',closeBilling));document.querySelectorAll('[data-close-template]').forEach(button=>button.addEventListener('click',closeTemplateModal));$('issueButton').addEventListener('click',issue);$('billingSaveButton').addEventListener('click',saveBilling);$('billingEmailButton').addEventListener('click',()=>editingBilling&&sendBillingEmail(editingBilling.license.id));$('copyToken').addEventListener('click',copyToken);$('licenseComplimentary').addEventListener('change',toggleComplimentary);$('licenseBillingCycle').addEventListener('change',toggleBillingCycle);document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!$('licenseModal').classList.contains('hidden'))closeLicense();if(!$('billingModal').classList.contains('hidden'))closeBilling();if(!$('templateModal').classList.contains('hidden'))closeTemplateModal();}});
$('billingEditNoticeEnabled').addEventListener('change',toggleBillingAutomation);
$('financePartnerFilter').addEventListener('change',renderFinancialSummary);
$('printPartnerReport').addEventListener('click',()=>{const id=$('financePartnerFilter').value;if(!id||id==='direct'){showToast('Selecione um parceiro para gerar o PDF separado.',true);return;}printPartnerReport(id);});
$('newPartnerButton').addEventListener('click',()=>openPartnerModal());
$('partnersList').addEventListener('click',event=>{const edit=event.target.closest('[data-partner-edit]'),report=event.target.closest('[data-partner-report]');if(edit)openPartnerModal(edit.dataset.partnerEdit);if(report)printPartnerReport(report.dataset.partnerReport);});
document.querySelectorAll('[data-close-partner]').forEach(button=>button.addEventListener('click',closePartnerModal));
$('partnerSaveButton').addEventListener('click',savePartner);
$('billingEditEnforcementMode').addEventListener('change',toggleBillingAutomation);
$('toggleUpdatePublisher').addEventListener('click',()=>toggleUpdatePublisher(true));
$('cancelUpdatePublisher').addEventListener('click',()=>toggleUpdatePublisher(false));
$('updatePublisher').addEventListener('submit',publishUpdate);
$('updateManualDelivery').addEventListener('change',event=>{const manual=event.target.checked;$('updateInstaller').required=!manual;$('updateInstaller').disabled=manual;$('updatePublishStatus').textContent=manual?'O cliente verá o aviso e solicitará a atualização ao suporte. Nenhum arquivo será enviado.':'O arquivo ficará privado e será conferido por SHA-256 antes da instalação.';});
$('outdatedClients').addEventListener('click',event=>{const button=event.target.closest('[data-update-auto]');if(button)toggleClientAutomaticUpdate(button.dataset.updateAuto,button.dataset.enabled==='true');});
$('activeReleases').addEventListener('click',event=>{const button=event.target.closest('[data-release-action]');if(button)manageRelease(button.dataset.releaseAction,button.dataset.releaseId);});
$('releaseHistory').addEventListener('click',event=>{const button=event.target.closest('[data-release-action]');if(button)manageRelease(button.dataset.releaseAction,button.dataset.releaseId);});
$('financeRecent').addEventListener('click',event=>{const edit=event.target.closest('[data-revenue-edit]'),remove=event.target.closest('[data-revenue-delete]');if(edit)manageRevenue('edit',edit.dataset.revenueEdit);if(remove)manageRevenue('delete',remove.dataset.revenueDelete);});
$('clientTabs').addEventListener('click',event=>{const button=event.target.closest('[data-client-view]');if(!button)return;clientView=button.dataset.clientView;document.querySelectorAll('[data-client-view]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-selected',String(active));});render();});
$('scanInstallationQr').addEventListener('click',openInstallationQrScanner);document.querySelectorAll('[data-close-scan-qr]').forEach(button=>button.addEventListener('click',closeInstallationQrScanner));

const panelForTarget={metrics:'overview',installationList:'licenses',billingTitle:'billing',templatePanelTitle:'communication',updatePanelTitle:'updates',financeOverviewTitle:'revenue',partnersTitle:'partners'};
function switchCentralPanel(panel){
  centralPanel=panel;
  document.querySelectorAll('[data-central-panel]').forEach(item=>item.classList.toggle('central-hidden',item.dataset.centralPanel!==panel));
  document.querySelectorAll('.nav-item,.mobile-navigation button').forEach(item=>item.classList.toggle('active',panelForTarget[item.dataset.scrollTarget]===panel));
  document.querySelectorAll('[data-section-target]').forEach(item=>item.classList.toggle('active',panelForTarget[item.dataset.sectionTarget]===panel));
  window.scrollTo({top:0,behavior:'smooth'});
}

function openPartnerModal(id=''){
  const partner=partners.find(item=>item.id===id)||null;$('partnerId').value=partner?.id||'';$('partnerModalTitle').textContent=partner?'Editar parceiro':'Novo parceiro';$('partnerName').value=partner?.name||'';$('partnerCnpj').value=partner?.cnpj||'';$('partnerDefaultAmount').value=(Number(partner?.default_amount_cents??7000)/100).toFixed(2);$('partnerResponsible').value=partner?.responsible_name||'';$('partnerPhone').value=partner?.phone||'';$('partnerEmail').value=partner?.email||'';$('partnerNotes').value=partner?.notes||'';$('partnerActive').checked=partner?.active!==false;$('partnerError').textContent='';$('partnerModal').classList.remove('hidden');$('partnerName').focus();
}
function closePartnerModal(){$('partnerModal').classList.add('hidden');}
async function savePartner(){
  const name=$('partnerName').value.trim(),amount=Number($('partnerDefaultAmount').value||0);$('partnerError').textContent='';if(!name){$('partnerError').textContent='Informe o nome do parceiro.';return;}if(!Number.isFinite(amount)||amount<0){$('partnerError').textContent='Informe um valor padrão válido.';return;}
  const body={name,cnpj:$('partnerCnpj').value.replace(/\D/g,'').slice(0,14)||null,default_amount_cents:Math.round(amount*100),responsible_name:$('partnerResponsible').value.trim()||null,phone:$('partnerPhone').value.trim()||null,email:$('partnerEmail').value.trim().toLowerCase()||null,notes:$('partnerNotes').value.trim()||null,active:$('partnerActive').checked,updated_at:new Date().toISOString()},button=$('partnerSaveButton');button.disabled=true;
  try{const id=$('partnerId').value;if(id)await api(`/rest/v1/license_partners?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body});else await api('/rest/v1/license_partners',{method:'POST',body});closePartnerModal();showToast('Parceiro salvo.');await loadInstallations();}catch(error){$('partnerError').textContent=error.message;}finally{button.disabled=false;}
}
function decodeInstallationQr(value){const payload=String(value||'').trim();if(!payload.startsWith('FITNEXUS:INSTALL:'))throw new Error('Este não é um QR Code de instalação FitNexus.');const serial=payload.slice('FITNEXUS:INSTALL:'.length);const normalized=serial.replace(/-/g,'+').replace(/_/g,'/');const decoded=decodeURIComponent(Array.prototype.map.call(atob(normalized+'='.repeat((4-normalized.length%4)%4)),char=>`%${(`00${char.charCodeAt(0).toString(16)}`).slice(-2)}`).join(''));const [installationId]=decoded.split('|');if(!/^[0-9a-f-]{36}$/i.test(installationId))throw new Error('QR Code de instalação inválido.');return installationId;}
async function openInstallationQrScanner(){if(!window.ZXing){showToast('Leitor de QR ainda está carregando. Tente novamente.',true);return;}$('scanQrError').textContent='';$('scanQrModal').classList.remove('hidden');try{installationQrReader=new ZXing.BrowserQRCodeReader();await installationQrReader.decodeFromVideoDevice(null,$('scanQrVideo'),result=>{if(!result)return;try{const installationId=decodeInstallationQr(result.getText());const item=installations.find(row=>row.installation_id===installationId);if(!item)throw new Error('Instalação ainda não apareceu na Central. No computador do cliente, clique em “Verificar novamente” e tente de novo.');closeInstallationQrScanner();openLicense(item.id);}catch(error){$('scanQrError').textContent=error.message;}});}catch(error){$('scanQrError').textContent=`Não foi possível abrir a câmera: ${error.message}`;}}
function closeInstallationQrScanner(){try{installationQrReader?.reset();}catch(_){}installationQrReader=null;const video=$('scanQrVideo');if(video?.srcObject)video.srcObject.getTracks().forEach(track=>track.stop());if(video)video.srcObject=null;$('scanQrModal').classList.add('hidden');}
function renderLicenseQrCode(token){const target=$('licenseQrCode');if(!target)return;target.innerHTML='';if(!window.QRCode){target.textContent='QR Code indisponível. Use a chave abaixo.';return;}new QRCode(target,{text:token,width:196,height:196,colorDark:'#111827',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.L});}
document.querySelectorAll('[data-scroll-target]').forEach(button=>button.addEventListener('click',()=>switchCentralPanel(panelForTarget[button.dataset.scrollTarget]||'overview')));
document.querySelectorAll('[data-section-target]').forEach(button=>button.addEventListener('click',()=>switchCentralPanel(panelForTarget[button.dataset.sectionTarget]||'overview')));
switchCentralPanel(centralPanel);

$('financeMonth').value=currentMonthIso();
(async()=>{try{const saved=sessionStorage.getItem(SESSION_KEY);if(!saved)return;session=JSON.parse(saved);await ensureAdmin();openDashboard();await loadInstallations();}catch(_){logout();}})();
