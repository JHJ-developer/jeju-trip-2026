const CACHE='jeju-trip-v12-list-push';
const ASSETS=['./','./index.html','./manifest.webmanifest','./defaults.js?v=12','./sync.js?v=12','./app.js?v=12','./notifications.js?v=12'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('jeju-trip-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
 e.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{
   const response=await fetch(e.request,{cache:'no-cache'});
   if(response.ok)await cache.put(e.request,response.clone());
   return response;
  }catch(error){
   const cached=await cache.match(e.request);
   if(cached)return cached;
   if(e.request.mode==='navigate'){const page=await cache.match('./index.html');if(page)return page;}
   throw error;
  }
 })());
});

self.addEventListener('push',event=>{
 let message={};try{message=event.data?.json()||{};}catch{}
 const title=typeof message.title==='string'?message.title:'가족 일정 알림';
 event.waitUntil(self.registration.showNotification(title,{body:typeof message.body==='string'?message.body:'여행 일정을 확인해 주세요.',tag:message.tag||'family-trip',data:{item:message.item||'',scope:['shopping','packing'].includes(message.scope)?message.scope:''}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const url=new URL('./',self.registration.scope);
 if(event.notification.data?.item)url.searchParams.set('item',event.notification.data.item);
 if(['shopping','packing'].includes(event.notification.data?.scope))url.searchParams.set('tab',event.notification.data.scope);
 event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
 for(const client of windows)if(client.url.startsWith(self.registration.scope)){client.postMessage({type:'OPEN_TRIP_ITEM',item:event.notification.data?.item||'',scope:event.notification.data?.scope||''});await client.focus();return;}
 await self.clients.openWindow(url.href);
 })());
});
