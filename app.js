'use strict';
const API='https://pvfvbosolqpqbmocwyrw.supabase.co/functions/v1/family-trip';
const KEY='jejuTripPWA_v1', INVITE_KEY='jejuFamilyInvite_v1';
const $=id=>document.getElementById(id);
const {copy,equal,merge,SyncEngine,packingOf}=FamilySync;
const read=key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{$('storageWarning').hidden=false;return false;}}
function validDocument(d){return d&&Array.isArray(d.days)&&d.days.length&&d.days.every(x=>typeof x.id==='string'&&Array.isArray(x.items));}
function loadLocal(){
  const saved=read(KEY);if(!validDocument(saved))return copy(DEFAULT_DATA);
  for(const day of DEFAULT_DATA.days)if(!saved.days.some(d=>d.id===day.id))saved.days.push(copy(day));
  return saved;
}
const legacy=loadLocal();
const fragment=new URLSearchParams(location.hash.slice(1));
const supplied=fragment.get('family');
let familyKey=supplied!==null?supplied:read(INVITE_KEY);
if(!/^[a-f0-9]{64}$/.test(familyKey||''))familyKey=null;
if(familyKey)write(INVITE_KEY,familyKey);
const CACHE_KEY=familyKey?'jejuFamilyCache_v1:'+familyKey:null;
let cached=familyKey?read(CACHE_KEY):null;
if(!cached||!validDocument(cached.base)||!validDocument(cached.document)||!Number.isInteger(cached.version))cached=null;
let data=familyKey?(cached?copy(cached.document):{days:[]}):legacy;
let active='packing', editing=null, engine=null, deferredImport=false;
const dlg=$('editDialog'), conflictDialog=$('conflictDialog'), packDlg=$('packDialog');
let packEditing=null;
const s=$('startInput'),e=$('endInput'),t=$('titleInput'),m=$('detailInput');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const uid=()=>crypto.randomUUID();
const pct=items=>items.length?Math.round(items.filter(i=>i.done).length/items.length*100):0;
function render(){
  if(active!=='packing'&&!data.days.some(d=>d.id===active))active='packing';
  $('tabs').innerHTML=`<button class="tab ${active==='packing'?'active':''}" aria-pressed="${active==='packing'}" data-id="packing">준비물</button>`+data.days.map(d=>`<button class="tab ${active===d.id?'active':''}" aria-pressed="${active===d.id}" data-id="${esc(d.id)}">${esc(d.label)}</button>`).join('');
  $('tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{active=b.dataset.id;render();});
  if(active==='packing'&&data.days.length){renderPacking();return;}
  $('overallLabel').textContent='여행 일정 진척도';
  const day=data.days.find(d=>d.id===active);
  if(!day){$('content').innerHTML='<p class="smallnote">가족 일정을 불러오는 중입니다. 연결 상태를 확인해 주세요.</p>';return;}
  const items=[...day.items].sort((a,b)=>(a.start||'99:99').localeCompare(b.start||'99:99')||(a.end||'').localeCompare(b.end||''));
  const disabled=familyKey&&(!engine?.ready||engine?.errorStatus===401||!!engine?.pending);
  $('content').innerHTML=`<section class="daycard"><div class="dayhead"><div><h2>${esc(day.label)}</h2><div class="daymeta">${esc(day.subtitle||'')}</div></div><span class="dayprogress">${pct(items)}%</span></div>
    ${items.map(i=>`<div class="item ${i.done?'done':''}"><input type="checkbox" data-check="${esc(i.id)}" aria-label="${esc(i.title)} 완료" ${i.done?'checked':''} ${disabled?'disabled':''}><div class="time">${i.start?esc(i.start)+'<br>~ '+esc(i.end):'시간 미정'}</div><div><div class="title">${esc(i.title)}</div>${i.detail?`<div class="detail">${esc(i.detail)}</div>`:''}</div><button class="iconbtn" data-edit="${esc(i.id)}" aria-label="${esc(i.title)} 수정" ${disabled?'disabled':''}>✎</button></div>`).join('')}
    <button class="addbtn" id="addBtn" ${disabled?'disabled':''}>＋ 일정 추가</button></section>`;
  $('content').querySelectorAll('[data-check]').forEach(cb=>cb.onchange=()=>{
    const base=copy(data),next=copy(data);next.days.find(d=>d.id===day.id).items.find(i=>i.id===cb.dataset.check).done=cb.checked;applyChange(base,next);
  });
  $('content').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(day.id,b.dataset.edit));
  $('addBtn').onclick=()=>openEditor(day.id);
  const progress=pct(data.days.flatMap(d=>d.items));$('overallText').textContent=progress+'%';$('overallBar').style.width=progress+'%';
}
function renderPacking(){
  const groups=packingOf(data).groups,items=groups.flatMap(g=>g.items),done=items.filter(i=>i.done).length;
  const disabled=familyKey&&(!engine?.ready||engine?.errorStatus===401||!!engine?.pending);
  $('overallLabel').textContent='준비물 챙김';$('overallText').textContent=done+' / '+items.length+'개';$('overallBar').style.width=pct(items)+'%';
  $('content').innerHTML=`<div class="packing-head"><div><h2>준비물</h2><p>챙긴 물건을 체크해 주세요.</p></div><button class="btn" id="addPackGroup" ${disabled?'disabled':''}>＋ 그룹 추가</button></div>`+
    groups.map(g=>`<section class="daycard"><div class="pack-group-head"><h3>${esc(g.name)}</h3><span class="dayprogress">${g.items.filter(i=>i.done).length} / ${g.items.length}</span><button class="iconbtn" data-pack-group="${esc(g.id)}" aria-label="${esc(g.name)} 그룹 수정" ${disabled?'disabled':''}>✎</button></div>
      ${g.items.length?g.items.map(i=>`<div class="pack-item ${i.done?'done':''}"><input type="checkbox" id="check-${esc(i.id)}" data-pack-check="${esc(i.id)}" data-group="${esc(g.id)}" ${i.done?'checked':''} ${disabled?'disabled':''}><label for="check-${esc(i.id)}">${esc(i.title)}</label><button class="iconbtn" data-pack-edit="${esc(i.id)}" data-group="${esc(g.id)}" aria-label="${esc(i.title)} 준비물 수정" ${disabled?'disabled':''}>✎</button></div>`).join(''):'<p class="pack-empty">이 그룹에 준비물을 추가해 주세요.</p>'}
      <button class="addbtn" data-pack-add="${esc(g.id)}" ${disabled?'disabled':''}>＋ 준비물 추가</button></section>`).join('')+
    (!groups.length?'<p class="pack-empty">그룹을 추가해 준비물을 정리해 보세요.</p>':'');
  $('addPackGroup').onclick=()=>openPack('group');
  $('content').querySelectorAll('[data-pack-group]').forEach(b=>b.onclick=()=>openPack('group',b.dataset.packGroup));
  $('content').querySelectorAll('[data-pack-add]').forEach(b=>b.onclick=()=>openPack('item',b.dataset.packAdd));
  $('content').querySelectorAll('[data-pack-edit]').forEach(b=>b.onclick=()=>openPack('item',b.dataset.group,b.dataset.packEdit));
  $('content').querySelectorAll('[data-pack-check]').forEach(cb=>cb.onchange=()=>{
    const base=copy(data),next=copy(data);next.packing=copy(packingOf(data));
    next.packing.groups.find(g=>g.id===cb.dataset.group).items.find(i=>i.id===cb.dataset.packCheck).done=cb.checked;applyChange(base,next);
  });
}
function openPack(kind,groupId,itemId){
  const groups=packingOf(data).groups,group=groups.find(g=>g.id===groupId),item=group?.items.find(i=>i.id===itemId);
  if(kind==='group'&&!group&&groups.length>=30){alert('그룹은 30개까지 추가할 수 있습니다.');return;}
  if(kind==='item'&&!item&&group.items.length>=200){alert('그룹당 준비물은 200개까지 추가할 수 있습니다.');return;}
  packEditing={kind,groupId,itemId,base:copy(data)};
  $('packDialogTitle').textContent=kind==='group'?(group?'그룹 수정':'그룹 추가'):(item?'준비물 수정':group.name+' · 준비물 추가');
  $('packNameLabel').textContent=kind==='group'?'그룹명':'준비물명';
  $('packName').maxLength=kind==='group'?100:300;$('packName').value=kind==='group'?(group?.name||''):(item?.title||'');
  $('packName').placeholder=kind==='group'?'예: 아윤이짐, 공통':'예: 칫솔 3개';$('packName').setCustomValidity('');
  $('packDelete').hidden=kind==='group'?!group:!item;packDlg.showModal();
}
$('packCancel').onclick=()=>packDlg.close();
$('packName').oninput=()=>$('packName').setCustomValidity('');
$('packForm').addEventListener('submit',event=>{
  event.preventDefault();if(!packEditing)return;
  const name=$('packName').value.trim();if(!name){$('packName').setCustomValidity('이름을 입력해 주세요.');$('packName').reportValidity();return;}
  const {kind,groupId,itemId,base}=packEditing,next=copy(base);next.packing=copy(packingOf(base));
  const group=next.packing.groups.find(g=>g.id===groupId);
  if(kind==='group'){if(group)group.name=name;else next.packing.groups.push({id:uid(),name,items:[]});}
  else if(itemId)group.items.find(i=>i.id===itemId).title=name;
  else group.items.push({id:uid(),title:name,done:false});
  packDlg.close();applyChange(base,next);
});
$('packDelete').onclick=()=>{
  if(!packEditing)return;const {kind,groupId,itemId,base}=packEditing;
  if(!confirm(kind==='group'?'이 그룹과 안에 있는 준비물을 모두 삭제할까요? 가족에게도 반영됩니다.':'이 준비물을 삭제할까요? 가족에게도 반영됩니다.'))return;
  const next=copy(base);next.packing=copy(packingOf(base));
  if(kind==='group')next.packing.groups=next.packing.groups.filter(g=>g.id!==groupId);
  else{const group=next.packing.groups.find(g=>g.id===groupId);group.items=group.items.filter(i=>i.id!==itemId);}
  packDlg.close();applyChange(base,next);
};
function persistEngine(){
  const snapshot=engine.snapshot();if(!snapshot)return;
  // A clean tab must not erase an unsent draft left by another tab on this device.
  const prior=read(CACHE_KEY);
  if(!engine.dirty&&prior&&validDocument(prior.base)&&validDocument(prior.document)&&!equal(prior.base,prior.document)){
    const combined=merge(prior.base,prior.document,snapshot.document);
    if(combined.conflicts.length||!equal(combined.document,snapshot.document))return;
  }
  write(CACHE_KEY,snapshot);
}
function updateStatus(){
  if(!engine){$('syncStatus').textContent=supplied!==null&&!familyKey?'가족용 링크가 올바르지 않습니다.':'이 기기에 저장 중 · 가족 연결 전';return;}
  const status=$('syncStatus');status.classList.toggle('problem',['offline','unauthorized','conflict'].includes(engine.status));
  const time=engine.updatedAt?new Date(engine.updatedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):'';
  if(engine.pending)status.textContent='함께 수정한 내용을 확인해 주세요.';
  else if(engine.status==='unauthorized')status.textContent='가족용 링크를 확인할 수 없습니다. 올바른 링크로 다시 연결해 주세요.';
  else if(engine.errorStatus===400||engine.errorStatus===413)status.textContent='수정 내용을 저장하지 못했습니다. 일정 개수와 입력 길이를 확인해 주세요.';
  else if(engine.status==='offline')status.textContent=engine.dirty?'연결 대기 · 이 기기에 수정 보관 중, 다시 연결되면 전송합니다.':'연결 대기 · 저장된 일정을 표시하고 있습니다.';
  else if(engine.dirty)status.textContent=engine.busy?'가족 일정에 저장 중…':'전송 대기 · 이 기기에 수정 보관 중';
  else if(!engine.ready)status.textContent='가족 일정을 불러오는 중…';
  else status.textContent='가족 일정 · 저장 완료'+(time?' '+time:'');
  $('refreshBtn').disabled=engine.busy||!!engine.pending;
  $('shareBtn').textContent=engine.errorStatus===401?'가족 링크 다시 연결':'가족에게 공유';
  $('importBtn').hidden=!engine.ready||!!engine.pending||engine.errorStatus===401||equal(legacy,DEFAULT_DATA)||!!read('jejuFamilyImported:'+familyKey);
}
function conflictValue(value){if(value===null)return '삭제';if(typeof value==='object'){if(value.name)return value.name+' ('+value.items.length+'개 준비물)';if(value.start===undefined)return value.title+' · '+(value.done?'챙김':'미챙김');return value.title+' / '+value.start+'~'+value.end+' / '+value.detail;}if(typeof value==='boolean')return value?'완료':'미완료';return value||'(비어 있음)';}
function showConflicts(conflicts){
  const names={name:'그룹명',start:'시작시각',end:'종료시각',title:'일정명',detail:'메모',done:'완료 체크'};
  $('conflictList').innerHTML=conflicts.map(c=>`<div class="conflictitem"><strong>${esc(c.title)} · ${esc(names[c.field]||c.field)}</strong><p>내 수정: ${esc(conflictValue(c.mine))}</p><p>가족 수정: ${esc(conflictValue(c.theirs))}</p></div>`).join('');
  if(!conflictDialog.open)conflictDialog.showModal();updateStatus();
}
function applyChange(base,next){
  if(engine){if(engine.edit(base,next))void engine.run();}
  else{data=next;write(KEY,data);render();}
}
function openEditor(dayId,itemId){
  const day=data.days.find(d=>d.id===dayId),item=day.items.find(i=>i.id===itemId);
  if(!item&&day.items.length>=200){alert('하루 일정은 200개까지 저장할 수 있습니다.');return;}
  editing={dayId,itemId,base:copy(data)};
  $('modalTitle').textContent=item?'일정 수정':'새 일정 추가';
  s.value=item?.start||'';e.value=item?.end||'';t.value=item?.title||'';m.value=item?.detail||'';
  $('deleteBtn').hidden=!item;dlg.showModal();
}
$('cancelBtn').onclick=()=>dlg.close();
$('editForm').addEventListener('submit',event=>{
  event.preventDefault();if(!editing)return;
  if(!t.value.trim()){t.setCustomValidity('일정명을 입력해 주세요.');t.reportValidity();return;}t.setCustomValidity('');
  if(Boolean(s.value)!==Boolean(e.value)){alert('시작과 종료시각을 함께 입력하거나 둘 다 비워 주세요.');return;}
  if(e.value<s.value){alert('종료시각이 시작시각보다 빠릅니다.');return;}
  const next=copy(editing.base),day=next.days.find(d=>d.id===editing.dayId);
  const values={start:s.value,end:e.value,title:t.value.trim(),detail:m.value.trim()};
  if(editing.itemId)Object.assign(day.items.find(i=>i.id===editing.itemId),values);
  else day.items.push({id:uid(),...values,done:false});
  const base=editing.base;dlg.close();applyChange(base,next);
});
t.oninput=()=>t.setCustomValidity('');
$('deleteBtn').onclick=()=>{
  if(!editing?.itemId||!confirm('이 일정을 삭제할까요? 가족에게도 반영됩니다.'))return;
  const next=copy(editing.base),day=next.days.find(d=>d.id===editing.dayId);day.items=day.items.filter(i=>i.id!==editing.itemId);
  const base=editing.base;dlg.close();applyChange(base,next);
};
conflictDialog.addEventListener('cancel',event=>event.preventDefault());
for(const [id,choice] of [['keepMine','mine'],['keepFamily','family']])$(id).onclick=()=>{
  engine.resolve(choice);conflictDialog.close();if(deferredImport){write('jejuFamilyImported:'+familyKey,true);deferredImport=false;}void engine.run();
};
$('importBtn').onclick=()=>{
  if(!confirm('이 기기에 저장된 이전 변경사항을 가족 일정에 합칠까요? 겹치는 수정은 직접 선택할 수 있습니다.'))return;
  deferredImport=true;
  if(engine.edit(DEFAULT_DATA,legacy)){write('jejuFamilyImported:'+familyKey,true);deferredImport=false;void engine.run();}
};
function familyURL(){const url=new URL(location.href);url.search='';url.hash='family='+familyKey;return url.href;}
$('shareBtn').onclick=()=>{
  if(!familyKey||engine?.errorStatus===401){$('joinDialog').showModal();return;}
  $('shareLink').value=familyURL();$('shareFeedback').textContent='';$('sendLink').hidden=!navigator.share;$('shareDialog').showModal();
};
$('shareClose').onclick=()=>$('shareDialog').close();
$('copyLink').onclick=async()=>{
  try{await navigator.clipboard.writeText(familyURL());$('shareFeedback').textContent='링크를 복사했습니다. 가족에게 붙여 넣어 보내 주세요.';}
  catch{$('shareLink').focus();$('shareLink').select();$('shareFeedback').textContent='링크를 길게 눌러 복사해 주세요.';}
};
$('sendLink').onclick=async()=>{try{await navigator.share({title:'제주 가족여행 플래너',text:'우리 가족의 제주 여행 일정입니다. 함께 수정할 수 있어요.',url:familyURL()});}catch(error){if(error.name!=='AbortError')$('shareFeedback').textContent='공유 창을 열지 못했습니다. 링크 복사를 이용해 주세요.';}};
$('joinClose').onclick=()=>$('joinDialog').close();
$('joinForm').addEventListener('submit',event=>{
  event.preventDefault();
  try{
    const url=new URL($('inviteInput').value.trim());const token=new URLSearchParams(url.hash.slice(1)).get('family');
    if(url.origin!==location.origin||url.pathname!==location.pathname||!/^[a-f0-9]{64}$/.test(token||''))throw Error();
    location.hash='family='+token;
  }catch{$('joinError').textContent='받으신 가족용 링크 전체를 확인해 주세요.';}
});
window.addEventListener('hashchange',()=>location.reload());
async function request(method,body){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(API,{method,headers:{'Content-Type':'application/json','x-family-key':familyKey},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:controller.signal});
    if(!response.ok){const error=new Error('request');error.status=response.status;throw error;}
    const result=await response.json();if(!validDocument(result.document)||!Number.isInteger(result.version))throw Error('response');return result;
  }finally{clearTimeout(timer);}
}
if(familyKey){
  engine=new SyncEngine({request,cached,onChange:()=>{data=engine.document;persistEngine();render();updateStatus();},onConflict:showConflicts});
  $('refreshBtn').hidden=false;$('refreshBtn').onclick=()=>void engine.run();
  $('modeNote').textContent='가족이 바꾼 내용을 약 8초마다 확인합니다. 연결이 끊기면 수정사항을 이 기기에 보관합니다.';
  void engine.run();
  setInterval(()=>{if(!document.hidden&&!dlg.open&&!packDlg.open)void engine.run();},8000);
  window.addEventListener('online',()=>void engine.run());
  window.addEventListener('focus',()=>{if(!dlg.open&&!packDlg.open)void engine.run();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!dlg.open&&!packDlg.open)void engine.run();});
}else{$('shareBtn').textContent='가족 링크 연결';$('modeNote').textContent='가족용 링크로 한 번 연결하면 같은 일정을 함께 수정할 수 있습니다.';}
window.addEventListener('beforeunload',event=>{if(engine?.dirty||dlg.open||packDlg.open){event.preventDefault();event.returnValue='';}});
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(!dlg.open&&!packDlg.open&&!conflictDialog.open&&!engine?.dirty)location.reload();else $('updateNotice').hidden=false;
  });
  window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').then(r=>r.update()).catch(()=>{}));
}
render();updateStatus();
