// Run with an optional private fixture outside the repository: TRIP_FIXTURE=/path/file.json
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {chromium}=require('playwright'),{webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..'),copy=x=>JSON.parse(JSON.stringify(x));
const defaults=vm.runInNewContext(fs.readFileSync(path.join(root,'defaults.js'),'utf8')+';DEFAULT_DATA');
const fixture=process.env.TRIP_FIXTURE?JSON.parse(fs.readFileSync(process.env.TRIP_FIXTURE,'utf8')):{document:{...defaults,note:'가족 메모',packing:{groups:[]},shopping:{groups:[{id:'purchases',name:'구매 목록',items:[{id:'bought',title:'구입 완료 물품',done:true}]}]}},version:1};
let row={...copy(fixture),id:'browser-test',updated_at:new Date().toISOString()},handler,gets=0,puts=0;
vm.runInNewContext(fs.readFileSync(path.join(root,'backend/family-trip.js'),'utf8'),{Response,TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,Deno:{env:{get:n=>n==='SUPABASE_URL'?'https://test.invalid':'test-secret'},serve:f=>handler=f},fetch:async(url,opts)=>{
 if(opts.method==='PATCH'){const version=Number(new URL(url).searchParams.get('version').slice(3));if(version!==row.version)return Response.json([]);Object.assign(row,JSON.parse(opts.body));return Response.json([row]);}
 return Response.json([row]);
}});
const server=http.createServer((req,res)=>{
 const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true}),errors=[];
 try{
  const contexts=[];
  async function newPage(shared=true){
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1,serviceWorkers:'block'});contexts.push(context);
   await context.route('**/*',async route=>{
    const r=route.request();if(r.url().startsWith(origin))return route.continue();
    if(!r.url().includes('/functions/v1/family-trip'))return route.abort();
    if(r.method()==='GET')gets++;else if(r.method()==='PUT')puts++;
    const response=await handler(new Request('https://test.invalid',{method:r.method(),headers:{'x-family-key':'a'.repeat(64),'Content-Type':'application/json'},body:r.postData()||undefined}));
    await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
   await page.goto(origin+(shared?'#family='+'a'.repeat(64):''));
   if(shared)await page.waitForFunction(()=>engine?.ready&&!engine.busy);return page;
  }
  const a=await newPage();assert.deepEqual(row.document,fixture.document);assert.equal(puts,0);
  const initialGets=gets;await a.clock.runFor(8000);assert.equal(gets,initialGets);await a.clock.runFor(22000);await a.waitForFunction(()=>!engine.busy);assert.equal(gets,initialGets+1);
  assert.equal(await a.locator('#noteText').textContent(),fixture.document.note||'가족과 공유할 한 줄 메모를 남겨보세요.');
  await a.screenshot({path:'/tmp/trip-planner-mobile.png',fullPage:true});
  const b=await newPage();
  await a.locator('#editTripBtn').click();await a.locator('#tripTitleInput').fill('부산 가족여행 플래너');await a.locator('#tripDescriptionInput').fill('2027.01.01 ~ 01.07\n부산 숙소 · 렌터카');await a.locator('#tripForm button[type=submit]').click();await a.waitForFunction(()=>!engine.busy&&!engine.dirty);
  await b.locator('#refreshBtn').click();await b.waitForFunction(()=>document.title==='부산 가족여행 플래너'&&!engine.busy);assert.equal(await b.locator('#tripDescription').textContent(),'2027.01.01 ~ 01.07\n부산 숙소 · 렌터카');
  assert.deepEqual(row.document.days,fixture.document.days);assert.deepEqual(row.document.shopping,fixture.document.shopping);assert.deepEqual(row.document.packing,fixture.document.packing);assert.equal(row.document.note,fixture.document.note);
  await a.locator('#manageDaysBtn').click();await a.locator('#addDayBtn').click();await a.locator('#dayLabelInput').fill('추가 일차 · 1/8');await a.locator('#daySubtitleInput').fill('추가 메모');await a.locator('#dayForm button[type=submit]').click();await a.waitForFunction(()=>!engine.busy&&!engine.dirty);
  const newId=row.document.days.at(-1).id;assert.equal(row.document.days.length,fixture.document.days.length+1);
  await a.locator('[data-day-move="'+newId+'"][data-step="-1"]').click();await a.waitForFunction(()=>!engine.busy&&!engine.dirty);assert.equal(row.document.days.at(-2).id,newId);
  await a.screenshot({path:'/tmp/trip-planner-days.png',fullPage:true});
  await a.locator('[data-day-edit="'+newId+'"]').click();await a.locator('#dayLabelInput').fill('마지막 날 · 1/9');await a.locator('#dayForm button[type=submit]').click();await a.waitForFunction(()=>!engine.busy&&!engine.dirty);
  await a.locator('[data-day-edit="'+newId+'"]').click();a.once('dialog',d=>d.dismiss());await a.locator('#deleteDayBtn').click();assert.ok(row.document.days.some(d=>d.id===newId));
  a.once('dialog',d=>d.accept());await a.locator('#deleteDayBtn').click();await a.waitForFunction(()=>!engine.busy&&!engine.dirty);assert.deepEqual(row.document.days,fixture.document.days);
  await a.locator('#daysClose').click();await a.reload();await a.waitForFunction(()=>engine?.ready&&!engine.busy);assert.equal(await a.locator('#tripTitle').textContent(),'부산 가족여행 플래너');assert.deepEqual(row.document.days,fixture.document.days);
  // Day deletion versus an already-open editor must require an explicit choice.
  await b.locator('#refreshBtn').click();await b.waitForFunction(()=>!engine.busy);
  const first=row.document.days[0].id;
  await b.locator('#manageDaysBtn').click();await b.locator('[data-day-edit="'+first+'"]').click();await b.locator('#daySubtitleInput').fill('가족이 동시에 수정한 설명');
  await a.locator('#manageDaysBtn').click();await a.locator('[data-day-edit="'+first+'"]').click();a.once('dialog',d=>d.accept());await a.locator('#deleteDayBtn').click();await a.waitForFunction(()=>!engine.busy&&!engine.dirty);
  await b.locator('#dayForm button[type=submit]').click();await b.locator('#conflictDialog').waitFor({state:'visible'});await b.locator('#keepMine').click();await b.waitForFunction(()=>!engine.busy&&!engine.dirty);assert.equal(row.document.days.find(d=>d.id===first).subtitle,'가족이 동시에 수정한 설명');
  // Local-only users can remove all days without defaults being resurrected.
  const local=await newPage(false);await local.evaluate(()=>localStorage.setItem('jejuTripPWA_v1',JSON.stringify({days:[],note:'그대로',shopping:{groups:[]},packing:{groups:[]},title:'빈 여행',description:''})));await local.reload();assert.equal(await local.locator('#tripTitle').textContent(),'빈 여행');assert.equal(await local.locator('[data-id^=day]').count(),0);assert.equal(await local.locator('#noteText').textContent(),'그대로');
  await local.locator('#manageDaysBtn').click();await local.locator('#addDayBtn').click();await local.locator('#dayForm button[type=submit]').click();await local.locator('#daysClose').click();assert.equal(await local.locator('.tab[data-id]').count(),3);
  for(const width of [320,390]){await a.setViewportSize({width,height:844});assert.ok(await a.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));}
  assert.deepEqual(errors,[]);console.log('PASS: preserved live fixture, 30-second polling, shared metadata, day add/edit/reorder/delete, conflict choice, reload and empty-day persistence; mobile widths 320/390.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
