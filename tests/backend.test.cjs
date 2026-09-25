const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {webcrypto}=require('node:crypto');
test('backend validates and persists packing, preserves it for old clients, and retains version protection',async()=>{
 let handler;let row={id:'test',version:1,updated_at:'2026-09-25T08:00:00Z',document:{days:[{id:'day1',label:'1일차',subtitle:'',items:[]}]}};
 const context={Response,TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,Deno:{env:{get:n=>n==='SUPABASE_URL'?'https://test.invalid':'server-secret'},serve:f=>handler=f},fetch:async(url,opts)=>{
  if(opts.method==='PATCH'){const version=Number(new URL(url).searchParams.get('version').slice(3));if(version!==row.version)return Response.json([]);Object.assign(row,JSON.parse(opts.body));return Response.json([row]);}
  return Response.json([row]);
 }};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../backend/family-trip.js'),'utf8'),context);
 const req=(method,body)=>new Request('https://test.invalid',{method,headers:{'x-family-key':'a'.repeat(64),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const initial=await (await handler(req('GET'))).json();assert.equal(initial.document.packing.groups.length,2);
 initial.document.note='출발 전 확인';initial.document.packing.groups[0].items[0].done=true;
 assert.equal(initial.document.shopping.groups[0].items[0].title,"여행캐리어");initial.document.shopping.groups[0].items[0].done=true;
 let response=await handler(req('PUT',{version:1,document:initial.document}));assert.equal(response.status,200);assert.equal(row.document.packing.groups[0].items[0].done,true);assert.equal(row.document.shopping.groups[0].items[0].done,true);assert.equal(row.document.note,'출발 전 확인');
 response=await handler(req('PUT',{version:2,document:{days:row.document.days}}));assert.equal(response.status,200);assert.equal(row.document.packing.groups[0].items[0].done,true);assert.equal(row.document.shopping.groups[0].items[0].done,true);assert.equal(row.document.note,'출발 전 확인');
 response=await handler(req('PUT',{version:1,document:initial.document}));assert.equal(response.status,409);
 const bad=JSON.parse(JSON.stringify(row.document));bad.packing.groups[0].items[0].done='yes';assert.equal((await handler(req('PUT',{version:3,document:bad}))).status,400);
 bad.packing={groups:[]};bad.shopping.groups[0].items[0].done="yes";assert.equal((await handler(req("PUT",{version:3,document:bad}))).status,400);bad.shopping.groups[0].items[0].done=true;response=await handler(req('PUT',{version:3,document:bad}));assert.equal(response.status,200);assert.equal(row.document.packing.groups.length,0);
 const invalid=JSON.parse(JSON.stringify(row.document));invalid.note='a'.repeat(301);assert.equal((await handler(req('PUT',{version:4,document:invalid}))).status,400);
 invalid.note='';assert.equal((await handler(req('PUT',{version:4,document:invalid}))).status,200);assert.equal(row.document.note,'');
});
