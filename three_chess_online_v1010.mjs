import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {setTimeout as pause} from 'node:timers/promises';import {fileURLToPath} from 'node:url';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),E=require('../three_chess_engine.js');const cwd=path.dirname(path.dirname(fileURLToPath(import.meta.url)));const port=17922;
const child=spawn(process.execPath,['server.js'],{cwd,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',b=>logs+=b.toString());child.stderr.on('data',b=>logs+=b.toString());let sockets=[];
async function boot(){for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok)return;}catch{}await pause(80);}throw Error('server failed '+logs);}
async function conn(){const ws=new WebSocket(`ws://127.0.0.1:${port}/three-chess-ws`),q=[],pending=[];ws.addEventListener('message',ev=>{const m=JSON.parse(String(ev.data));q.push(m);for(const cb of pending.slice())cb();});await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 const o={ws,q,send(m){ws.send(JSON.stringify(m))},wait(type,pred=()=>true,time=4500){return new Promise((ok,no)=>{let done=false;const stop=setTimeout(()=>{if(!done){done=true;pending.splice(pending.indexOf(check),1);no(Error('timeout '+type+' recent '+q.slice(-10).map(x=>x.type).join(','))) }},time);const check=()=>{if(done)return;const i=q.findIndex(m=>m.type===type&&pred(m));if(i<0)return;done=true;clearTimeout(stop);pending.splice(pending.indexOf(check),1);ok(q.splice(i,1)[0]);};pending.push(check);check();});}};sockets.push(o);return o;}
async function run(){await boot();const html=await fetch(`http://127.0.0.1:${port}/three_chess.html?mode=online`);assert.equal(html.status,200);assert.match(await html.text(),/THREE KINGDOM CHESS/);const js=await fetch(`http://127.0.0.1:${port}/three_chess_engine.js`);assert.equal(js.status,200);assert.match(await js.text(),/symmetric 96-square/);const home=await (await fetch(`http://127.0.0.1:${port}/`)).text();assert(home.includes('quickStage7'));
 const [w,b,r]=await Promise.all([conn(),conn(),conn()]);await Promise.all([w.wait('tri_rooms'),b.wait('tri_rooms'),r.wait('tri_rooms')]);
 w.send({type:'tri_create',name:'세 진영 선택 공개방',nickname:'참가자 A'});
 const wjoin=await w.wait('tri_joined');assert.equal(wjoin.color,null);assert.equal(wjoin.roomId.length>0,true);
 await w.wait('tri_state',m=>m.status==='waiting'&&m.players.length===1);
 b.send({type:'tri_join',roomId:wjoin.roomId,nickname:'참가자 B'});
 const bjoin=await b.wait('tri_joined');assert.equal(bjoin.color,null);
 await b.wait('tri_state',m=>m.status==='waiting'&&m.players.length===2);
 r.send({type:'tri_join',roomId:wjoin.roomId,nickname:'참가자 C'});
 const rjoin=await r.wait('tri_joined');assert.equal(rjoin.color,null);
 const waiting=await Promise.all([w.wait('tri_state',m=>m.status==='waiting'&&m.players.length===3),b.wait('tri_state',m=>m.status==='waiting'&&m.players.length===3),r.wait('tri_state',m=>m.status==='waiting'&&m.players.length===3)]);
 assert(waiting.every(m=>m.players.every(p=>p.color===null)));
 console.log('PASS full room does not start before choosing colours');
 // Guest C selects WHITE first; host A cannot steal it; first lock wins.
 r.send({type:'tri_choose_color',color:'w'});
 assert.equal((await r.wait('tri_chosen')).color,'w');
 await w.wait('tri_state',m=>m.players.some(p=>p.color==='w'));
 w.send({type:'tri_choose_color',color:'w'});assert.match((await w.wait('tri_error')).message,/선택한 진영/);
 w.send({type:'tri_choose_color',color:'r'});assert.equal((await w.wait('tri_chosen')).color,'r');
 await b.wait('tri_state',m=>m.players.some(p=>p.color==='r'));
 b.send({type:'tri_choose_color',color:'b'});assert.equal((await b.wait('tri_chosen')).color,'b');
 const start=await Promise.all([w.wait('tri_state',m=>m.status==='playing'),b.wait('tri_state',m=>m.status==='playing'),r.wait('tri_state',m=>m.status==='playing')]);
 start.forEach(m=>{assert.equal(m.position.t,'w');assert.equal(m.players.length,3);assert.equal(m.position.b.filter(Boolean).length,48);assert.deepEqual(new Set(m.players.map(x=>x.color)),new Set(['w','b','r']));});
 console.log('PASS three players independently choose unique teams, all start together');
 b.send({type:'tri_move',seq:0,f:E.idx('b',1,4),t:E.idx('b',2,4)});assert.match((await b.wait('tri_error')).message,/차례/);
 r.send({type:'tri_move',seq:0,f:E.idx('w',1,4),t:E.idx('w',2,4)});
 let states=await Promise.all([w.wait('tri_state',m=>m.seq===1),b.wait('tri_state',m=>m.seq===1),r.wait('tri_state',m=>m.seq===1)]);
 assert(states.every(x=>x.position.t==='b'));
 b.send({type:'tri_move',seq:1,f:E.idx('b',1,4),t:E.idx('b',2,4)});
 states=await Promise.all([w.wait('tri_state',m=>m.seq===2),b.wait('tri_state',m=>m.seq===2),r.wait('tri_state',m=>m.seq===2)]);assert(states.every(x=>x.position.t==='r'));
 w.send({type:'tri_move',seq:2,f:E.idx('r',1,4),t:E.idx('r',2,4)});
 states=await Promise.all([w.wait('tri_state',m=>m.seq===3),b.wait('tri_state',m=>m.seq===3),r.wait('tri_state',m=>m.seq===3)]);assert(states.every(x=>x.position.t==='w'));
 console.log('PASS white→black→red sequence even when white was the last visitor');
 // 60Hz compact network tick on real sockets.
 r.q.length=0;await pause(1000);const ticks=r.q.filter(m=>m.type==='tri_tick').length;
 assert(ticks>=42&&ticks<=75,'tick rate '+ticks);console.log('PASS tick rate',ticks,'Hz');
 b.ws.close();await r.wait('tri_state',m=>m.players.some(p=>p.color==='b'&&!p.connected));
 const bb=await conn();await bb.wait('tri_rooms');bb.send({type:'tri_resume',token:bjoin.token});
 const resumed=await bb.wait('tri_joined');assert.equal(resumed.color,'b');
 const restored=await bb.wait('tri_state',m=>m.seq===3);assert.equal(restored.position.t,'w');
 console.log('PASS black reconnect preserves chosen colour and board state');
 w.send({type:'tri_resign'});
 let states2=await Promise.all([r.wait('tri_state',m=>!m.position.alive.r),bb.wait('tri_state',m=>!m.position.alive.r)]);
 states2.forEach(m=>{assert(m.position.b.some(p=>p?.c==='r'&&p.frozen));assert.equal(m.position.b.filter(p=>p?.c==='r').length,16);});
 bb.send({type:'tri_resign'});
 const done=await r.wait('tri_state',m=>m.position.status==='ended');
 assert.equal(done.position.winner,'w');assert(done.position.b.some(p=>p?.c==='b'&&p.frozen));
 console.log('PASS eliminated armies remain frozen gray in all client states');
 r.send({type:'tri_rematch'});w.send({type:'tri_rematch'});bb.send({type:'tri_rematch'});
 const again=await r.wait('tri_state',m=>m.game===2&&m.status==='playing');
 assert.equal(again.position.t,'w');assert.deepEqual(new Set(again.players.map(x=>x.color)),new Set(['w','b','r']));
 console.log('PASS rematch preserves unique colour choices');
 const health=await(await fetch(`http://127.0.0.1:${port}/health`)).json();assert.equal(health.version,'10.10.0');console.log('PASS old route preserved, health 10.10');
}
try{await run()}finally{for(const o of sockets){try{o.ws.close()}catch{}}child.kill('SIGTERM');await pause(150);}
