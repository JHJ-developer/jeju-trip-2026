const {test}=require('node:test'),assert=require('node:assert/strict');
const {merge,copy}=require('../sync.js');
const fixture=()=>({days:[],packing:{groups:[{id:'g',name:'짐',items:['a','b','c'].map(id=>({id,title:id,done:false}))}]}});
const items=d=>d.packing.groups[0].items;
test('packing reorder survives concurrent checks and additions',()=>{
 const base=fixture(),local=copy(base),remote=copy(base);local.packing.groups[0].items.reverse();items(remote)[0].done=true;items(remote).push({id:'d',title:'d',done:false});
 const r=merge(base,local,remote);assert.equal(r.conflicts.length,0);assert.deepEqual(items(r.document).map(i=>i.id),['c','b','a','d']);assert.equal(items(r.document)[2].done,true);
});
test('conflicting packing orders require a choice; deletion is not resurrected',()=>{
 const base=fixture(),local=copy(base),remote=copy(base);local.packing.groups[0].items.reverse();remote.packing.groups[0].items=[items(remote)[1],items(remote)[0],items(remote)[2]];
 assert.ok(merge(base,local,remote).conflicts.some(c=>c.field==='항목 순서'));
 assert.deepEqual(items(merge(base,local,remote,'mine').document).map(i=>i.id),['c','b','a']);
 remote.packing.groups[0].items=items(base).filter(i=>i.id!=='b');assert.deepEqual(items(merge(base,local,remote).document).map(i=>i.id),['c','a']);
});
