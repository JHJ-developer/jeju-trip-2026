/* Long-press handles only. Native touch scrolling stays enabled until activation. */
(function(root){
 root.PackingSort={install(container,onDrop){
  let state=null,suppressUntil=0;
  const rows=group=>Array.from(group.querySelectorAll('[data-sort-item]'));
  function cancel(){if(!state)return;clearTimeout(state.timer);cancelAnimationFrame(state.frame);state.row.classList.remove('pack-dragging');state.handle.setAttribute('aria-pressed','false');state=null;}
  function finish(commit){
   if(!state)return;const s=state,order=rows(s.group).map(r=>r.dataset.sortItem);
   if(s.active)suppressUntil=Date.now()+500;
   cancel();
   // Restore preview before the app performs its normal versioned save/render.
   s.original.forEach(row=>s.group.insertBefore(row,s.anchor));
   if(commit&&s.active&&order.join('|')!==s.original.map(r=>r.dataset.sortItem).join('|'))onDrop(s.group.dataset.packDisclosure,order);
  }
  function place(y){
   const s=state;if(!s?.active)return;s.y=y;
   const next=rows(s.group).find(r=>r!==s.row&&y<r.getBoundingClientRect().top+r.getBoundingClientRect().height/2);
   s.group.insertBefore(s.row,next||s.anchor);
  }
  function tick(){if(!state?.active)return;const y=state.y;
   if(y<75)window.scrollBy(0,-7);else if(y>window.innerHeight-75)window.scrollBy(0,7);
   place(y);state.frame=requestAnimationFrame(tick);
  }
  function begin(handle,x,y,kind,id){
   if(state||handle.disabled)return;const row=handle.closest('[data-sort-item]'),group=row.closest('[data-pack-disclosure]'),original=rows(group);
   state={row,group,handle,original,anchor:original.at(-1).nextSibling,x,y,startY:y,kind,id,active:false};
   const s=state;s.timer=setTimeout(()=>{if(state!==s||!handle.isConnected)return; s.active=true;row.classList.add('pack-dragging');handle.setAttribute('aria-pressed','true');tick();},800);
  }
  function move(x,y,event){if(!state)return;if(!state.active){if(Math.hypot(x-state.x,y-state.startY)>8)finish(false);return;}
   if(!event.cancelable){finish(false);return;}event.preventDefault();place(y);
  }
  container.addEventListener('touchstart',e=>{if(e.touches.length!==1){finish(false);return;}const h=e.target.closest('[data-sort-handle]');if(h){const t=e.touches[0];begin(h,t.clientX,t.clientY,'touch',t.identifier);}},{passive:true});
  container.addEventListener('touchmove',e=>{if(state?.kind!=='touch')return;if(e.touches.length!==1){finish(false);return;}const t=e.touches[0];move(t.clientX,t.clientY,e);},{passive:false});
  container.addEventListener('touchend',()=>{if(state?.kind==='touch')finish(true);},{passive:true});
  container.addEventListener('touchcancel',()=>finish(false),{passive:true});
  container.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||e.button!==0)return;const h=e.target.closest('[data-sort-handle]');if(h)begin(h,e.clientX,e.clientY,'pointer',e.pointerId);});
  window.addEventListener('pointermove',e=>{if(state?.kind==='pointer'&&state.id===e.pointerId)move(e.clientX,e.clientY,e);});
  window.addEventListener('pointerup',e=>{if(state?.kind==='pointer'&&state.id===e.pointerId)finish(true);});
  window.addEventListener('pointercancel',()=>finish(false));
  window.addEventListener('scroll',()=>{if(state&&!state.active)finish(false);},{passive:true});
  window.addEventListener('blur',()=>finish(false));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finish(false);});
  container.addEventListener('contextmenu',e=>{if(e.target.closest('[data-sort-handle]'))e.preventDefault();});
  container.addEventListener('click',e=>{if(e.target.closest('[data-sort-handle]')){e.preventDefault();e.stopPropagation();}else if(Date.now()<suppressUntil){e.preventDefault();e.stopPropagation();}},true);
  container.addEventListener('keydown',e=>{if(e.key==='Escape'){finish(false);return;}const h=e.target.closest('[data-sort-handle]');if(!h||h.disabled||!['ArrowUp','ArrowDown'].includes(e.key))return;
   e.preventDefault();finish(false);const group=h.closest('[data-pack-disclosure]'),order=rows(group).map(r=>r.dataset.sortItem),i=order.indexOf(h.dataset.sortHandle),j=i+(e.key==='ArrowUp'?-1:1);
   if(j<0||j>=order.length)return;[order[i],order[j]]=[order[j],order[i]];onDrop(group.dataset.packDisclosure,order);
   Array.from(container.querySelectorAll('[data-sort-handle]')).find(el=>el.dataset.sortHandle===h.dataset.sortHandle)?.focus();
  });
  return {cancel:()=>finish(false),get busy(){return !!state;}};
 }};
})(window);
