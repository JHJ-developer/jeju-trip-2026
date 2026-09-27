export function dueItems(document,now=Date.now()){
 const due=[];
 for(const day of document.days||[]){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day.date||''))continue;
  for(const item of day.items||[]){
   if(item.reminder===false||!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.start||''))continue;
   const time=Date.parse(`${day.date}T${item.start}:00+09:00`);
   if(time>now&&time-600000<=now)due.push({item,day,startsAt:new Date(time).toISOString()});
  }
 }
 return due;
}
export function validSubscription(sub){
 try{const url=new URL(sub.endpoint);
 return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&
 (url.hostname==='fcm.googleapis.com'||url.hostname==='updates.push.services.mozilla.com'||/^[a-z0-9-]+\.push\.apple\.com$/.test(url.hostname))&&
 typeof sub.keys?.auth==='string'&&/^[A-Za-z0-9_-]{22}={0,2}$/.test(sub.keys.auth)&&
 typeof sub.keys?.p256dh==='string'&&/^[A-Za-z0-9_-]{87}={0,2}$/.test(sub.keys.p256dh)&&sub.endpoint.length<2048;
 }catch{return false;}
}

export function listChangePayload(change){
 const body={shopping:'사야할것에 변경사항이 있습니다',packing:'준비물에 변경사항이 있습니다'}[change.scope];
 if(!body)throw new Error('Invalid list scope');
 return {title:'가족 여행 알림',body,scope:change.scope,tag:`change-${change.trip_id}-${change.scope}-${change.document_version}`};
}
export async function dispatchListChanges(config,{db,send,now=()=>Date.now()}){
 const changes=await db('rpc/claim_family_changes','POST',{p_trip:config.trip_id});
 let accepted=0;
 for(const change of changes){
  const path='family_change_deliveries?id=eq.'+change.id;
  const devices=await db('family_push_devices?id=eq.'+change.device_id+'&trip_id=eq.'+config.trip_id+'&active=eq.true');
  const ttl=Math.floor((Date.parse(change.expires_at)-now())/1000);
  if(!devices.length||ttl<=0||!validSubscription(devices[0].subscription)){
   await db(path,'PATCH',{status:'skipped',updated_at:new Date(now()).toISOString()});continue;
  }
  let status=0;
  try{status=await send(config,devices[0],listChangePayload(change),ttl);}catch{}
  if(status===404||status===410)await db('family_push_devices?id=eq.'+change.device_id,'PATCH',{active:false});
  const sent=status>=200&&status<300;if(sent)accepted++;
  await db(path,'PATCH',{status:sent?'sent':'retry',error_code:status,updated_at:new Date(now()).toISOString()});
 }
 return accepted;
}
