/* Tricky Tower Mini - zero-dependency public-room multiplayer server.
   Node.js 20+ required. Start with: node server.js
   The game uses a simple server relaying opponent snapshots, not transferring physical pieces.
*/
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const abilityNet=require('./ability_public.js')({send:(p,m)=>send(p,m)});
const battleNet=require('./battle_server.js')({send:(p,m)=>send(p,m)});
let hybridNet;
let threeNet;
const PORT = Number(process.env.PORT || 8787);
const MAX_ROOMS = 80;
const MAX_MESSAGE = 32768;
const MAX_PEERS = 160;
const GRACE_MS = Math.max(1500, Math.min(60000, Number(process.env.RECONNECT_GRACE_MS) || 30000));
const rooms = new Map();
const sessions = new Map();
let shuttingDown = false;
const peers = new Set();
let chessNet;
const now = () => Date.now();
const id = () => crypto.randomBytes(6).toString('hex');
const clean = (x, max, fallback='') => String(x || '').replace(/[\x00-\x1f\x7f<>]/g,'').trim().slice(0, max) || fallback;
const staticHtml = fs.readFileSync(path.join(__dirname,'index.html'));
const abilityHtml=fs.readFileSync(path.join(__dirname,'ability_chess.html'));
const abilityLobby=fs.readFileSync(path.join(__dirname,'ability_lobby.html'));
const abilityTransport=fs.readFileSync(path.join(__dirname,'ability_transport.js'));
const battleHtml=fs.readFileSync(path.join(__dirname,'battle.html'));
const chessHtml = fs.readFileSync(path.join(__dirname,'chess.html'));
const chessEngineJs = fs.readFileSync(path.join(__dirname,'chess_engine.js'));
const hybridHtml=fs.readFileSync(path.join(__dirname,'hybrid.html'));
const hybridEngineJs=fs.readFileSync(path.join(__dirname,'hybrid_engine.js'));
const threeHtml=fs.readFileSync(path.join(__dirname,'three_chess.html'));
const threeEngineJs=fs.readFileSync(path.join(__dirname,'three_chess_engine.js'));

const BOOT_AT = Date.now();

const server = http.createServer(async(req,res)=>{
 // Treat query parameters as game/session data, not as part of the static filename.
 // Preserve req.url intact for API handlers and WebSocket handshakes.
 let pathname;
 try { pathname = new URL(req.url, 'http://localhost').pathname; }
 catch { res.writeHead(400);res.end('Bad request');return; }
 if(await abilityNet.http(req,res))return;
 if(req.method !== 'GET'){res.writeHead(405);res.end('Method not allowed');return;}
 if(pathname==='/'||pathname==='/index.html'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(staticHtml);
 }else if(pathname==='/chess.html'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(chessHtml);
 }else if(pathname==='/chess_engine.js'){
  res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(chessEngineJs);
 }else if(pathname==='/hybrid.html'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(hybridHtml);
 }else if(pathname==='/hybrid_engine.js'){
  res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(hybridEngineJs);
 }else if(pathname==='/three_chess.html'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(threeHtml);
 }else if(pathname==='/three_chess_engine.js'){
  res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(threeEngineJs);
 }else if(pathname==='/ability_chess.html'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(abilityHtml);
 }else if(pathname==='/ability_lobby.html'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(abilityLobby);
 }else if(pathname==='/battle.html'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(battleHtml);
 }else if(pathname==='/ability_transport.js'){
  res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(abilityTransport);
 }else if(pathname==='/health'){
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify({ok:true,version:'10.10.0',online:peers.size,rooms:rooms.size,uptimeSeconds:Math.floor((Date.now()-BOOT_AT)/1000)}));
 }else{res.writeHead(404);res.end('Not found')}
});

function frame(payload,op=1){const b=Buffer.isBuffer(payload)?payload:Buffer.from(payload);let head;
 if(b.length<126){head=Buffer.from([0x80|op,b.length])}
 else if(b.length<=65535){head=Buffer.alloc(4);head[0]=0x80|op;head[1]=126;head.writeUInt16BE(b.length,2)}
 else{head=Buffer.alloc(10);head[0]=0x80|op;head[1]=127;head.writeBigUInt64BE(BigInt(b.length),2)}
 return Buffer.concat([head,b]);}
