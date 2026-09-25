const {test}=require('node:test');
const assert=require('node:assert/strict');
const {merge,SyncEngine,copy}=require('../sync.js');
const doc={days:[{id:'day1',label:'1일차',subtitle:'',items:[{id:'one',start:'09:00',end:'10:00',title:'기존',detail:'메모',done:false},{id:'two',start:'11:00',end:'12:00',title:'둘째',detail:'',done:false}]}]};
test('packing initializes from an old document and keeps trip edits separate',()=>{
 const mine=copy(doc),remote=copy(doc);mine.packing=copy(require('../sync.js').DEFAULT_PACKING);mine.packing.groups[0].items[0].done=true;remote.days[0].items[0].title='가족 일정';
 const result=merge(doc,mine,remote);assert.equal(result.conflicts.length,0);assert.equal(result.document.packing.groups[0].items[0].done,true);assert.equal(result.document.days[0].items[0].title,'가족 일정');
});
test('packing group rename, another item check, and new groups merge',()=>{
 const base={...copy(doc),packing:copy(require('../sync.js').DEFAULT_PACKING)},mine=copy(base),remote=copy(base);
 mine.packing.groups[0].name='아윤이 가방';mine.packing.groups.push({id:'new-group',name:'아빠짐',items:[]});remote.packing.groups[0].items[0].done=true;
 const result=merge(base,mine,remote);assert.equal(result.conflicts.length,0);assert.equal(result.document.packing.groups[0].name,'아윤이 가방');assert.equal(result.document.packing.groups[0].items[0].done,true);assert.equal(result.document.packing.groups.length,3);
});
test('packing group deletion conflicts with concurrent item edits; empty list stays empty',()=>{
 const base={...copy(doc),packing:copy(require('../sync.js').DEFAULT_PACKING)},mine=copy(base),remote=copy(base);mine.packing.groups.shift();remote.packing.groups[0].items[0].done=true;
 assert.equal(merge(base,mine,remote).conflicts.length,1);assert.equal(merge(base,mine,remote,'mine').document.packing.groups.length,1);assert.equal(merge(base,mine,remote,'family').document.packing.groups.length,2);
 mine.packing.groups=[];assert.equal(merge(base,mine,base).document.packing.groups.length,0);
});
test('merges different fields and items without losing either edit',()=>{
 const mine=copy(doc),theirs=copy(doc);mine.days[0].items[0].title='내 제목';theirs.days[0].items[0].done=true;theirs.days[0].items[1].detail='가족 메모';
 const result=merge(doc,mine,theirs);assert.equal(result.conflicts.length,0);assert.equal(result.document.days[0].items[0].title,'내 제목');assert.equal(result.document.days[0].items[0].done,true);assert.equal(result.document.days[0].items[1].detail,'가족 메모');
});
test('same-field and edit-delete conflicts require explicit selection',()=>{
 const mine=copy(doc),theirs=copy(doc);mine.days[0].items[0].title='나';theirs.days[0].items[0].title='가족';
 assert.equal(merge(doc,mine,theirs).conflicts.length,1);assert.equal(merge(doc,mine,theirs,'mine').document.days[0].items[0].title,'나');assert.equal(merge(doc,mine,theirs,'family').document.days[0].items[0].title,'가족');
 theirs.days[0].items.shift();assert.equal(merge(doc,mine,theirs).conflicts[0].field,'삭제된 일정');assert.equal(merge(doc,mine,theirs,'family').document.days[0].items.length,1);assert.equal(merge(doc,mine,theirs,'mine').document.days[0].items.length,2);
});
test('add and delete retries are idempotent',()=>{
 const mine=copy(doc);mine.days[0].items.shift();mine.days[0].items.push({id:'new',start:'',end:'',title:'새 일정',detail:'',done:false});
 assert.deepEqual(merge(doc,mine,mine).document,mine);assert.equal(merge(doc,mine,mine).conflicts.length,0);
});
test('JSONB object key reordering does not turn an acknowledged addition into a conflict',()=>{
 const mine=copy(doc);mine.days[0].items.push({id:'new',start:'',end:'',title:'추가',detail:'',done:false});
 const remote=copy(mine);remote.days[0].items[2]={done:false,title:'추가',id:'new',detail:'',end:'',start:''};
 assert.equal(merge(doc,mine,remote).conflicts.length,0);
});
test('concurrent start/end edits cannot create an invalid time range',()=>{
 const mine=copy(doc),theirs=copy(doc);mine.days[0].items[0].end='09:30';theirs.days[0].items[0].start='09:45';
 const result=merge(doc,mine,theirs);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].field,'시간');
 const chosen=merge(doc,mine,theirs,'mine').document.days[0].items[0];assert.equal(chosen.start,'09:00');assert.equal(chosen.end,'09:30');
});
function server(){let state={document:copy(doc),version:1,updated_at:new Date().toISOString()};return {request:async(method,body)=>{if(method==='PUT'){if(body.version!==state.version){const e=Error();e.status=409;throw e;}state={document:copy(body.document),version:state.version+1,updated_at:new Date().toISOString()};}return copy(state);},state:()=>copy(state)};}
test('two independent clients preserve simultaneous edits through version conflicts',async()=>{
 const api=server(),a=new SyncEngine({request:api.request}),b=new SyncEngine({request:api.request});await Promise.all([a.run(),b.run()]);
 let base=copy(a.document),next=copy(base);next.days[0].items[0].title='A';a.edit(base,next);
 base=copy(b.document);next=copy(base);next.days[0].items[1].title='B';b.edit(base,next);
 await Promise.all([a.run(),b.run()]);await a.run();assert.equal(a.document.days[0].items[0].title,'A');assert.equal(a.document.days[0].items[1].title,'B');assert.equal(a.dirty,false);assert.equal(b.dirty,false);
});
test('offline cache survives restart and a lost write response is safe to retry',async()=>{
 const api=server();let offline=false,lose=false;const request=async(method,body)=>{if(offline)throw Error('offline');const response=await api.request(method,body);if(method==='PUT'&&lose){lose=false;throw Error('lost');}return response;};
 const a=new SyncEngine({request});await a.run();const base=copy(a.document),next=copy(base);next.days[0].items[0].done=true;a.edit(base,next);offline=true;await a.run();assert.equal(a.status,'offline');assert.equal(a.dirty,true);
 const b=new SyncEngine({request,cached:a.snapshot()});offline=false;lose=true;await b.run();assert.equal(b.dirty,true);const version=api.state().version;await b.run();assert.equal(b.dirty,false);assert.equal(api.state().version,version);assert.equal(b.document.days[0].items[0].done,true);
});
test('edits made while a save is in flight remain pending and are saved',async()=>{
 const api=server();let release,entered;const gate=new Promise(r=>entered=r);let first=true;
 const a=new SyncEngine({request:async(method,body)=>{if(method==='PUT'&&first){first=false;entered();await new Promise(r=>release=r);}return api.request(method,body);}});await a.run();
 let base=copy(a.document),next=copy(base);next.days[0].items[0].done=true;a.edit(base,next);const saving=a.run();await gate;
 base=copy(a.document);next=copy(base);next.days[0].items[1].detail='저장 중 수정';a.edit(base,next);release();await saving;assert.equal(a.dirty,false);assert.equal(api.state().document.days[0].items[1].detail,'저장 중 수정');
});
test('shopping checks merge with packing edits and concurrent purchases',()=>{
 const {DEFAULT_SHOPPING,DEFAULT_PACKING}=require('../sync.js');
 const base={...copy(doc),packing:copy(DEFAULT_PACKING),shopping:copy(DEFAULT_SHOPPING)},mine=copy(base),remote=copy(base);
 mine.shopping.groups[0].items[0].done=true;
 remote.shopping.groups[0].items[1].done=true;remote.packing.groups[0].items[0].done=true;
 const result=merge(base,mine,remote);assert.equal(result.conflicts.length,0);
 assert.ok(result.document.shopping.groups[0].items.every(i=>i.done));assert.equal(result.document.packing.groups[0].items[0].done,true);
 const old=copy(base);delete old.shopping;assert.deepEqual(merge(old,old,result.document).document.shopping,result.document.shopping);
});

test('shared note merges independently, detects conflicts, and permits clearing',()=>{
 const base={...copy(doc),note:'원래 메모'},mine=copy(base),remote=copy(base);
 mine.note='내 메모';remote.days[0].items[0].done=true;
 let result=merge(base,mine,remote);assert.equal(result.document.note,'내 메모');assert.equal(result.document.days[0].items[0].done,true);
 remote.note='가족 메모';result=merge(base,mine,remote);assert.equal(result.conflicts.length,1);assert.equal(result.document.note,'가족 메모');assert.equal(merge(base,mine,remote,'mine').document.note,'내 메모');
 mine.note='';assert.equal(merge(base,mine,base).document.note,'');
 const old=copy(doc);assert.equal(merge(old,old,remote).document.note,'가족 메모');
});
