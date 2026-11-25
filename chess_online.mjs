import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const PORT=18931;
const child=spawn(process.execPath,['server.js'],{cwd:resolve(dirname(fileURLToPath(import.meta.url)),'..'),env:{...process.env,PORT:String(PORT)},stdio:['ignore','pipe','pipe']});
let logs='';for(const s of [child.stdout,child.stderr])s.on('data',x=>logs+=x);
class Peer{
 constructor(ws){this.ws=ws;this.inbox=[];this.pending=[];ws.addEventListener('message',e=>{let m;try{m=JSON.parse(e.data)}catch{return}this.inbox.push(m);this.dispatch()})}
 dispatch(){for(const p of [...this.pending]){let i=this.inbox.findIndex(p.test);if(i<0)continue;this.pending.splice(this.pending.indexOf(p),1);clearTimeout(p.timer);p.ok(this.inbox.splice(i,1)[0])}}
 recv(type,fn=()=>true,ms=3500){return new Promise((ok,fail)=>{const p={test:m=>m.type===type&&fn(m),ok,timer:null};p.timer=setTimeout(()=>{this.pending=this.pending.filter(q=>q!==p);fail(Error(`timeout ${type}; inbox=${JSON.stringify(this.inbox.slice(-8))}`))},ms);this.pending.push(p);this.dispatch()})}
 send(m){this.ws.send(JSON.stringify(m))}
 close(){this.ws.close()}
}
async function connect(){return new Promise((ok,fail)=>{let ws=new WebSocket(`ws://127.0.0.1:${PORT}/chess-ws`);let p=new Peer(ws);ws.addEventListener('open',()=>ok(p),{once:true});ws.addEventListener('error',()=>fail(Error('connection failure')),{once:true})})}
try{
 let started=false;for(let i=0;i<50;i++){try{let r=await fetch(`http://127.0.0.1:${PORT}/health`);if(r.ok){started=true;break}}catch{}await delay(100)}assert(started,logs);
 const a=await connect(),b=await connect();
 a.send({type:'chess_create',name:'그림체스',namePlayer:'파랑'});
 let joined=await a.recv('chess_joined');assert.equal(joined.side,1);
 b.send({type:'chess_list'});const rooms=await b.recv('chess_rooms',m=>m.rooms.some(r=>r.id===joined.roomId));assert(rooms.rooms[0]);
 b.send({type:'chess_join',roomId:joined.roomId,namePlayer:'빨강'});
 let bj=await b.recv('chess_joined');assert.equal(bj.side,-1);
 await Promise.all([a.recv('chess_state',m=>m.status==='playing'),b.recv('chess_state',m=>m.status==='playing')]);
 b.send({type:'chess_move',move:'e7e6'});assert.match((await b.recv('chess_error')).message,/지금은/);
 a.send({type:'chess_move',move:'e2e4'});assert.match((await a.recv('chess_error')).message,/그림/);
 a.send({type:'chess_move',move:'a1a6'});assert.match((await a.recv('chess_error')).message,/그림/);
 a.send({type:'chess_move',move:'e2e3'});
 let states=await Promise.all([a.recv('chess_state',m=>m.moves.length===1),b.recv('chess_state',m=>m.moves.length===1)]);
 assert.equal(states[0].turn,-1);assert.equal(states[1].moves[0].move,'e2e3');
 b.send({type:'chess_move',move:'e7e6'});
 states=await Promise.all([a.recv('chess_state',m=>m.moves.length===2),b.recv('chess_state',m=>m.moves.length===2)]);
 assert.equal(states[0].turn,1);
 a.send({type:'chess_move',move:'a1a5'}); assert.match((await a.recv('chess_error')).message,/그림/);
 a.send({type:'chess_move',move:'a1a4'});
 const rookStates=await Promise.all([a.recv('chess_state',m=>m.moves.length===3),b.recv('chess_state',m=>m.moves.length===3)]);
 assert.equal(rookStates[0].moves[2].move,'a1a4'); // jump over friendly a2 pawn and land exactly 3 away
 // Reconnect the Blue seat mid-game while retaining turn and board state.
 a.close();await b.recv('chess_state',m=>m.players.some(p=>p.side===1&&!p.connected));
 const a2=await connect();a2.send({type:'chess_resume',token:joined.token});const resumed=await a2.recv('chess_joined');assert.equal(resumed.side,1);
 const restored=await a2.recv('chess_state',m=>m.status==='playing');assert.equal(restored.moves.length,3);
 a2.send({type:'chess_resign'});const ended=await Promise.all([a2.recv('chess_state',m=>m.status==='ended'),b.recv('chess_state',m=>m.status==='ended')]);
 assert.equal(ended[0].ending.winner,-1);assert.equal(ended[0].ending.reason,'resign');
 a2.send({type:'chess_rematch'});b.send({type:'chess_rematch'});const rematch=await Promise.all([a2.recv('chess_state',m=>m.status==='playing'&&m.game===2),b.recv('chess_state',m=>m.status==='playing'&&m.game===2)]);assert.equal(rematch[0].moves.length,0);
 a2.send({type:'chess_leave'});await a2.recv('chess_left');b.send({type:'chess_leave'});await b.recv('chess_left');
 a2.close();b.close();
 console.log('PASS 2-player public chess room, server-side move legality, blue/red turn, new movement, reconnect, resign, rematch, leave');
}catch(e){console.error('FAIL',e.stack||e,'SERVER:',logs);process.exitCode=1}
finally{child.kill('SIGTERM');await delay(120)}