// Stage 4 uses sizeable (sometimes hundreds of KB) authoritative snapshots.
// Keep WebSocket writes bounded: coalesce only replaceable state, while keeping
// control/move packets ordered and lossless. Stages 1/2/3/5 keep their old path.
const ABILITY_LOW_WATER=128*1024, ABILITY_HIGH_WATER=384*1024;
function abilityPacketKind(msg){
 if(msg?.type==='net_tick')return 'ephemeral';
 if(msg?.type!=='peer_channel_data')return 'critical';
 const data=msg.data||{},kind=String(data.priority||'').toLowerCase();
 if(kind==='critical'||data.requiresAck===true)return 'critical';
 if(kind==='ephemeral')return 'ephemeral';
 const type=String(data.messageType||data.type||'');
 if(kind==='state'||['STATE_UPDATE','INTERACTION_STATE','LOBBY_STATE','stateSnapshot','interactionState','lobbyState','clockSync'].includes(type))return 'state';
 return 'critical';
}
function pumpAbility(p){
 if(p.closed||!p.socket.writable)return;
 if(!p.abilityQueue)return;
 const q=p.abilityQueue;
 if(p.socket.writableLength>=ABILITY_HIGH_WATER)return;
 let sent=0;
 // Important commands and acknowledgements have precedence over stale visuals.
 while(q.critical.length&&p.socket.writableLength<ABILITY_HIGH_WATER&&sent++<24){
  const item=q.critical.shift();q.ids.delete(item.id);q.bytes-=item.bytes;
  try{p.socket.write(item.frame)}catch{return close(p)}
 }
 if(q.critical.length)return;
 for(const [key,item] of q.states){
  if(p.socket.writableLength>=ABILITY_HIGH_WATER||sent++>=32)break;
  q.states.delete(key);q.bytes-=item.bytes;
  try{p.socket.write(item.frame)}catch{return close(p)}
 }
}
function sendAbility(p,msg){
 if(msg?.type==='net_tick'&&(p.socket.writableLength>ABILITY_LOW_WATER||p.abilityQueue?.critical.length))return;
 const kind=abilityPacketKind(msg);
 let f;
 try{f=frame(JSON.stringify(msg))}catch{return}
 const congested=p.socket.writableLength>=ABILITY_HIGH_WATER||
   !!p.abilityQueue?.critical.length||!!p.abilityQueue?.states.size;
 if(!congested){try{p.socket.write(f)}catch{close(p)}return}
 if(kind==='ephemeral')return; // Never let cosmetic signals delay moves.
 if(!p.abilityQueue){
  p.abilityQueue={critical:[],states:new Map(),ids:new Set(),bytes:0};
  p.socket.on('drain',()=>pumpAbility(p));
 }
 const q=p.abilityQueue;
 if(kind==='state'){
  const d=msg.data||{};
  const key=String(msg.channel||'')+':'+String(d.stateKey||d.messageType||d.type||'state');
  const prev=q.states.get(key);if(prev)q.bytes-=prev.bytes;
  q.states.set(key,{frame:f,bytes:f.length});q.bytes+=f.length;
 }else{
  const id=String(msg.channel||'')+':'+String(msg.data?.packetId||msg.type||'')+':'+String(msg.type);
  if(q.ids.has(id))return; // A retransmit is already queued, not lost.
  q.critical.push({id,frame:f,bytes:f.length});q.ids.add(id);q.bytes+=f.length;
 }
 // An extremely slow peer must not exhaust the server.  Avoid closing just
 // because its TCP buffer temporarily rises; bounded pending state is replaceable.
 if(q.bytes>32*1024*1024){
  // Prefer dropping replaceable snapshots. Never discard a game command.
  q.bytes-=Array.from(q.states.values()).reduce((sum,x)=>sum+x.bytes,0);
  q.states.clear();
 }
 if(!p.abilityQueueTimer){
  p.abilityQueueTimer=setInterval(()=>{
    if(p.closed){clearInterval(p.abilityQueueTimer);p.abilityQueueTimer=null;return}
    pumpAbility(p);
  },50);
  p.abilityQueueTimer.unref?.();
 }
 pumpAbility(p);
}
// A slow Stage-5 recipient only needs the newest live frame. Keep the next
// keyframe separately so dropping a delta can never lose a newly placed block.
const BATTLE_LOW_WATER=96*1024;
function flushBattle(p){
 if(p.closed||!p.socket.writable||p.socket.writableLength>BATTLE_LOW_WATER)return;
 const q=p.battleQueue;if(!q)return;
 if(q.full){const f=q.full;q.full=null;try{p.socket.write(f)}catch{return close(p)}}
 if(q.live&&p.socket.writableLength<=BATTLE_LOW_WATER){const f=q.live;q.live=null;try{p.socket.write(f)}catch{return close(p)}}
}
function sendBattle(p,msg){
 if(msg.type!=='battle_state'){
  // Control packets must not be coalesced; preserve ordering.
  try{p.socket.write(frame(JSON.stringify(msg)))}catch{close(p)}
  return;
 }
 let f;try{f=frame(JSON.stringify(msg))}catch{return}
 if(p.socket.writableLength<=BATTLE_LOW_WATER&&!p.battleQueue?.full){
  if(p.battleQueue)p.battleQueue.live=null; // newer frame supersedes queued old live state
  try{p.socket.write(f)}catch{close(p)}return;
 }
 if(!p.battleQueue){p.battleQueue={full:null,live:null};p.socket.on('drain',()=>flushBattle(p))}
 if(msg.full){p.battleQueue.full=f;p.battleQueue.live=null}
 else p.battleQueue.live=f;
 flushBattle(p);
}
function send(p,msg){if(!p||p.closed||!p.socket.writable)return;
 if(p.isBattle){sendBattle(p,msg);return}
 if(p.isAbility){sendAbility(p,msg);return}
 if(p.socket.writableLength>1048576){close(p);return}
 try{p.socket.write(frame(JSON.stringify(msg)))}catch{close(p)}
}
function push(p,msg){send(p,msg)}
function error(p,message){send(p,{type:'error',message})}
function members(room){return room.players.map(p=>({id:p.id,nickname:p.nickname,ready:p.ready,connected:!p.closed}))}
function info(room){return {id:room.id,name:room.name,stage:room.stage,state:room.state,players:members(room)}}
function roomList(){return Array.from(rooms.values()).filter(r=>r.state==='waiting').map(r=>({id:r.id,name:r.name,stage:r.stage,count:r.players.length,state:r.state})).slice(0,MAX_ROOMS)}
function broadcastRooms(){const message={type:'rooms',rooms:roomList()};for(const p of peers)send(p,message)}
function broadcast(room,msg){for(const p of room.players)send(p,msg)}
function broadcastRoom(room){broadcast(room,{type:'room',room:info(room)});broadcastRooms()}
function finalResults(room){return room.players.map(p=>({id:p.id,nickname:p.nickname,height:p.result?.height??p.lastHeight??0,placed:p.result?.placed??p.lastPlaced??0,elapsed:p.result?.elapsed??0}))}
function result(room,winner,reason){if(room.state==='finished')return;room.state='finished';room.lastMatchMessage={type:'match_result',winner,reason,results:finalResults(room)};broadcast(room,room.lastMatchMessage);broadcastRooms()}
function registerSession(p){
 p.resumeToken=crypto.randomBytes(24).toString('base64url');sessions.set(p.resumeToken,p);
}
function leave(p,disconnected=false){
 if(p.reconnectTimer){clearTimeout(p.reconnectTimer);p.reconnectTimer=null}
 if(p.resumeToken){sessions.delete(p.resumeToken);p.resumeToken=null}
 const r=p.room;if(!r)return;
 p.room=null;p.ready=false;p.result=null;r.players=r.players.filter(x=>x!==p);
 if(!r.players.length){rooms.delete(r.id);broadcastRooms();if(!disconnected)send(p,{type:'left'});return}
 if(r.state==='countdown'||r.state==='playing'){
  const survivor=r.players[0];result(r,survivor.id,'상대 플레이어가 경기를 떠났습니다. 남은 플레이어가 승리합니다.');
 }else if(r.state==='finished')broadcastRoom(r);
 else {r.state='waiting';r.startAt=null;r.players.forEach(x=>x.ready=false);broadcastRoom(r);broadcast(r,{type:'opponent_left'})}
 if(!disconnected)send(p,{type:'left'});
}
function parseClientMessage(p,data){if(p.closed)return;
 let m;try{m=JSON.parse(data)}catch{return error(p,'잘못된 메시지 형식입니다.')}
 if(!m||typeof m!=='object'||Array.isArray(m))return;
 if(p.isThree)return threeNet.msg(p,m);
 if(p.isHybrid)return hybridNet.message(p,m);
 if(p.isBattle)return battleNet.message(p,m);
 if(p.isAbility)return abilityNet.message(p,m);
 if(p.isChess)return chessNet.msg(p,m);
 if(m.type==='resume'){
  if(p.room)return error(p,'이미 방에 참가했습니다.');
  const token=typeof m.token==='string'?m.token:'';
  const old=sessions.get(token);
  if(!old||!old.closed||!old.room||!old.reconnectTimer){send(p,{type:'resume_failed'});return}
  const r=old.room;clearTimeout(old.reconnectTimer);old.reconnectTimer=null;
  p.id=old.id;p.nickname=old.nickname;p.ready=old.ready;p.result=old.result;
  p.room=r;p.resumeToken=token;p.lastHeight=old.lastHeight;p.lastPlaced=old.lastPlaced;
  p.lastSnapshot=old.lastSnapshot;p.lastData=old.lastData;
  r.players=r.players.map(x=>x===old?p:x);old.room=null;old.resumeToken=null;
  sessions.set(token,p);
  send(p,{type:'resumed',roomId:r.id,clientId:p.id,resumeToken:token,room:info(r),state:r.state,stage:r.stage,startAt:r.startAt,serverNow:now(),matchResult:r.lastMatchMessage||null});
  for(const opp of r.players)if(opp!==p&&opp.lastData)send(p,{type:'snapshot',from:opp.id,nickname:opp.nickname,serverAt:now(),data:opp.lastData});
  broadcastRoom(r);return;
 }
 // Clock echo uses the server's current wall clock; the client estimates the offset from half RTT.
 if(m.type==='clock_probe'){
  const at=Number(m.at);
  if(Number.isFinite(at)&&at>=0&&at<1e14)send(p,{type:'clock_sync',at,serverNow:now()});
  return;
 }
 if(m.type==='list'){return send(p,{type:'rooms',rooms:roomList()})}
 if(m.type==='create'){
  if(p.room)return error(p,'이미 방에 참가했습니다.');
  if(rooms.size>=MAX_ROOMS)return error(p,'공개방 수가 가득 찼습니다.');
  const r={id:id(),name:clean(m.name,24,'공개 대전방'),stage:m.stage==='time'?'time':'height',state:'waiting',players:[p],startAt:null};
  p.nickname=clean(m.nickname,12,'플레이어');p.ready=false;p.result=null;p.room=r;registerSession(p);rooms.set(r.id,r);
  send(p,{type:'joined',roomId:r.id,clientId:p.id,resumeToken:p.resumeToken,room:info(r)});broadcastRooms();return;
 }
 if(m.type==='join'){
  if(p.room)return error(p,'이미 방에 참가했습니다.');
  const r=rooms.get(String(m.roomId));
  if(!r||r.state!=='waiting'||r.players.length>=2)return error(p,'입장할 수 없는 방입니다. 목록을 새로고침하세요.');
  p.nickname=clean(m.nickname,12,'플레이어');p.ready=false;p.result=null;p.room=r;registerSession(p);r.players.push(p);
  send(p,{type:'joined',roomId:r.id,clientId:p.id,resumeToken:p.resumeToken,room:info(r)});broadcastRoom(r);return;
 }
 if(m.type==='leave'){leave(p);return}
 const r=p.room;if(!r)return error(p,'먼저 공개방에 참가하세요.');
 if(m.type==='ready'){
  if(r.state!=='waiting')return;
  p.ready=!!m.ready;broadcastRoom(r);
  if(r.players.length===2&&r.players.every(x=>x.ready&&!x.closed)){
   r.state='countdown';r.startAt=now()+3200;
   for(const x of r.players){x.result=null;x.lastHeight=0;x.lastPlaced=0;x.lastSnapshot=0}
   broadcast(r,{type:'match_start',roomId:r.id,stage:r.stage,startAt:r.startAt,serverNow:now(),room:info(r)});
   broadcastRooms();
   const roundId=r.startAt;
   setTimeout(()=>{if(r.state==='countdown'&&r.startAt===roundId)r.state='playing'},3250);
  }
  return;
 }
 if(m.type==='snapshot'){
  if(r.state!=='playing'&&r.state!=='countdown')return;
  const time=now();if(time-p.lastSnapshot<45)return;p.lastSnapshot=time;
  const d=m.data;if(!d||typeof d!=='object'||!Array.isArray(d.bodies)||d.bodies.length>90)return;
  const validShape=v=>Array.isArray(v)&&(v.length===4||v.length===5)&&'IOTLJSZ'.includes(v[0])&&v.slice(1).every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<100000);
  if(!d.bodies.every(validShape)||(d.piece&&!validShape(d.piece)))return;
  const height=Math.max(0,Math.min(999,Math.trunc(Number(d.height)||0)));
  const placed=Math.max(0,Math.min(10000,Math.trunc(Number(d.placed)||0)));
  p.lastHeight=height;p.lastPlaced=placed;
  const snapshot={height,placed,falls:Math.max(0,Math.trunc(Number(d.falls)||0)),time:Math.max(0,Number(d.time)||0),cameraY:Number(d.cameraY)||0,bodies:d.bodies,piece:d.piece||null};
  p.lastData=snapshot;
  for(const opponent of r.players)if(opponent!==p)send(opponent,{type:'snapshot',from:p.id,nickname:p.nickname,serverAt:time,data:snapshot});
  return;
 }
 if(m.type==='finish'){
  if(r.state!=='playing')return;
  if(p.result)return;
  const height=Math.max(0,Math.min(999,Math.trunc(Number(m.height)||0)));
  const placed=Math.max(0,Math.min(10000,Math.trunc(Number(m.placed)||0)));
  // Sanity rules for each stage; the client simulates its own physical tower.
  if(r.stage==='height'&&placed!==55)return error(p,'55개를 모두 사용해야 높이 도전이 완료됩니다.');
  if(r.stage==='time'&&height<18)return error(p,'목표 높이 18칸에 도달해야 합니다.');
  const elapsed=Math.max(0,(now()-r.startAt)/1000);
  p.result={height,placed,elapsed};
  if(r.stage==='time'){result(r,p.id,'목표 높이에 가장 먼저 도착한 플레이어가 승리합니다.');return}
  for(const x of r.players)if(x!==p)send(x,{type:'player_finished',playerId:p.id,nickname:p.nickname});
  if(r.players.every(x=>x.result)){
   const [a,b]=r.players;const winner=a.result.height===b.result.height?null:(a.result.height>b.result.height?a.id:b.id);
   result(r,winner,'55개 블록 사용 후 최종 높이를 비교했습니다.');
  }
  return;
 }
}

