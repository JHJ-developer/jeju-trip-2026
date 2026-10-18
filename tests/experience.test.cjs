const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto}=require('node:crypto');
const {copy,merge,journeyView,groceriesOf}=require('../sync.js');
const item=(id,start)=>({id,start,end:start,title:id,detail:'',done:false});
const fixture=()=>({days:[{id:'d1',label:'1일차',subtitle:'',items:[item('late','12:00'),item('early','09:00')]},{id:'d2',label:'2일차',subtitle:'',items:[item('tomorrow','08:00')]}]});
test('journey advances only on completion and waits for explicit next-day start',()=>{
 const d=fixture();assert.equal(journeyView(d).state,'before');assert.equal(journeyView(d).item.id,'early');
 d.travel={started:true,dayId:'d1'};assert.equal(journeyView(d).item.id,'early');
 d.days[0].items[1].done=true;assert.equal(journeyView(d).item.id,'late');
 d.days[0].items[0].done=true;let v=journeyView(d);assert.equal(v.state,'dayComplete');assert.equal(v.day.id,'d1');assert.equal(v.next.id,'d2');
 d.travel.dayId='d2';assert.equal(journeyView(d).item.id,'tomorrow');d.days[1].items[0].done=true;assert.equal(journeyView(d).state,'complete');
 d.days[0].items[1].done=false;assert.equal(journeyView(d).state,'dayComplete');assert.equal(journeyView(d).next.id,'d1');
});
test('empty, deleted and all-completed days resolve without losing checklist state',()=>{
 assert.equal(journeyView({days:[]}).state,'empty');const d=fixture();d.travel={started:true,dayId:'deleted'};assert.equal(journeyView(d).day.id,'d1');
 d.days.forEach(day=>day.items.forEach(i=>i.done=true));d.travel.started=false;assert.equal(journeyView(d).state,'before');assert.equal(journeyView(d).item,undefined);
});
test('quantity, notes, visit fields and progress merge with independent family edits',()=>{
 const base=fixture();base.groceries=copy(groceriesOf(base));base.groceries.groups[0].items=[{id:'water',title:'생수',done:false}];
 const mine=copy(base),remote=copy(base);mine.groceries.groups[0].items[0].quantity='8개';mine.days[0].items[0].parking='주차장 주소';mine.travel={started:true,dayId:'d1'};
 remote.groceries.groups[0].items[0].note='작은 병';remote.groceries.groups[0].items[0].done=true;remote.days[0].items[0].reservation='3명';
 const r=merge(base,mine,remote);assert.equal(r.conflicts.length,0);assert.deepEqual(r.document.groceries.groups[0].items[0],{id:'water',title:'생수',done:true,quantity:'8개',note:'작은 병'});assert.equal(r.document.days[0].items[0].parking,'주차장 주소');assert.equal(r.document.days[0].items[0].reservation,'3명');assert.equal(r.document.travel.dayId,'d1');
 const a=copy(r.document),b=copy(r.document);a.travel.dayId='d2';b.travel={started:false,dayId:''};assert.equal(merge(r.document,a,b).conflicts.length,1);assert.equal(merge(r.document,a,b,'mine').document.travel.dayId,'d2');
});
test('backend persists new fields, preserves them for older clients and supports explicit clearing',async()=>{
 let handler,row={version:1,document:fixture()};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../backend/family-trip.js'),'utf8'),{Response,URL,TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,Deno:{env:{get:()=>''},serve:f=>handler=f},fetch:async(u,o)=>{if(o.method==='PATCH')Object.assign(row,JSON.parse(o.body));return Response.json([row]);}});
 const put=d=>handler(new Request('https://test.invalid',{method:'PUT',headers:{'x-family-key':'a'.repeat(64)},body:JSON.stringify({version:row.version,document:d})}));
 let d=copy(row.document);d.travel={started:true,dayId:'d1'};d.groceries={groups:[{id:'groceries-list',name:'장보기',items:[{id:'water',title:'생수',done:false,quantity:'8개',note:'작은 병'}]}]};Object.assign(d.days[0].items[0],{place:'제주 식당',parking:'주차장 주소',phone:'064-000-0000',bookingUrl:'https://example.com/booking',ticketUrl:'https://example.com/ticket'});
 assert.equal((await put(d)).status,200);assert.equal(row.document.groceries.groups[0].items[0].quantity,'8개');assert.equal(row.document.travel.started,true);
 d=copy(row.document);delete d.travel;delete d.groceries.groups[0].items[0].quantity;delete d.groceries.groups[0].items[0].note;delete d.days[0].items[0].bookingUrl;assert.equal((await put(d)).status,200);assert.equal(row.document.groceries.groups[0].items[0].quantity,'8개');assert.equal(row.document.days[0].items[0].bookingUrl,'https://example.com/booking');assert.equal(row.document.travel.started,true);
 for(const patch of [{bookingUrl:'javascript:alert(1)'},{ticketUrl:'https://user:secret@example.com/'},{phone:'<script>'}]){d=copy(row.document);Object.assign(d.days[0].items[0],patch);assert.equal((await put(d)).status,400);}
 d=copy(row.document);d.groceries.groups[0].items[0].quantity='x'.repeat(41);assert.equal((await put(d)).status,400);
 d=copy(row.document);d.travel={started:'yes',dayId:'d1'};assert.equal((await put(d)).status,400);
 d=copy(row.document);d.groceries.groups[0].items[0].quantity='';d.groceries.groups[0].items[0].note='';d.days[0].items[0].bookingUrl='';assert.equal((await put(d)).status,200);assert.equal(row.document.groceries.groups[0].items[0].quantity,'');assert.equal(row.document.days[0].items[0].bookingUrl,'');
});
