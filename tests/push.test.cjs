const {test}=require('node:test'),assert=require('node:assert/strict');
const {merge}=require('../sync.js');
test('10-minute window, Korean timezone, opt-out, missing date, reschedule and delete',async()=>{
 const {dueItems}=await import('../backend/push-logic.mjs');
 const doc={days:[{id:'day',date:'2026-10-26',items:[{id:'i',start:'12:00',title:'test'}]}]};
 const at=time=>Date.parse('2026-10-26T'+time+':00+09:00');
 assert.equal(dueItems(doc,at('11:49')).length,0);assert.equal(dueItems(doc,at('11:50')).length,1);assert.equal(dueItems(doc,at('11:59')).length,1);assert.equal(dueItems(doc,at('12:00')).length,0);
 assert.equal(dueItems(doc,at('11:50'))[0].startsAt,'2026-10-26T03:00:00.000Z');
 doc.days[0].items[0].reminder=false;assert.equal(dueItems(doc,at('11:50')).length,0);
 doc.days[0].items[0].reminder=true;doc.days[0].date='';assert.equal(dueItems(doc,at('11:50')).length,0);
 doc.days[0].date='2026-10-27';assert.equal(dueItems(doc,at('11:50')).length,0);
 doc.days=[];assert.equal(dueItems(doc,at('11:50')).length,0);
});
test('reminder toggles and day dates merge with other family edits',()=>{
 const base={days:[{id:'d',label:'day',subtitle:'',items:[{id:'i',start:'12:00',end:'13:00',title:'Lunch',detail:'',done:false}]}]};
 const local=structuredClone(base),remote=structuredClone(base);local.days[0].items[0].reminder=false;local.days[0].date='2026-10-26';remote.days[0].items[0].done=true;
 const result=merge(base,local,remote);assert.equal(result.conflicts.length,0);assert.equal(result.document.days[0].items[0].reminder,false);assert.equal(result.document.days[0].items[0].done,true);assert.equal(result.document.days[0].date,'2026-10-26');
});
test('push endpoints reject local, userinfo, lookalike hosts and invalid keys',async()=>{
 const {validSubscription}=await import('../backend/push-logic.mjs');
 const sub={endpoint:'https://web.push.apple.com/test',keys:{auth:'a'.repeat(22),p256dh:'b'.repeat(87)}};
 assert.equal(validSubscription(sub),true);
 for(const endpoint of ['http://web.push.apple.com/test','https://127.0.0.1/','https://fcm.googleapis.com.attacker.com/','https://user@fcm.googleapis.com/','https://fcm.googleapis.com:8443/'])assert.equal(validSubscription({...sub,endpoint}),false);
});
test('list change notifications use requested wording and distinct destinations',async()=>{
 const {listChangePayload}=await import('../backend/push-logic.mjs');
 assert.equal(listChangePayload({scope:'shopping',trip_id:'trip',document_version:3}).body,'사야할것에 변경사항이 있습니다');
 assert.equal(listChangePayload({scope:'packing',trip_id:'trip',document_version:4}).body,'준비물에 변경사항이 있습니다');
 assert.equal(listChangePayload({scope:'packing'}).scope,'packing');
 assert.throws(()=>listChangePayload({scope:'invalid'}));
});
test('claimed list changes deliver once per recipient and record provider outcome',async()=>{
 const {dispatchListChanges}=await import('../backend/push-logic.mjs');
 const now=Date.now(),calls=[],sent=[];
 const sub={endpoint:'https://web.push.apple.com/test',keys:{auth:'a'.repeat(22),p256dh:'b'.repeat(87)}};
 let claimed=false;
 const db=async(path,method,body)=>{
  calls.push({path,method,body});
  if(path==='rpc/claim_family_changes'){if(claimed)return [];claimed=true;return ['shopping','packing'].map((scope,i)=>({id:i+1,trip_id:'t',device_id:'d'+i,scope,document_version:2,expires_at:new Date(now+3600000).toISOString()}));}
  if(path.startsWith('family_push_devices?')&&!method)return [{subscription:sub}];
  return [];
 };
 const send=async(config,device,payload)=>{sent.push(payload);return sent.length===1?201:410;};
 assert.equal(await dispatchListChanges({trip_id:'t'},{db,send,now:()=>now}),1);
 assert.equal(sent.length,2);assert.ok(calls.some(c=>c.body?.active===false));
 assert.ok(calls.some(c=>c.path==='family_change_deliveries?id=eq.1'&&c.body?.status==='sent'));
 assert.equal(await dispatchListChanges({trip_id:'t'},{db,send,now:()=>now}),0);assert.equal(sent.length,2);
});
test('revoked or expired recipients are skipped without push; transient failure can retry',async()=>{
 const {dispatchListChanges}=await import('../backend/push-logic.mjs');let sends=0;const updates=[];
 const now=Date.now();
 const db=async(path,method,body)=>{
  if(path==='rpc/claim_family_changes')return [{id:1,device_id:'gone',expires_at:new Date(now+60000).toISOString()},{id:2,device_id:'old',expires_at:new Date(now-1).toISOString()}];
  if(path.startsWith('family_push_devices'))return [];
  updates.push(body);return [];
 };
 assert.equal(await dispatchListChanges({trip_id:'t'},{db,send:async()=>{sends++;},now:()=>now}),0);assert.equal(sends,0);assert.equal(updates.filter(x=>x.status==='skipped').length,2);
});
