(function(root){
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x));
  const equal=(a,b)=>{
    if(a===b)return true;
    if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
    const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&equal(a[k],b[k]));
  };
  const fields=['start','end','title','detail','done'];
  const DEFAULT_INFO={title:'제주 가족여행 플래너',description:'2026.10.26 ~ 10.30 · 그랜드 하얏트 제주\n렌터카 10/26 12:30 대여 · 10/30 11:30 반납'};
  const infoOf=doc=>({title:doc.title??DEFAULT_INFO.title,description:doc.description??DEFAULT_INFO.description});
  const MAX_DAYS=60;
  const DEFAULT_PACKING={groups:[{id:'pack-ayoon',name:'아윤이짐',items:[{id:'pack-pajamas',title:'잠옷',done:false},{id:'pack-toys',title:'장난감',done:false}]},{id:'pack-common',name:'공통',items:[{id:'pack-toothbrushes',title:'칫솔 3개',done:false}]}]};
  const DEFAULT_SHOPPING={groups:[{id:'shopping-list',name:'구매 목록',items:[{id:'shop-suitcase',title:'여행캐리어',done:false},{id:'shop-kettle',title:'전기포트',done:false}]}]};
  const shoppingOf=doc=>doc.shopping||DEFAULT_SHOPPING;
  const packingOf=doc=>doc.packing||DEFAULT_PACKING;
  function mergePackingRecords(base,local,remote,group,choice,conflicts){
    let result=copy(remote);
    for(const id of new Set([...base,...local].map(x=>x.id))){
      const before=base.find(x=>x.id===id),mine=local.find(x=>x.id===id),theirs=result.find(x=>x.id===id);
      if(equal(before,mine))continue;
      const conflict=field=>{conflicts.push({title:(mine||theirs||before).name||(mine||theirs||before).title,field,mine:mine||null,theirs:theirs||null});return choice==='mine';};
      if(!before){if(!theirs)result.push(copy(mine));else if(!equal(mine,theirs)&&conflict('항목 추가'))Object.assign(theirs,copy(mine));}
      else if(!mine){if(theirs&&(equal(before,theirs)||conflict('항목 삭제')))result=result.filter(x=>x.id!==id);}
      else if(!theirs){if(conflict('삭제된 항목'))result.push(copy(mine));}
      else{
        for(const key of group?['name']:['title','done'])if(mine[key]!==before[key]){
          if(theirs[key]===before[key]||theirs[key]===mine[key]||conflict(key==='name'?'그룹명':key==='done'?'완료 체크':'항목명'))theirs[key]=mine[key];
        }
        if(group)theirs.items=mergePackingRecords(before.items,mine.items,theirs.items,false,choice,conflicts);
      }
    }
    return result;
  }

  // Three-way merge: only locally changed fields are applied to the latest document.
  function merge(base,local,remote,choice){
    const document=copy(remote), conflicts=[];
    for(const dayId of new Set([...base.days,...local.days].map(d=>d.id))){
      const beforeDay=base.days.find(d=>d.id===dayId);
      const mineDay=local.days.find(d=>d.id===dayId);
      const targetDay=document.days.find(d=>d.id===dayId);
      if(equal(beforeDay,mineDay))continue;
      const dayConflict=(field,mine=mineDay||null,theirs=targetDay||null)=>{conflicts.push({title:(mineDay||targetDay||beforeDay).label,field,mine,theirs});return choice==='mine';};
      if(!beforeDay){
        if(!targetDay)document.days.push(copy(mineDay));
        else if(!equal(mineDay,targetDay)&&dayConflict('일차 추가'))Object.assign(targetDay,copy(mineDay));
        continue;
      }
      if(!mineDay){
        if(targetDay&&(equal(beforeDay,targetDay)||dayConflict('일차 삭제')))document.days=document.days.filter(d=>d.id!==dayId);
        continue;
      }
      if(!targetDay){if(dayConflict('삭제된 일차'))document.days.push(copy(mineDay));continue;}
      for(const field of ['label','subtitle'])if(mineDay[field]!==beforeDay[field]){
        if(targetDay[field]===beforeDay[field]||targetDay[field]===mineDay[field]||dayConflict(field,mineDay[field],targetDay[field]))targetDay[field]=mineDay[field];
      }
      const ids=new Set([...beforeDay.items,...mineDay.items].map(i=>i.id));
      for(const id of ids){
        const before=beforeDay.items.find(i=>i.id===id);
        const mine=mineDay.items.find(i=>i.id===id);
        const theirs=targetDay.items.find(i=>i.id===id);
        if(equal(before,mine))continue;
        const conflict=(field,a,b)=>{conflicts.push({title:(mine||theirs||before).title,field,mine:a,theirs:b});return choice==='mine';};
        if(!before){
          if(!theirs)targetDay.items.push(copy(mine));
          else if(!equal(theirs,mine)&&conflict('일정 전체',mine,theirs))Object.assign(theirs,copy(mine));
        }else if(!mine){
          if(theirs&&(equal(theirs,before)||conflict('삭제',null,theirs)))targetDay.items=targetDay.items.filter(i=>i.id!==id);
        }else if(!theirs){
          if(conflict('삭제된 일정',mine,null))targetDay.items.push(copy(mine));
        }else{
          const remoteTime={start:theirs.start,end:theirs.end};
          for(const field of fields){
            if(mine[field]===before[field])continue;
            if(theirs[field]===before[field]||theirs[field]===mine[field]||conflict(field,mine[field],theirs[field]))theirs[field]=mine[field];
          }
          // Individually valid time edits can combine into an invalid range.
          if(Boolean(theirs.start)!==Boolean(theirs.end)||theirs.end<theirs.start){
            const useMine=conflict('시간',mine.start+' ~ '+mine.end,remoteTime.start+' ~ '+remoteTime.end);
            Object.assign(theirs,useMine?{start:mine.start,end:mine.end}:remoteTime);
          }
        }
      }
    }
    // Compare order only for surviving shared days; additions/deletions are not reorders.
    const common=base.days.map(d=>d.id).filter(id=>local.days.some(d=>d.id===id)&&remote.days.some(d=>d.id===id)&&document.days.some(d=>d.id===id));
    const localOrder=local.days.map(d=>d.id).filter(id=>common.includes(id));
    const remoteOrder=remote.days.map(d=>d.id).filter(id=>common.includes(id));
    let preferred=remote.days,secondary=local.days;
    if(!equal(common,localOrder)){
      let useMine=true;
      if(!equal(common,remoteOrder)&&!equal(localOrder,remoteOrder)){
        conflicts.push({title:'여행 일차',field:'일차 순서',mine:local.days.map(d=>d.label).join(' → '),theirs:remote.days.map(d=>d.label).join(' → ')});
        useMine=choice==='mine';
      }
      if(useMine){preferred=local.days;secondary=remote.days;}
    }
    const ordered=preferred.map(d=>d.id).filter(id=>document.days.some(d=>d.id===id));
    for(let i=0;i<secondary.length;i++){
      const id=secondary[i].id;if(ordered.includes(id)||!document.days.some(d=>d.id===id))continue;
      const previous=secondary.slice(0,i).reverse().find(d=>ordered.includes(d.id));
      const next=secondary.slice(i+1).find(d=>ordered.includes(d.id));
      ordered.splice(previous?ordered.indexOf(previous.id)+1:next?ordered.indexOf(next.id):ordered.length,0,id);
    }
    document.days=ordered.map(id=>document.days.find(d=>d.id===id));
    for(const field of ['title','description']){
      const before=infoOf(base)[field],mine=infoOf(local)[field],theirs=infoOf(remote)[field];
      if(mine!==before){
        if(theirs===before||theirs===mine||choice==='mine')document[field]=mine;
        else conflicts.push({title:'여행 정보',field:field==='title'?'여행 제목':'부가내용',mine,theirs});
      }
    }
    if(base.packing||local.packing||remote.packing){
      document.packing={groups:mergePackingRecords(packingOf(base).groups,packingOf(local).groups,packingOf(remote).groups,true,choice,conflicts)};
    }
    if(base.shopping||local.shopping||remote.shopping)document.shopping={groups:mergePackingRecords(shoppingOf(base).groups,shoppingOf(local).groups,shoppingOf(remote).groups,true,choice,conflicts)};
    const beforeNote=base.note||'',mineNote=local.note||'',remoteNote=remote.note||'';
    if(mineNote!==beforeNote){
      if(remoteNote===beforeNote||remoteNote===mineNote||choice==='mine')document.note=mineNote;
      else conflicts.push({title:'한 줄 메모',field:'메모',mine:mineNote,theirs:remoteNote});
    }
    return {document,conflicts};
  }

  class SyncEngine{
    constructor({request,cached,onChange=()=>{},onConflict=()=>{}}){
      this.request=request;this.onChange=onChange;this.onConflict=onConflict;
      this.base=cached?copy(cached.base):null;this.document=cached?copy(cached.document):{days:[]};
      this.version=cached?.version||0;this.updatedAt=cached?.updatedAt||null;
      this.busy=false;this.pending=null;this.status='loading';this.errorStatus=0;
    }
    get ready(){return !!this.base;}
    get dirty(){return this.ready&&!equal(this.base,this.document);}
    snapshot(){return this.ready?copy({base:this.base,document:this.document,version:this.version,updatedAt:this.updatedAt}):null;}
    emit(){this.onChange(this);}
    edit(base,local){
      const result=merge(base,local,this.document);
      if(result.conflicts.length){this.pending={kind:'edit',base:copy(base),local:copy(local)};this.onConflict(result.conflicts);return false;}
      this.document=result.document;this.status='pending';this.emit();return true;
    }
    resolve(choice){
      if(!this.pending)return;
      if(this.pending.kind==='edit')this.document=merge(this.pending.base,this.pending.local,this.document,choice).document;
      else{
        const remote=this.pending.remote;
        this.document=merge(this.base,this.document,remote.document,choice).document;
        this.base=copy(remote.document);this.version=remote.version;this.updatedAt=remote.updated_at;
      }
      this.pending=null;this.status='pending';this.emit();
    }
    async run(){
      if(this.busy||this.pending)return;
      this.busy=true;this.status=this.dirty?'saving':'loading';this.emit();
      try{
        for(let attempt=0;attempt<3;attempt++){
          const remote=await this.request('GET');
          if(!this.base){this.base=copy(remote.document);this.document=copy(remote.document);}
          else{
            const result=merge(this.base,this.document,remote.document);
            if(result.conflicts.length){this.pending={kind:'network',remote};this.status='conflict';this.onConflict(result.conflicts);return;}
            this.document=result.document;this.base=copy(remote.document);
          }
          this.version=remote.version;this.updatedAt=remote.updated_at;this.emit();
          if(!this.dirty){this.status='saved';this.errorStatus=0;return;}
          const sent=copy(this.document);
          let result;
          try{result=await this.request('PUT',{document:sent,version:this.version});}
          catch(e){if(e.status===409)continue;throw e;}
          // Edits made during the request remain pending; a lost response is safe to retry.
          this.document=merge(sent,this.document,result.document).document;
          this.base=copy(result.document);this.version=result.version;this.updatedAt=result.updated_at;this.errorStatus=0;
          this.emit();
          if(!this.dirty){this.status='saved';return;}
        }
        this.status='pending';
      }catch(e){this.errorStatus=e.status||0;this.status=e.status===401?'unauthorized':'offline';}
      finally{this.busy=false;this.emit();}
    }
  }
  const api={merge,SyncEngine,copy,equal,DEFAULT_PACKING,packingOf,DEFAULT_SHOPPING,shoppingOf,DEFAULT_INFO,infoOf,MAX_DAYS};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.FamilySync=api;
})(typeof globalThis!=='undefined'?globalThis:this);
