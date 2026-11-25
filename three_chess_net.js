/* Stage 7: server-authoritative three-player chess, independently routed.
 * 60Hz compact connection ticks. Full state only after a real game change.
 * All rules, moves, eliminations and wins computed server-side.
 */
'use strict';
const crypto=require('node:crypto');const E=require('./three_chess_engine.js');
module.exports=function({send,peers}){
 const rooms=new Map(),sessions=new Map(),LIMIT=70,GRACE_MS=30000,MAX_PENDING=192*1024;
 const rid=()=>crypto.randomBytes(5).toString('hex').toUpperCase();
 const clean=(s,fallback)=>String(s||fallback).replace(/[<>\x00-\x1f\x7f]/g,'').trim().slice(0,24)||fallback;
 const to=(p,m)=>{if(p&&!p.closed)send(p,m)};
 const state=r=>({type:'tri_state',roomId:r.id,name:r.name,status:r.status,game:r.game,seq:r.gameState.seq,position:r.gameState,players:r.players.map(p=>({id:p.id,name:p.triName,color:p.triColor,connected:!p.closed,rematch:!!p.triRematch})),startedAt:r.startedAt});
 const spread=r=>{const m=state(r);for(const p of r.players)to(p,m);};
 const listed=()=>[...rooms.values()].filter(r=>r.status==='waiting'&&r.players.length<3).map(r=>({id:r.id,name:r.name,count:r.players.length,remaining:3-r.players.length}));
 function sendList(){const m={type:'tri_rooms',rooms:listed()};for(const p of peers)if(p.isThree)to(p,m);}
 function joined(p,r,c){p.triRoom=r;p.triName=clean(p.triName,'플레이어');p.triColor=c;p.triRematch=false;p.triToken=crypto.randomBytes(20).toString('base64url');sessions.set(p.triToken,p);to(p,{type:'tri_joined',roomId:r.id,color:c,token:p.triToken});}
 function stopTick(r){if(r.tick){clearInterval(r.tick);r.tick=null;}}
 function startTick(r){stopTick(r);r.tick=setInterval(()=>{
  if(r.status!=='playing'){stopTick(r);return;}
  const m={type:'tri_tick',seq:r.gameState.seq,now:Date.now(),turn:r.gameState.t};
  for(const p of r.players)if(!p.closed&&p.socket.writableLength<MAX_PENDING)to(p,m);
 },1000/60);r.tick.unref?.();}
 function maybeStart(r){
  if(r.status==='waiting'&&r.players.length===3&&r.players.every(p=>p.triColor&&!p.closed)){
   r.status='playing';r.gameState=E.fresh();r.startedAt=Date.now();startTick(r);return true;
  }
  return false;
 }
 function clear(p){if(p.triTimer){clearTimeout(p.triTimer);p.triTimer=null;}if(p.triToken){sessions.delete(p.triToken);p.triToken=null;}p.triRoom=null;}
 function detach(p){const r=p.triRoom;if(!r)return;
  const color=p.triColor;clear(p);r.players=r.players.filter(x=>x!==p);
  if(!r.players.length){stopTick(r);rooms.delete(r.id);sendList();return;}
  if(r.status==='playing'&&r.gameState.alive[color]){
   r.gameState=E.resign(r.gameState,color);r.status=r.gameState.status==='playing'?'playing':'ended';
  }
  if(r.status==='waiting')r.status='waiting';
  if(r.status!=='playing')stopTick(r);
  spread(r);sendList();
 }
 function disconnected(p){if(!p.triRoom)return;const r=p.triRoom;
  if(p.triTimer)clearTimeout(p.triTimer);
  p.triTimer=setTimeout(()=>{p.triTimer=null;if(p.closed&&p.triRoom)detach(p);},GRACE_MS);
  p.triTimer.unref?.();spread(r);
 }
 function err(p,msg){to(p,{type:'tri_error',message:msg});}
 function msg(p,m){if(!m||typeof m!=='object'||Array.isArray(m))return;
  if(m.type==='tri_probe'){const ts=Number(m.ts);if(Number.isFinite(ts))to(p,{type:'tri_pong',ts,now:Date.now()});return;}
  if(m.type==='tri_list'){to(p,{type:'tri_rooms',rooms:listed()});return;}
  if(m.type==='tri_resume'){
   const old=sessions.get(String(m.token||''));if(!old||!old.closed||!old.triRoom){to(p,{type:'tri_resume_failed'});return;}
   const r=old.triRoom;if(old.triTimer){clearTimeout(old.triTimer);old.triTimer=null;}
   p.id=old.id;p.triName=old.triName;p.triColor=old.triColor;p.triToken=old.triToken;p.triRoom=r;p.triRematch=old.triRematch;
   r.players=r.players.map(x=>x===old?p:x);old.triRoom=null;old.triToken=null;sessions.set(p.triToken,p);
   maybeStart(r);to(p,{type:'tri_joined',roomId:r.id,color:p.triColor,token:p.triToken});spread(r);sendList();return;
  }
  if(m.type==='tri_create'){
   if(p.triRoom)return err(p,'이미 방에 있습니다.');if(rooms.size>=LIMIT)return err(p,'공개방이 가득 찼습니다.');
   const r={id:rid(),name:clean(m.name,'3인 체스 공개방'),status:'waiting',players:[],gameState:E.fresh(),game:1,startedAt:null,tick:null};while(rooms.has(r.id))r.id=rid();
   rooms.set(r.id,r);p.triName=clean(m.nickname,'백 플레이어');r.players.push(p);joined(p,r,null);spread(r);sendList();return;
  }
  if(m.type==='tri_join'){
   if(p.triRoom)return err(p,'이미 방에 있습니다.');const r=rooms.get(String(m.roomId||''));
   if(!r||r.status!=='waiting'||r.players.length>=3)return err(p,'참가할 수 없는 방입니다.');
   p.triName=clean(m.nickname,'플레이어');r.players.push(p);joined(p,r,null);
   // Colour selection is independent for every player; game starts only when all three have chosen.
   // Do not start when the third participant merely joins.
   spread(r);sendList();return;
  }
  if(m.type==='tri_leave'){detach(p);to(p,{type:'tri_left'});return;}
  const r=p.triRoom;if(!r)return err(p,'공개방에 먼저 참가하세요.');
  if(m.type==='tri_choose_color'){
   if(r.status!=='waiting')return err(p,'이미 대전이 시작됐습니다.');
   const color=String(m.color||'');
   if(!E.C.includes(color))return err(p,'올바르지 않은 진영입니다.');
   if(p.triColor)return err(p,'이미 진영을 선택했습니다.');
   if(r.players.some(other=>other!==p&&other.triColor===color))return err(p,'다른 플레이어가 선택한 진영입니다.');
   p.triColor=color;
   to(p,{type:'tri_chosen',color});
   maybeStart(r);
   spread(r);sendList();return;
  }
  if(m.type==='tri_sync'){spread(r);return;}
  if(m.type==='tri_move'){
   if(r.status!=='playing')return err(p,'진행 중인 게임이 아닙니다.');
   if(!r.gameState.alive[p.triColor])return err(p,'이미 탈락한 진영입니다.');
   if(r.gameState.t!==p.triColor)return err(p,'현재 차례가 아닙니다.');
   if(!Number.isInteger(m.seq)||m.seq!==r.gameState.seq){err(p,'게임 상태가 갱신됐습니다.');spread(r);return;}
   const mv=E.move(r.gameState,{f:m.f,t:m.t,promote:m.promote});if(!mv.ok)return err(p,mv.error);
   r.gameState=mv.state;r.status=mv.state.status==='playing'?'playing':'ended';
   if(r.status==='ended')stopTick(r);spread(r);return;
  }
  if(m.type==='tri_resign'){
   if(r.status!=='playing'||!r.gameState.alive[p.triColor])return;
   r.gameState=E.resign(r.gameState,p.triColor);r.status=r.gameState.status==='playing'?'playing':'ended';if(r.status==='ended')stopTick(r);spread(r);return;
  }
  if(m.type==='tri_rematch'){
   if(!['ended','draw'].includes(r.status))return;
   p.triRematch=true;
   if(r.players.length===3&&r.players.every(x=>x.triRematch&&!x.closed)){
    r.players.forEach(x=>x.triRematch=false);r.gameState=E.fresh();r.game++;r.status='playing';r.startedAt=Date.now();startTick(r);
   }spread(r);return;
  }
 }
 return {msg,disconnected,sendList,shutdown(){for(const r of rooms.values())stopTick(r);}};
};
