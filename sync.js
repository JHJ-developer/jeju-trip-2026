(function(root){
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x));
  const equal=(a,b)=>{
    if(a===b)return true;
    if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
    const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&equal(a[k],b[k]));
  };
  const fields=['start','end','title','detail','done'];
  const DEFAULT_PACKING={groups:[{id:'pack-ayoon',name:'아윤이짐',items:[{id:'pack-pajamas',title:'잠옷',done:false},{id:'pack-toys',title:'장난감',done:false}]},{id:'pack-common',name:'공통',items:[{id:'pack-toothbrushes',title:'칫솔 3개',done:false}]}]};
  const packingOf=doc=>doc.packing||DEFAULT_PACKING;
  function mergePackingRecords(base,local,remote,group,choice,conflicts){
    let result=copy(remote);
    for(const id of new Set([...base,...local].map(x=>x.id))){
      const before=base.find(x=>x.id===id),mine=local.find(x=>x.id===id),theirs=result.find(x=>x.id===id);
      if(equal(before,mine))continue;
      const conflict=field=>{conflicts.push({title:(mine||theirs||before).name||(mine||theirs||before).title,field,mine:mine||null,theirs:theirs||null});return choice==='mine';};
      if(!before){if(!theirs)result.push(copy(mine));else if(!equal(mine,theirs)&&conflict('준비물 추가'))Object.assign(theirs,copy(mine));}
      else if(!mine){if(theirs&&(equal(before,theirs)||conflict('준비물 삭제')))result=result.filter(x=>x.id!==id);}
      else if(!theirs){if(conflict('삭제된 준비물'))result.push(copy(mine));}
      else{
        for(const key of group?['name']:['title','done'])if(mine[key]!==before[key]){
          if(theirs[key]===before[key]||theirs[key]===mine[key]||conflict(key==='name'?'그룹명':key==='done'?'챙김 체크':'준비물명'))theirs[key]=mine[key];
        }
        if(group)theirs.items=mergePackingRecords(before.items,mine.items,theirs.items,false,choice,conflicts);
      }
    }
    return result;
  }

  // Three-way merge: only locally changed fields are applied to the latest document.
  function merge(base,local,remote,choice){
    const document=copy(remote), conflicts=[];
    for(const mineDay of local.days){
      const beforeDay=base.days.find(d=>d.id===mineDay.id);
      const targetDay=document.days.find(d=>d.id===mineDay.id);
      if(!beforeDay||!targetDay)continue;
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
    if(base.packing||local.packing||remote.packing){
      document.packing={groups:mergePackingRecords(packingOf(base).groups,packingOf(local).groups,packingOf(remote).groups,true,choice,conflicts)};
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
  const api={merge,SyncEngine,copy,equal,DEFAULT_PACKING,packingOf};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.FamilySync=api;
})(typeof globalThis!=='undefined'?globalThis:this);
