const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

async function fixture(document){
 const {dueItems,validSubscription}=await import('../backend/push-logic.mjs');
 const now=Date.parse('2026-10-26T11:55:00+09:00'),sent=[],calls=[];
 const config={trip_id:'trip',public_key:'public-test-key',private_key:'private-test-key'};
 const device={id:'device',subscription:{endpoint:'https://web.push.apple.com/test',keys:{auth:'a'.repeat(22),p256dh:'b'.repeat(87)}}};
 let handler;
 const source=fs.readFileSync(path.join(__dirname,'../backend/family-push.js'),'utf8').replace(/^import .*;\n/gm,'');
 vm.runInNewContext(source,{
  Response,URL,AbortSignal,TextEncoder,TextDecoder,Uint8Array,
  Date:class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}},
  dueItems:doc=>dueItems(doc,now),validSubscription,
  Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://test.invalid':'test-service-key'},serve:fn=>handler=fn},
  webpush:{generateRequestDetails:(sub,payload,options)=>{sent.push({payload:JSON.parse(payload),options});return {endpoint:sub.endpoint,method:'POST',headers:{},body:'test-only'};}},
  fetch:async(url,opts)=>{
   if(url===device.subscription.endpoint)return new Response(null,{status:201});
   const resource=url.split('/rest/v1/')[1];calls.push({resource,method:opts.method,body:opts.body?JSON.parse(opts.body):undefined});
   if(resource.startsWith('family_push_config?'))return Response.json([config]);
   if(resource.startsWith('family_trips?'))return Response.json([{document}]);
   if(resource.startsWith('family_push_devices?'))return Response.json([device]);
   if(resource==='rpc/claim_family_push')return Response.json(true);
   if(resource.startsWith('family_push_deliveries?')&&opts.method==='PATCH')return Response.json([]);
   throw new Error('Unexpected database request: '+resource);
  }
 });
 const dispatch=async(secret='a'.repeat(64))=>handler(new Request('https://test.invalid/family-push/dispatch',{method:'POST',headers:{'x-scheduler-secret':secret}}));
 return {dispatch,sent,calls};
}

test('list-only edits never claim a change queue or send a notification',async()=>{
 for(const scope of ['shopping','packing','groceries']){
  const f=await fixture({days:[],[scope]:{groups:[{id:'g',items:[{id:'i',title:'changed',done:true}]}]}});
  const response=await f.dispatch();assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{accepted:0});assert.equal(f.sent.length,0);
  assert.equal(f.calls.length,2);
 }
});

test('due trip reminder still sends with list edits and preserves time, opt-out, TTL and delivery record',async()=>{
 const f=await fixture({days:[{date:'2026-10-26',items:[
  {id:'due',start:'12:00',title:'아쿠아리움'},
  {id:'disabled',start:'12:00',title:'disabled',reminder:false},
  {id:'past',start:'11:54',title:'past'},
  {id:'future',start:'12:30',title:'future'}
 ]}],packing:{groups:[]},shopping:{groups:[]},groceries:{groups:[]}});
 const response=await f.dispatch();assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{accepted:1});assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].payload.item,'due');assert.equal(f.sent[0].payload.body,'12:00 · 아쿠아리움');
 assert.equal(f.sent[0].payload.title,'⏰ 5분 뒤 일정이 있어요');assert.equal(f.sent[0].options.TTL,300);
 assert.ok(f.calls.some(c=>c.resource.startsWith('family_push_deliveries?')&&c.body?.status==='sent'));
 assert.ok(f.calls.every(c=>!c.resource.includes('family_changes')&&!c.resource.includes('family_change_deliveries')));
});

test('dispatch still rejects missing scheduler credentials',async()=>{
 const f=await fixture({days:[]});const response=await f.dispatch('');
 assert.equal(response.status,401);assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);
});
