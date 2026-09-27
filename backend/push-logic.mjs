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
