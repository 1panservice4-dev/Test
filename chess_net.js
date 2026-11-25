'use strict';
const crypto=require('node:crypto');
const E=require('./chess_engine.js');
module.exports=function({send,peers}){
 const rooms=new Map(), tokens=new Map();const rid=()=>crypto.randomBytes(4).toString('hex').toUpperCase();
 const short=s=>String(s||'').replace(/[<>\x00-\x1f]/g,'').trim().slice(0,16)||'플레이어';
 function listing(){return [...rooms.values()].filter(r=>r.players.length<2&&r.status==='waiting').map(r=>({id:r.id,name:r.name,count:r.players.length}))}
 function listAll(){const m={type:'chess_rooms',rooms:listing()};for(const p of peers)if(p.isChess)send(p,m)}
 function to(p,m){if(p&&!p.closed)send(p,m)}
 function state(r){return {type:'chess_state',roomId:r.id,roomName:r.name,status:r.status,players:r.players.map((p,i)=>({id:p.id,name:p.chessName,connected:!p.closed,side:i===0?1:-1,rematch:!!p.rematch})),board:r.position.b,turn:r.position.t,castling:r.position.c,ep:r.position.ep,half:r.position.half,full:r.position.full,moves:r.moves,ending:r.ending,seq:r.moves.length,game:r.game,claimable:r.position.half>=100||r.history.filter(x=>x===E.key(r.position)).length>=3}}
 function broadcast(r){const m=state(r);for(const p of r.players)to(p,m)}
 function finish(r,winner,reason,line=null){r.status='ended';r.ending={winner,reason,line};broadcast(r)}
 function detach(p){const r=p.chessRoom;if(!r)return; if(p.chessTimer){clearTimeout(p.chessTimer);p.chessTimer=null}if(p.chessToken)tokens.delete(p.chessToken);p.chessRoom=null;r.players=r.players.filter(x=>x!==p);if(!r.players.length){rooms.delete(r.id);listAll();return}if(r.status==='playing')finish(r,r.players[0]===p?null:(r.players[0].chessSide),'opponent_left');else{r.status='waiting';r.ending=null;broadcast(r);listAll()}}
 function disconnect(p){if(!p.chessRoom)return;p.chessTimer=setTimeout(()=>{if(p.closed&&p.chessRoom)detach(p)},30000);p.chessTimer.unref();broadcast(p.chessRoom)}
 function msg(p,m){if(m.type==='chess_list'){to(p,{type:'chess_rooms',rooms:listing()});return}
 if(m.type==='chess_resume'){const old=tokens.get(String(m.token||''));if(!old||!old.closed||!old.chessRoom){to(p,{type:'chess_resume_failed'});return}const r=old.chessRoom;if(old.chessTimer)clearTimeout(old.chessTimer);p.id=old.id;p.chessName=old.chessName;p.chessToken=old.chessToken;p.chessRoom=r;p.chessSide=old.chessSide;p.rematch=old.rematch;r.players=r.players.map(x=>x===old?p:x);old.chessRoom=null;tokens.set(p.chessToken,p);to(p,{type:'chess_joined',roomId:r.id,side:p.chessSide,token:p.chessToken});broadcast(r);return}
 if(m.type==='chess_create'){if(p.chessRoom)return; if(rooms.size>=80)return to(p,{type:'chess_error',message:'공개방 최대 수에 도달했습니다.'});const r={id:rid(),name:short(m.name||'체스 테트리스 공개방'),players:[p],status:'waiting',position:E.initial(),moves:[],history:[],ending:null,game:0};while(rooms.has(r.id))r.id=rid();p.chessRoom=r;p.chessSide=1;p.chessName=short(m.namePlayer);p.chessToken=crypto.randomBytes(20).toString('hex');tokens.set(p.chessToken,p);rooms.set(r.id,r);to(p,{type:'chess_joined',roomId:r.id,side:1,token:p.chessToken});broadcast(r);listAll();return}
 if(m.type==='chess_join'){if(p.chessRoom)return;const r=rooms.get(String(m.roomId||''));if(!r||r.players.length>=2||r.status!=='waiting')return to(p,{type:'chess_error',message:'이미 시작했거나 존재하지 않는 방입니다.'});p.chessRoom=r;p.chessSide=-1;p.chessName=short(m.namePlayer);p.chessToken=crypto.randomBytes(20).toString('hex');tokens.set(p.chessToken,p);r.players.push(p);r.status='playing';r.position=E.initial();r.history=[E.key(r.position)];r.moves=[];r.game++;to(p,{type:'chess_joined',roomId:r.id,side:-1,token:p.chessToken});broadcast(r);listAll();return}
 if(m.type==='chess_leave'){detach(p);to(p,{type:'chess_left'});return}
 const r=p.chessRoom;if(!r)return to(p,{type:'chess_error',message:'먼저 방에 참가하세요.'});
 if(m.type==='chess_move'){if(r.status!=='playing'||r.position.t!==p.chessSide)return to(p,{type:'chess_error',message:'지금은 움직일 수 없습니다.'});const move=E.parseMove(r.position,String(m.move||''));if(!move)return to(p,{type:'chess_error',message:'그림 이동 규칙 또는 왕 안전 규칙에 맞지 않는 수입니다.'});const label=E.notation(r.position,move);r.position=E.apply(r.position,move);r.moves.push({side:p.chessSide,move:E.moveKey(move),label});r.history.push(E.key(r.position));const outcome=E.outcome(r.position,r.history);if(outcome.done)finish(r,outcome.winner,outcome.reason,outcome.line);else broadcast(r);return}
 if(m.type==='chess_resign'){if(r.status==='playing')finish(r,-p.chessSide,'resign');return}
 if(m.type==='chess_claim'){if(r.status!=='playing')return;const counts=r.history.filter(x=>x===E.key(r.position)).length;if(counts>=3)finish(r,0,'threefold');else if(r.position.half>=100)finish(r,0,'50move');else to(p,{type:'chess_error',message:'아직 무승부를 주장할 수 없습니다.'});return}
 if(m.type==='chess_rematch'){if(r.status!=='ended')return;p.rematch=true;if(r.players.length===2&&r.players.every(x=>x.rematch&&!x.closed)){r.players.forEach(x=>x.rematch=false);r.position=E.initial();r.moves=[];r.history=[E.key(r.position)];r.ending=null;r.status='playing';r.game++}broadcast(r);return}
 }
 return {msg,disconnect,listAll};
};