function close(p){
 if(p.closed)return;p.closed=true;peers.delete(p);
 if(p.abilityQueueTimer){clearInterval(p.abilityQueueTimer);p.abilityQueueTimer=null;}
 if(p.abilityQueue){p.abilityQueue.critical.length=0;p.abilityQueue.states.clear();p.abilityQueue.ids.clear();p.abilityQueue.bytes=0;}
 try{p.socket.destroy()}catch{}
 if(p.isThree)threeNet.disconnected(p);
 if(p.isHybrid)hybridNet.disconnected(p);
 if(p.isBattle)battleNet.disconnected(p);
 if(p.isAbility)abilityNet.disconnected(p);
 if(p.isChess&&p.chessRoom&&!shuttingDown)chessNet.disconnect(p);
 if(p.room&&!shuttingDown){
  p.reconnectTimer=setTimeout(()=>{
   p.reconnectTimer=null;
   if(p.closed&&p.room)leave(p,true);
  },GRACE_MS);p.reconnectTimer.unref();
  broadcastRoom(p.room);
 }else leave(p,true);
}
function wsConsume(p,newBytes){p.buffer=Buffer.concat([p.buffer,newBytes]);if(p.buffer.length>(p.isAbility?4_000_000:MAX_MESSAGE)*2){close(p);return}
 while(p.buffer.length>=2){const b=p.buffer,op=b[0]&15,fin=!!(b[0]&128),masked=!!(b[1]&128);
  if(!masked){close(p);return}
  let len=b[1]&127,off=2;if(len===126){if(b.length<4)return;len=b.readUInt16BE(2);off=4}
  else if(len===127){if(b.length<10)return;const long=b.readBigUInt64BE(2);if(long>BigInt(p.isAbility?4_000_000:MAX_MESSAGE)){close(p);return}len=Number(long);off=10}
  if(len>(p.isAbility?4_000_000:MAX_MESSAGE)){close(p);return}
  if(b.length<off+4+len)return;
  const mask=b.subarray(off,off+4),payload=Buffer.from(b.subarray(off+4,off+4+len));
  for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
  p.buffer=b.subarray(off+4+len);
  if(op===8){close(p);return}
  if(op===9){p.socket.write(frame(payload,10));continue}
  if(op===10){p.lastPong=now();continue}
  if(op===1){
   if(!fin)return close(p);
   if(now()-p.windowStart>=1000){p.windowStart=now();p.messagesInWindow=0}
   if(++p.messagesInWindow>(p.isAbility?250:45)){close(p);return}
   parseClientMessage(p,payload.toString('utf8'));continue;
  }
  // Browser-generated app frames are single JSON text messages.
  close(p);return;
 }
}
server.on('upgrade',(req,socket,head)=>{
 if(shuttingDown||peers.size>=MAX_PEERS){socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return}
 const wsUrl=new URL(req.url,'http://localhost');
 if(!['/','/ws','/chess-ws','/ability-ws','/battle-ws','/hybrid-ws','/three-chess-ws'].includes(wsUrl.pathname))return socket.destroy();
 if(String(req.headers.upgrade).toLowerCase()!=='websocket'||!req.headers['sec-websocket-key'])return socket.destroy();
 const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
 socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
 socket.setNoDelay(true);
 const p={isThree:wsUrl.pathname==='/three-chess-ws',isHybrid:wsUrl.pathname==='/hybrid-ws',isBattle:wsUrl.pathname==='/battle-ws',isAbility:wsUrl.pathname==='/ability-ws',isChess:wsUrl.pathname==='/chess-ws',socket,id:id(),nickname:'플레이어',ready:false,room:null,result:null,lastHeight:0,lastPlaced:0,lastSnapshot:0,lastPong:now(),closed:false,buffer:Buffer.alloc(0),resumeToken:null,reconnectTimer:null,windowStart:now(),messagesInWindow:0,lastData:null};
 peers.add(p);socket.on('data',chunk=>wsConsume(p,chunk));socket.on('error',()=>close(p));socket.on('end',()=>close(p));socket.on('close',()=>close(p));
 if(p.isBattle)battleNet.connected(p);else if(p.isAbility)abilityNet.connected(p,req.url);else{send(p,{type:'hello',id:p.id});if(p.isThree)threeNet.msg(p,{type:'tri_list'});else if(p.isHybrid)hybridNet.message(p,{type:'hybrid_list'});else if(p.isChess)chessNet.msg(p,{type:'chess_list'});else send(p,{type:'rooms',rooms:roomList()})}
 if(head.length)wsConsume(p,head);
});
chessNet=require('./chess_net.js')({send,peers});
hybridNet=require('./hybrid_net.js')({send,peers});
threeNet=require('./three_chess_net.js')({send,peers});
// Remove dead connections. A dropped connection vacates the public room automatically.
setInterval(()=>{const t=now();for(const p of peers){if(t-p.lastPong>(p.isAbility?120000:45000)){close(p);continue}try{p.socket.write(frame('',9))}catch{close(p)}}},15000).unref();
function gracefulShutdown(signal){
 if(shuttingDown)return;shuttingDown=true;
 console.log(`[server] ${signal}: draining connections`);
 abilityNet.shutdown();battleNet.shutdown();threeNet.shutdown();
 for(const p of peers){send(p,{type:'server_restarting'});try{p.socket.end(frame('',8))}catch{} }
 server.close(()=>{console.log('[server] stopped');process.exit(0)});
 setTimeout(()=>process.exit(0),10000).unref();
}
process.on('SIGTERM',()=>gracefulShutdown('SIGTERM'));
process.on('SIGINT',()=>gracefulShutdown('SIGINT'));
server.listen(PORT,'0.0.0.0',()=>console.log(`TRICKY TOWER ONLINE V10.10 (7 stages) ready: http://localhost:${PORT} (LAN: http://<server-ip>:${PORT})`));
