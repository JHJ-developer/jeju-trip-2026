const CACHE='jeju-trip-v8-note';
const ASSETS=['./','./index.html','./manifest.webmanifest','./defaults.js?v=8','./sync.js?v=8','./app.js?v=8'];
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
