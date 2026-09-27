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
