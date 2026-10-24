const {JSDOM}=require('jsdom'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'https://jhj-developer.github.io/jeju-trip-2026/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
w.matchMedia=()=>({matches:false});w.scrollBy=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
w.localStorage.setItem('jejuTripPWA_v1',JSON.stringify({days:[],packing:{groups:[{id:'g',name:'짐',items:['a','b','c'].map(id=>({id,title:id,done:id==='b'}))}]}}));
for(const f of ['defaults.js','sync.js','packing-sort.js','app.js','notifications.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),dom.getInternalVMContext());
w.eval("active='packing';render()");
const doc=w.document,ids=()=>JSON.parse(w.localStorage.getItem('jejuTripPWA_v1')).packing.groups[0].items.map(i=>i.id);
const original=['a','b','c'];
function handle(){return doc.querySelector('[data-sort-handle="a"]');}
function geometry(){doc.querySelectorAll('[data-sort-item]').forEach(r=>r.getBoundingClientRect=()=>({top:150+Array.from(r.parentNode.querySelectorAll('[data-sort-item]')).indexOf(r)*60,height:60}));}
function touch(type,y=180,count=1,cancelable=true){const h=handle(),e=new w.Event(type,{bubbles:true,cancelable});Object.defineProperty(e,'touches',{value:type==='touchend'?[]:Array.from({length:count},(_,i)=>({clientX:350,clientY:y,identifier:i,target:h}))});h.dispatchEvent(e);return e.defaultPrevented;}
const wait=()=>new Promise(r=>setTimeout(r,850));
(async()=>{try{
 geometry();touch('touchstart');assert.equal(touch('touchmove',200),false);await wait();assert.equal(doc.querySelector('.pack-dragging'),null);touch('touchend');assert.deepEqual(ids(),original);
 touch('touchstart');await wait();assert.ok(doc.querySelector('.pack-dragging'));assert.equal(touch('touchmove',320),true);touch('touchend',320);assert.deepEqual(ids(),['b','c','a']);
 w.eval('render()');assert.deepEqual(Array.from(doc.querySelectorAll('[data-sort-item]')).map(r=>r.dataset.sortItem),['b','c','a']);
 // Cancellation restores preview and never writes an order.
 geometry();touch('touchstart',300);await wait();touch('touchmove',150);touch('touchcancel');assert.deepEqual(ids(),['b','c','a']);assert.deepEqual(Array.from(doc.querySelectorAll('[data-sort-item]')).map(r=>r.dataset.sortItem),['b','c','a']);
 touch('touchstart');touch('touchstart',180,2);await wait();assert.equal(doc.querySelector('.pack-dragging'),null);
 const cb=doc.querySelector('[data-pack-check="a"]');cb.checked=true;cb.dispatchEvent(new w.Event('change'));assert.equal(JSON.parse(w.localStorage.getItem('jejuTripPWA_v1')).packing.groups[0].items.find(i=>i.id==='a').done,true);
 // Filtered view reorders visible items without moving completed hidden slots.
 w.eval("data.packing.groups[0].items=[{id:'a',title:'a',done:false},{id:'b',title:'b',done:true},{id:'c',title:'c',done:false}];packingView.onlyUnpacked=true;render()");
 handle().dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.deepEqual(ids(),['c','b','a']);
 console.log('PASS: early movement does not prevent scrolling; 800ms hold, drop persistence, cancellation, multi-touch, checkbox, filtered ordering');
 }finally{dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
