import webpush from 'npm:web-push@3.6.7';
import {dueItems,validSubscription} from './push-logic.mjs';
const ORIGIN='https://jhj-developer.github.io';
const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'content-type,x-family-key,x-device-token','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
async function db(path,method='GET',body){
 const response=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/'+path,{method,headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!response.ok){const message=await response.text();throw new Error(message.includes('device_limit')?'device_limit':'storage');}return response.status===204?null:response.json();
}
async function dispatch(config){
 const trips=await db('family_trips?id=eq.'+config.trip_id+'&select=document');
 const due=dueItems(trips[0]?.document||{});
 if(!due.length)return {accepted:0};
 const devices=await db('family_push_devices?trip_id=eq.'+config.trip_id+'&active=eq.true');
 let accepted=0;
 for(const task of due)for(const device of devices){
  if(!validSubscription(device.subscription))continue;
  if(!await db('rpc/claim_family_push','POST',{p_device:device.id,p_item:task.item.id,p_start:task.startsAt}))continue;
  const path='family_push_deliveries?device_id=eq.'+device.id+'&item_id=eq.'+encodeURIComponent(task.item.id)+'&starts_at=eq.'+encodeURIComponent(task.startsAt);
  // Recheck the current document and device immediately before delivery.
  const fresh=await db('family_trips?id=eq.'+config.trip_id+'&select=document');
  const current=dueItems(fresh[0]?.document||{}).find(t=>t.item.id===task.item.id&&t.startsAt===task.startsAt);
  const live=await db('family_push_devices?id=eq.'+device.id+'&active=eq.true&select=id');
  if(!current||!live.length){await db(path,'DELETE');continue;}
  let status=0;
  try{
   const minutes=Math.max(1,Math.ceil((Date.parse(task.startsAt)-Date.now())/60000));
   const payload=JSON.stringify({title:`⏰ ${minutes}분 뒤 일정이 있어요`,body:`${current.item.start} · ${current.item.title}`,tag:`trip-${task.item.id}-${task.startsAt}`,item:task.item.id});
   const request=webpush.generateRequestDetails(device.subscription,payload,{TTL:Math.max(1,Math.floor((Date.parse(task.startsAt)-Date.now())/1000)),urgency:'high',vapidDetails:{subject:'https://jhj-developer.github.io/jeju-trip-2026/',publicKey:config.public_key,privateKey:config.private_key}});
   const response=await fetch(request.endpoint,{method:request.method,headers:request.headers,body:request.body,redirect:'error',signal:AbortSignal.timeout(12000)});status=response.status;await response.body?.cancel();
   if(response.ok)accepted++;
  }catch{status=0;}
  if(status===404||status===410)await db('family_push_devices?id=eq.'+device.id,'PATCH',{active:false});
  await db(path,'PATCH',{status:status>=200&&status<300?'sent':'retry',error_code:status,updated_at:new Date().toISOString()});
 }
 return {accepted};
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.headers.get('origin')&&req.headers.get('origin')!==ORIGIN)return reply(403,{error:'origin'});
 try{
  if(new URL(req.url).pathname.endsWith('/dispatch')){
   if(req.method!=='POST')return reply(405,{error:'method'});
   const secret=req.headers.get('x-scheduler-secret')||'';
   if(!/^[a-f0-9]{64}$/.test(secret))return reply(401,{error:'unauthorized'});
   const configs=await db('family_push_config?scheduler_secret=eq.'+secret);
   if(configs.length!==1)return reply(401,{error:'unauthorized'});
   return reply(200,await dispatch(configs[0]));
  }
  if(!['GET','POST'].includes(req.method))return reply(405,{error:'method'});
  const key=req.headers.get('x-family-key')||'',token=req.headers.get('x-device-token')||'';
  if(!/^[a-f0-9]{64}$/.test(key)||!/^[a-f0-9]{64}$/.test(token))return reply(401,{error:'invalid_invite'});
  const familyHash=await hash(key),deviceHash=await hash(token);
  const trips=await db('family_trips?or=(access_hash.eq.'+familyHash+',additional_access_hash.eq.'+familyHash+')&select=id');
  if(trips.length!==1)return reply(401,{error:'invalid_invite'});
  const trip=trips[0].id,configs=await db('family_push_config?trip_id=eq.'+trip);
  if(configs.length!==1)return reply(503,{error:'not_configured'});
  const config=configs[0];
  if(req.method==='GET'){
   const devices=await db('family_push_devices?trip_id=eq.'+trip+'&active=eq.true&select=id,name,token_hash');
   return reply(200,{publicKey:config.public_key,registered:devices.some(d=>d.token_hash===deviceHash),devices:devices.map(d=>({id:d.id,name:d.name,mine:d.token_hash===deviceHash}))});
  }
  const reader=req.body?.getReader();if(!reader)return reply(400,{error:'body'});let bytes=0,chunks=[];
  for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>8192){await reader.cancel();return reply(413,{error:'too_large'});}chunks.push(value);}
  const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
  let input;try{input=JSON.parse(new TextDecoder().decode(buffer));}catch{return reply(400,{error:'json'});}
  if(input.action==='disable'){await db('family_push_devices?trip_id=eq.'+trip+'&token_hash=eq.'+deviceHash,'PATCH',{active:false});return reply(200,{ok:true});}
  if(typeof input.code!=='string'||await hash(input.code.replace(/[-\s]/g,'').toUpperCase())!==config.enrollment_hash)return reply(403,{error:'invalid_code'});
  if(input.action==='revoke'){
   if(!/^[a-f0-9-]{36}$/.test(input.id||''))return reply(400,{error:'device'});
   await db('family_push_devices?trip_id=eq.'+trip+'&id=eq.'+input.id,'PATCH',{active:false});return reply(200,{ok:true});
  }
  if(input.action!=='register'||typeof input.name!=='string'||!input.name.trim()||input.name.length>40||!validSubscription(input.subscription))return reply(400,{error:'invalid_subscription'});
  try{await db('rpc/register_family_push','POST',{p_trip:trip,p_token:deviceHash,p_name:input.name.trim(),p_subscription:input.subscription});}
  catch(error){return reply(error.message==='device_limit'?409:503,{error:error.message});}
  return reply(200,{ok:true});
 }catch{return reply(503,{error:'unavailable'});}
});
