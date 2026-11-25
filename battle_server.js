'use strict';
/* Independent stage-5 authoritative public room WebSocket protocol. */
const crypto=require('node:crypto');
const engine=require('./battle_engine.js');
module.exports=function createBattleNet({send}){
 const rooms=new Map(), clients=new Set();
 const id=()=>crypto.randomBytes(7).toString('hex');
 const token=()=>crypto.randomBytes(24).toString('base64url');
 const safe=(x,max,fallback)=>String(x||'').trim().replace(/[<>\x00-\x1f]/g,'').slice(0,max)||fallback;
 const now=()=>Date.now();
 const list=()=>[...rooms.values()].filter(r=>r.state==='waiting'&&r.players.length<r.size).map(r=>({id:r.id,name:r.name,count:r.players.length,max:r.size,mode:'battle'}));
 function pushList(){const obj={type:'battle_rooms',rooms:list()};for(const p of clients)send(p,obj)}
 function toRoom(r,m){for(const s of r.players)if(s.peer&&!s.peer.closed)send(s.peer,m)}
 function roomInfo(r){return {id:r.id,name:r.name,state:r.state,max:r.size,mode:'battle',players:r.players.map(s=>({id:s.id,name:s.name,ready:s.ready,connected:!!s.peer&&!s.peer.closed}))}}
 function updateRoom(r){for(let i=0;i<r.players.length;i++){const seat=r.players[i];if(seat.peer&&!seat.peer.closed)send(seat.peer,{type:'battle_seat',position:i})}toRoom(r,{type:'battle_room',room:roomInfo(r)});pushList()}
 // Keyframes preserve every event, board, health, score and result.
 // Between keyframes send a compact frame so the 60Hz stream is affordable.
 function report(r,force=false){
  if(!r.game)return;
  const t=now(),game=r.game;
  const boardKey=game.players.map(p=>`${p.falls}/${p.lines}/${p.topouts}/${p.events.at(-1)?.id||0}`).join('|')+
    `/${game.state}/${game.paused}/${game.winner}`;
  const full=force||boardKey!==r.lastBoardKey||t-(r.lastFullAt||0)>=1600;
  const snapshot=full?engine.snapshot(game,t):engine.liveSnapshot(game,t);
  if(full){r.lastBoardKey=boardKey;r.lastFullAt=t}
  const message={type:'battle_state',roomId:r.id,startAt:game.startAt,serverAt:t,
   frameId:++r.frameId,full,...snapshot};
  toRoom(r,message);
 }
 function reset(r){
  r.state='countdown';r.game=engine.newGame(now()+3200,Math.random,r.size);r.players.forEach(s=>s.ready=false);r.lastBoardKey='';r.lastFullAt=0;r.frameId=0;
  toRoom(r,{type:'battle_start',startAt:r.game.startAt,serverAt:now()});updateRoom(r);report(r);
 }
 function timeout(r,seat){
  if(!rooms.has(r.id)||!r.players.includes(seat)||seat.peer)return;
  if(r.game&&['countdown','playing'].includes(r.state)){
   const index=r.players.indexOf(seat);
   // Three-player matches continue after the disconnected player forfeits;
   // the other two do not lose their entire game.
   const p=r.game.players[index];
   if(p?.hp>0)engine.hurt(r.game,index,p.hp,'재접속 제한시간 초과');
   if(r.game.state==='finished')r.state='finished';
   if(!r.game.players.some((g,i)=>g.hp>0&&(!r.players[i].peer||r.players[i].peer.closed)))engine.setPaused(r.game,false);
   toRoom(r,{type:'battle_notice',message:`${index+1}P 연결 복구 실패 · ${r.game.state==='finished'?'경기 종료':'남은 플레이어 대전 계속'}`});
   updateRoom(r);report(r,true);
  }else{
   r.players=r.players.filter(p=>p!==seat);
   if(!r.players.length){rooms.delete(r.id);pushList();return}
   updateRoom(r);
  }
 }
 function detach(p,immediate=false){
  clients.delete(p);
  const r=p.battleRoom,seat=p.battleSeat;
  if(!r||!seat||seat.peer!==p)return;
  seat.peer=null;p.battleRoom=null;p.battleSeat=null;
  if(seat.timer)clearTimeout(seat.timer);
  if(immediate){
   timeout(r,seat);return;
  }
  if(r.game&&['countdown','playing'].includes(r.state)&&r.game.players[r.players.indexOf(seat)]?.hp>0)engine.setPaused(r.game,true);
  seat.timer=setTimeout(()=>{seat.timer=null;timeout(r,seat)},30000);seat.timer.unref?.();
  updateRoom(r);
  toRoom(r,{type:'battle_notice',message:'상대방 연결 복구 중 · 최대 30초 동안 기다립니다.'});
 }
 function attach(p,r,seat){
  if(p.battleSeat&&p.battleSeat!==seat)return false;
  if(seat.peer&&seat.peer!==p){const old=seat.peer;old.battleSeat=null;old.battleRoom=null;try{old.socket.end()}catch{}}
  seat.peer=p;p.battleSeat=seat;p.battleRoom=r;
  if(seat.timer){clearTimeout(seat.timer);seat.timer=null}
  send(p,{type:'battle_joined',room:roomInfo(r),seatId:seat.id,seatToken:seat.token,position:r.players.indexOf(seat),serverAt:now()});
  if(r.game&&!r.game.players.some((g,i)=>g.hp>0&&(!r.players[i]?.peer||r.players[i].peer.closed)))engine.setPaused(r.game,false);
  updateRoom(r);report(r,true);return true;
 }
 function connected(p){p.isBattle=true;clients.add(p);send(p,{type:'battle_hello',serverAt:now()});send(p,{type:'battle_rooms',rooms:list()})}
 function message(p,m){
  if(!m||typeof m!=='object'||Array.isArray(m))return;
  if(m.type==='battle_list'){send(p,{type:'battle_rooms',rooms:list()});return}
  if(m.type==='battle_ping'){send(p,{type:'battle_pong',at:m.at,serverAt:now()});return}
  if(m.type==='battle_create'){
   if(p.battleRoom)return;
   if(rooms.size>=90){send(p,{type:'battle_error',message:'공개방이 가득 찼습니다.'});return}
   const size=Number(m.max)===3?3:2; // Legacy clients still create a 2P room.
   const seat={id:id(),token:token(),name:safe(m.name,14,'플레이어 1'),peer:null,ready:false,timer:null};
   const r={id:id(),name:safe(m.roomName,30,size===3?'테트리스 배틀 3인':'테트리스 배틀 공개방'),size,state:'waiting',players:[seat],game:null,created:now()};
   rooms.set(r.id,r);attach(p,r,seat);return;
  }
  if(m.type==='battle_join'){
   if(p.battleRoom)return;
   const r=rooms.get(String(m.roomId||''));if(!r||r.state!=='waiting'||r.players.length>=r.size){send(p,{type:'battle_error',message:'참가할 수 없는 방입니다.'});return}
   const seat={id:id(),token:token(),name:safe(m.name,14,`플레이어 ${r.players.length+1}`),peer:null,ready:false,timer:null};
   r.players.push(seat);attach(p,r,seat);return;
  }
  if(m.type==='battle_resume'){
   if(p.battleRoom)return;
   const r=rooms.get(String(m.roomId||'')),seat=r?.players.find(s=>s.token===m.seatToken);
   if(!seat){send(p,{type:'battle_resume_failed'});return}
   attach(p,r,seat);return;
  }
  const r=p.battleRoom,seat=p.battleSeat;
  if(!r||!seat)return;
  if(m.type==='battle_leave'){
   if(seat.peer===p){seat.peer=null;p.battleRoom=null;p.battleSeat=null;if(seat.timer)clearTimeout(seat.timer)}
   if(r.state==='playing'||r.state==='countdown'){
    if(r.game){const i=r.players.indexOf(seat),gp=r.game.players[i];if(gp?.hp>0)engine.hurt(r.game,i,gp.hp,'플레이어 퇴장');
     if(r.game.state==='finished')r.state='finished';
     if(!r.game.players.some((g,j)=>g.hp>0&&(!r.players[j]?.peer||r.players[j].peer.closed)))engine.setPaused(r.game,false);
     report(r,true);}
   }else if(r.state==='waiting'){
    r.players=r.players.filter(x=>x!==seat);if(!r.players.length)rooms.delete(r.id);else updateRoom(r);
   }
   send(p,{type:'battle_left'});pushList();return;
  }
  if(m.type==='battle_ready'){
   if(!['waiting','finished'].includes(r.state))return;
   seat.ready=!!m.ready;updateRoom(r);
   if(r.players.length===r.size&&r.players.every(s=>s.ready&&s.peer&&!s.peer.closed))reset(r);
   return;
  }
  if(m.type==='battle_input'){
   if(!r.game||r.state!=='playing'||r.game.paused||r.game.state!=='playing')return;
   const who=r.players.indexOf(seat);
   const seq=Number(m.seq),action=String(m.action||'');
   if(who<0||r.game.players[who]?.hp<=0||!Number.isSafeInteger(seq)||seq<=r.game.players[who].seq||!['left','right','rotate','down','drop','hold'].includes(action))return;
   // Per-seat action limit: guard against malicious input flooding without dropping normal play.
   const t=now();if(t-(seat.inputWindow||0)>1000){seat.inputWindow=t;seat.inputCount=0}
   if(++seat.inputCount>32)return;
   r.game.players[who].seq=seq;
   engine.input(r.game,who,action);
   if(r.game.state==='finished')r.state='finished';
   report(r,true);return;
  }
 }
 function tick(){const t=now();for(const r of rooms.values()){
  if(r.game&&['countdown','playing'].includes(r.state)){
   engine.tick(r.game,t);
   if(r.game.state==='playing')r.state='playing';
   if(r.game.state==='finished')r.state='finished';
   report(r);
  }
 }}
 // Clock cadence is corrected against monotonic time; a stalled tick is
 // skipped, never replayed as a burst of dozens of stale network frames.
 const PERIOD=1000/60;
 let stopped=false,nextAt=performance.now()+PERIOD,clock;
 function scheduleTick(){
  if(stopped)return;
  tick();
  const t=performance.now();nextAt+=PERIOD;
  if(nextAt<t)nextAt=t+PERIOD;
  clock=setTimeout(scheduleTick,Math.max(1,nextAt-t));clock.unref?.();
 }
 clock=setTimeout(scheduleTick,PERIOD);clock.unref?.();
 const gc=setInterval(()=>{
  const t=now();for(const [id,r] of rooms){
   if(t-r.created>4*3600000||r.state==='finished'&&t-r.created>3600000){
    for(const s of r.players)if(s.timer)clearTimeout(s.timer);
    rooms.delete(id)
   }
  }
 },60000);gc.unref();
 return {connected,message,disconnected:p=>detach(p),roomList:list,shutdown:()=>{stopped=true;clearTimeout(clock);clearInterval(gc)}};
};
