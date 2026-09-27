'use strict';
const PUSH_API=API.replace(/family-trip$/,'family-push');
const DEVICE_KEY='jejuPushDevice_v1';
let pushIdentity=read(DEVICE_KEY),pushConfig=null,pushBusy=false;
if(!pushIdentity){pushIdentity={token:[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('')};write(DEVICE_KEY,pushIdentity);}
async function pushRequest(method='GET',body){
 const response=await fetch(PUSH_API,{method,headers:{'Content-Type':'application/json','x-family-key':familyKey||'','x-device-token':pushIdentity.token},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),cache:'no-store'});
 const result=await response.json();if(!response.ok)throw new Error(({invalid_code:'가족 알림 등록 코드를 확인해 주세요.',device_limit:'등록 가능한 기기 2대가 모두 사용 중입니다. 기기 관리에서 이전 기기를 해제해 주세요.',invalid_invite:'먼저 가족용 링크로 연결해 주세요.',invalid_subscription:'이 브라우저의 알림 수신 정보를 등록하지 못했습니다.'})[result.error]||'연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');return result;
}
function pushSupport(){
 if(!familyKey)return '먼저 가족용 링크로 여행 일정에 연결해 주세요.';
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 if(ios&&!matchMedia('(display-mode: standalone)').matches&&!navigator.standalone)return '아이폰에서는 Safari 공유 → 홈 화면에 추가 후, 홈 화면 아이콘으로 실행해 주세요.';
 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))return '이 브라우저는 웹 알림을 지원하지 않습니다. 최신 Safari 또는 Chrome을 사용해 주세요.';
 if(Notification.permission==='denied')return '알림이 차단되어 있습니다. 휴대폰 설정에서 이 앱의 알림을 허용해 주세요.';
 return '';
}
async function refreshPush(){
 const reason=pushSupport();$('pushEnable').disabled=!!reason;
 if(reason)$('pushStatus').textContent=reason;
 if(!familyKey)return;
 try{pushConfig=await pushRequest();$('pushDisable').hidden=!pushConfig.registered;$('pushEnable').textContent=pushConfig.registered?'알림 연결 복구':'이 기기에서 알림 받기';
 if(!reason)$('pushStatus').textContent=pushConfig.registered?'이 기기 알림 켜짐 · 일정 시작 10분 전':'이 기기의 알림을 등록해 주세요. 가족 등록 코드가 필요합니다.';
 }catch(error){$('pushStatus').textContent=error.message;}
}
$('pushSettings').addEventListener('toggle',()=>{if($('pushSettings').open)void refreshPush();});
$('pushEnable').onclick=async()=>{
 const reason=pushSupport();if(reason){$('pushStatus').textContent=reason;return;}
 try{pushConfig=await pushRequest();$('pushName').value=pushIdentity.name||'';$('pushCode').value='';$('pushFeedback').textContent='';$('pushDialog').showModal();}catch(error){$('pushStatus').textContent=error.message;}
};
$('pushCancel').onclick=()=>$('pushDialog').close();
$('pushForm').addEventListener('submit',async event=>{
 event.preventDefault();if(pushBusy)return;pushBusy=true;$('pushSubmit').disabled=true;
 try{
  // Permission request is deliberately the first async operation after the user's tap.
  const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('알림 권한을 허용해야 미리 알림을 받을 수 있습니다.');
  $('pushFeedback').textContent='알림을 등록하고 있습니다…';
  const registration=await navigator.serviceWorker.ready;
  const key=pushConfig.publicKey.replace(/-/g,'+').replace(/_/g,'/');const bytes=Uint8Array.from(atob(key+'='.repeat((4-key.length%4)%4)),c=>c.charCodeAt(0));
  const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
  await pushRequest('POST',{action:'register',code:$('pushCode').value.trim(),name:$('pushName').value.trim(),subscription:subscription.toJSON()});
  pushIdentity.name=$('pushName').value.trim();write(DEVICE_KEY,pushIdentity);$('pushCode').value='';$('pushDialog').close();await refreshPush();
 }catch(error){$('pushFeedback').textContent=error.message||'등록하지 못했습니다. 다시 시도해 주세요.';}
 finally{pushBusy=false;$('pushSubmit').disabled=false;}
});
$('pushDisable').onclick=async()=>{
 try{await pushRequest('POST',{action:'disable'});const registration=await navigator.serviceWorker.getRegistration();const sub=await registration?.pushManager.getSubscription();if(sub)await sub.unsubscribe();await refreshPush();}catch(error){$('pushStatus').textContent=error.message;}
};
$('pushManage').onclick=async()=>{
 try{const info=await pushRequest();$('pushDevices').innerHTML=info.devices.map(device=>`<div class="push-device"><span>${esc(device.name)}${device.mine?' (이 기기)':''}</span><button class="btn" data-revoke-device="${esc(device.id)}">등록 해제</button></div>`).join('')||'<p class="smallnote">등록된 기기가 없습니다.</p>';
 $('pushDevices').querySelectorAll('[data-revoke-device]').forEach(button=>button.onclick=async()=>{const code=prompt('가족 알림 등록 코드를 입력하면 이 기기의 알림을 해제합니다.');if(!code)return;try{await pushRequest('POST',{action:'revoke',id:button.dataset.revokeDevice,code});await refreshPush();$('pushManage').click();}catch(error){$('pushStatus').textContent=error.message;}});
 }catch(error){$('pushStatus').textContent=error.message;}
};
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',event=>{
 if(event.data?.type!=='OPEN_TRIP_ITEM')return;const day=data.days.find(d=>d.items.some(i=>i.id===event.data.item));
 if(editorOpen()||engine?.dirty){$('pushStatus').textContent='편집을 저장한 뒤 알림의 일정을 확인해 주세요.';return;}
 if(day){active=day.id;render();const el=$('item-'+event.data.item);el?.scrollIntoView({block:'center',behavior:'smooth'});el?.classList.add('highlight');}
 else if(engine)void engine.run().then(()=>{const d=data.days.find(d=>d.items.some(i=>i.id===event.data.item));if(d){active=d.id;render();$('item-'+event.data.item)?.scrollIntoView({block:'center'});}});
});
// No extra polling: subscription checks run only when the settings are opened.
