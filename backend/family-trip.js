const DEFAULT_SHOPPING={groups:[{id:'shopping-list',name:'구매 목록',items:[{id:'shop-suitcase',title:'여행캐리어',done:false},{id:'shop-kettle',title:'전기포트',done:false}]}]};
const DEFAULT_PACKING={groups:[{id:'pack-ayoon',name:'아윤이짐',items:[{id:'pack-pajamas',title:'잠옷',done:false},{id:'pack-toys',title:'장난감',done:false}]},{id:'pack-common',name:'공통',items:[{id:'pack-toothbrushes',title:'칫솔 3개',done:false}]}]};
const ORIGIN="https://jhj-developer.github.io";
const headers={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"content-type,x-family-key","Access-Control-Allow-Methods":"GET,PUT,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
function valid(doc){
 if(!doc||!Array.isArray(doc.days)||doc.days.length<1||doc.days.length>10)return false;
 const ids=new Set();
 for(const d of doc.days){
  if(!d||typeof d.id!=="string"||!/^[a-zA-Z0-9-]{1,64}$/.test(d.id)||ids.has(d.id))return false;
  ids.add(d.id);
  if(typeof d.label!=="string"||d.label.length>100||typeof d.subtitle!=="string"||d.subtitle.length>1000||!Array.isArray(d.items)||d.items.length>200)return false;
  for(const i of d.items){
   if(!i||typeof i.id!=="string"||!/^[a-zA-Z0-9-]{1,64}$/.test(i.id)||ids.has(i.id))return false;
   ids.add(i.id);
   for(const k of ["start","end"])if(typeof i[k]!=="string"||!/^$|^(?:[01]\d|2[0-3]):[0-5]\d$/.test(i[k]))return false;
   if(Boolean(i.start)!==Boolean(i.end)||i.end<i.start||typeof i.title!=="string"||!i.title.trim()||i.title.length>300||typeof i.detail!=="string"||i.detail.length>5000||typeof i.done!=="boolean")return false;
  }
 }
 for(const scope of ["packing","shopping"]){
 if(doc[scope]===undefined)continue;
  if(!doc[scope]||!Array.isArray(doc[scope].groups)||doc[scope].groups.length>30)return false;
  for(const group of doc[scope].groups){
   if(!group||typeof group.id!=="string"||!/^[a-zA-Z0-9-]{1,64}$/.test(group.id)||ids.has(group.id)||typeof group.name!=="string"||!group.name.trim()||group.name.length>100||!Array.isArray(group.items)||group.items.length>200)return false;
   ids.add(group.id);
   for(const item of group.items){
    if(!item||typeof item.id!=="string"||!/^[a-zA-Z0-9-]{1,64}$/.test(item.id)||ids.has(item.id)||typeof item.title!=="string"||!item.title.trim()||item.title.length>300||typeof item.done!=="boolean")return false;
    ids.add(item.id);
   }
  }
 }
 return true;
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.headers.get("origin")&&req.headers.get("origin")!==ORIGIN)return reply(403,{error:"origin"});
 if(!["GET","PUT"].includes(req.method))return reply(405,{error:"method"});
 const key=req.headers.get("x-family-key")||"";
 if(!/^[a-f0-9]{64}$/.test(key))return reply(401,{error:"invalid_invite"});
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(key)))).map(b=>b.toString(16).padStart(2,"0")).join("");
 const dburl=Deno.env.get("SUPABASE_URL")+"/rest/v1/family_trips?or=(access_hash.eq."+hash+",additional_access_hash.eq."+hash+")";
 const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 const dbheaders={apikey:secret,Authorization:"Bearer "+secret,"Content-Type":"application/json"};
 try{
  const auth=await fetch(dburl+"&select=id,document,version,updated_at",{headers:dbheaders});
  if(!auth.ok)return reply(503,{error:"storage_unavailable"});
  const rows=await auth.json();
  if(rows.length!==1)return reply(401,{error:"invalid_invite"});
  const row=rows[0];
  if(req.method==="GET")return reply(200,{document:{...row.document,packing:row.document.packing||DEFAULT_PACKING,shopping:row.document.shopping||DEFAULT_SHOPPING},version:row.version,updated_at:row.updated_at});
  if(Number(req.headers.get("content-length")||0)>180000)return reply(413,{error:"too_large"});
  const reader=req.body?.getReader();if(!reader)return reply(400,{error:"body"});
  let bytes=0;const chunks=[];
  for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>180000){await reader.cancel();return reply(413,{error:"too_large"});}chunks.push(value);}
  const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
  let input;try{input=JSON.parse(new TextDecoder().decode(buffer));}catch{return reply(400,{error:"json"});}
  if(!input||!Number.isInteger(input.version)||!valid(input.document))return reply(400,{error:"invalid_document"});
  const doc={days:input.document.days.map(d=>({id:d.id,label:d.label,subtitle:d.subtitle,items:d.items.map(i=>({id:i.id,start:i.start,end:i.end,title:i.title,detail:i.detail,done:i.done}))}))};
  // Old clients may omit packing. Preserve it while enforcing the same CAS version.
  const packing=input.document.packing||row.document.packing||DEFAULT_PACKING;
  doc.packing={groups:packing.groups.map(g=>({id:g.id,name:g.name,items:g.items.map(i=>({id:i.id,title:i.title,done:i.done}))}))};
  const shopping=input.document.shopping||row.document.shopping||DEFAULT_SHOPPING;
  doc.shopping={groups:shopping.groups.map(g=>({id:g.id,name:g.name,items:g.items.map(i=>({id:i.id,title:i.title,done:i.done}))}))};
  const updated=await fetch(dburl+"&version=eq."+input.version+"&select=document,version,updated_at",{method:"PATCH",headers:{...dbheaders,Prefer:"return=representation"},body:JSON.stringify({document:doc,version:input.version+1,updated_at:new Date().toISOString()})});
  if(!updated.ok)return reply(503,{error:"storage_unavailable"});
  const result=await updated.json();if(result.length!==1)return reply(409,{error:"conflict"});
  return reply(200,result[0]);
 }catch{return reply(503,{error:"unavailable"});}
});
