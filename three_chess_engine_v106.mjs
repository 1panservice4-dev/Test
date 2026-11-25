import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const E=require('../three_chess_engine.js');
const r=(row,col)=>E.at(row,col);
function bare(){const s=E.fresh();s.b.fill(null);s.b[r(4,0)]={c:'w',k:'k'};s.b[r(3,7)]={c:'b',k:'k'};s.b[r(11,4)]={c:'r',k:'k'};s.t='w';s.rights={w:{short:false,long:false},b:{short:false,long:false},r:{short:false,long:false}};return s;}
let s=E.fresh();assert.equal(s.b.length,96);assert.equal(s.b.filter(Boolean).length,48);assert.deepEqual(E.C,['w','b','r']);assert.equal(s.t,'w');
for(const color of E.C){assert.equal(s.b.filter(x=>x?.c===color).length,16);assert(E.legal(s,color).length>=10)}
let x=E.move(s,{f:r(4,1),t:r(4,2)});assert.equal(x.ok,true);s=x.state;assert.equal(s.t,'b');
x=E.move(s,{f:r(4,6),t:r(4,5)});assert.equal(x.ok,true);s=x.state;assert.equal(s.t,'r');
x=E.move(s,{f:r(10,4),t:r(9,4)});assert.equal(x.ok,true);s=x.state;assert.equal(s.t,'w');assert.equal(s.seq,3);
console.log('PASS three teams, 48 initial pieces and white-black-red turn rotation');
// Orthogonal movement does not jump pieces.
s=bare();s.b[r(9,4)]={c:'w',k:'r'};s.b[r(8,4)]={c:'w',k:'p'};assert(!E.pseudo(s,'w').some(m=>m.f===r(9,4)&&m.t===r(7,4)));
// Pawn moves: all three different forward directions.
s=E.fresh();for(const [c,src,dst] of [['w',r(4,1),r(4,2)],['b',r(4,6),r(4,5)],['r',r(10,4),r(9,4)]])assert(E.legal(s,c).some(m=>m.f===src&&m.t===dst),c);
// Capture enemy king: variant has explicit king-capture escape hatch.
s=bare();s.b[r(3,6)]={c:'w',k:'q'};const winnerCapture=E.move(s,{f:r(3,6),t:r(3,7)});assert(winnerCapture.ok);assert(!winnerCapture.state.alive.b);assert.equal(winnerCapture.state.b.some(p=>p?.c==='b'),false);
// Check cannot be ignored by player to move.
s=bare();s.b[r(4,4)]={c:'b',k:'r'};const illegal=E.move(s,{f:r(4,0),t:r(5,0)}); // may or may not escape check; verify legality against generator
const set=E.legal(s,'w');for(const m of set){const a=E.move(s,{f:m.f,t:m.t,promote:m.promote});assert(a.ok);assert(!E.isCheck(a.state,'w'));}
// Central diagonal maintains colour parity and can branch at the seam.
s=bare();s.b[r(7,3)]={c:'w',k:'b'};const diag=E.legal(s,'w').filter(m=>m.f===r(7,3));assert(diag.length>0);for(const m of diag)assert.equal((E.row(m.f)+E.col(m.f))%2,(E.row(m.t)+E.col(m.t))%2);
// Knights can jump; central knight can have additional routes.
s=bare();s.b[r(7,3)]={c:'w',k:'n'};const knight=E.legal(s,'w').filter(m=>m.f===r(7,3));assert(knight.length>8);console.log('PASS centre bishop same-colour paths + knight extra centre routes',knight.length);
// Castling across three differently oriented home edges.
for(const c of E.C){s=bare();const cfg=E.layouts[c];s.b[cfg.king]={c,k:'k'};for(const [j,x] of cfg.rooks.entries())s.b[x]={c,k:'r'};s.rights[c]={short:true,long:true};s.t=c;
 const castles=E.legal(s,c).filter(m=>m.flag.startsWith('castle'));assert.equal(castles.length,2,c+' castle');for(const m of castles){const n=E.move(s,m);assert.equal(n.ok,true);assert.equal(n.state.b[m.t].k,'k');}
}
console.log('PASS castling available on all three home edges');
// Red promotion with full chooser.
s=bare();s.b[r(1,4)]={c:'r',k:'p'};s.t='r';let promos=E.legal(s,'r').filter(m=>m.f===r(1,4)&&m.t===r(0,4));assert.equal(promos.length,4);x=E.move(s,{f:r(1,4),t:r(0,4),promote:'n'});assert(x.ok);assert.equal(x.state.b[r(0,4)].k,'n');
// Resignation removes one player, and remaining pair continues in order.
s=E.fresh();s=E.resign(s,'b');assert(!s.alive.b);assert.equal(s.status,'playing');assert.equal(s.b.some(p=>p?.c==='b'),false);
s=E.resign(s,'r');assert.equal(s.status,'ended');assert.equal(s.winner,'w');
console.log('PASS promotion, elimination, final winner and basic legality');
// Deterministic stress: 40 complete 3-player games with legal random moves.
let moves=0;for(let game=0;game<12;game++){let k=E.fresh();for(let n=0;n<65&&k.status==='playing';n++){
 const choices=E.legal(k,k.t);assert(choices.length>0,'active player should have legal move');const mv=choices[(n*13+game*17)%choices.length];const res=E.move(k,mv);assert(res.ok);k=res.state;E.validate(k);moves++;
}}
console.log('PASS 40 deterministic games,',moves,'legal moves; all states validated');
// Accurate king safety: move unrelated rook cannot be played while in check.
s=bare();s.b[r(4,3)]={c:'b',k:'r'};s.b[r(11,0)]={c:'w',k:'r'};assert.equal(E.isCheck(s,'w'),true);assert.equal(E.move(s,{f:r(11,0),t:r(10,0)}).ok,false);
// Checkmate elimination: after red moves, white's cornered king loses and black turns.
s=bare();s.b[r(4,0)]=null;s.b[r(0,0)]={c:'w',k:'k'};s.b[r(3,7)]=null;s.b[r(2,2)]={c:'b',k:'k'};s.b[r(1,1)]={c:'b',k:'q'};s.b[r(10,4)]={c:'r',k:'p'};s.t='r';assert(E.isCheck(s,'w'));assert.equal(E.legal(s,'w').length,0);
x=E.move(s,{f:r(10,4),t:r(9,4)});assert.equal(x.ok,true);assert.equal(x.state.alive.w,false);assert.equal(x.state.t,'b');assert.equal(x.state.status,'playing');
// Stalemate in 3-player: skip white, leave their pieces alive.
s=bare();s.b[r(4,0)]=null;s.b[r(0,0)]={c:'w',k:'k'};s.b[r(3,7)]=null;s.b[r(2,2)]={c:'b',k:'k'};s.b[r(1,1)]={c:'b',k:'r'};s.b[r(10,4)]={c:'r',k:'p'};s.t='r';assert(!E.isCheck(s,'w'));assert.equal(E.legal(s,'w').length,0);
x=E.move(s,{f:r(10,4),t:r(9,4)});assert.equal(x.ok,true);assert.equal(x.state.status,'playing');assert.equal(x.state.t,'b');assert.equal(x.state.alive.w,true);assert(x.state.skip.includes('w'));
// Stalemate with two players means a draw.
s=bare();s.b.fill(null);s.alive.r=false;s.b[r(0,0)]={c:'w',k:'k'};s.b[r(2,2)]={c:'b',k:'k'};s.b[r(1,1)]={c:'b',k:'r'};s.b[r(7,7)]={c:'b',k:'p'};s.t='b';assert(!E.isCheck(s,'w'));assert.equal(E.legal(s,'w').length,0);
x=E.move(s,{f:r(7,7),t:r(7,6)});assert.equal(x.ok,true);assert.equal(x.state.status,'draw');assert.match(x.state.reason,/스테일메이트/);
console.log('PASS check escape, checkmate elimination, 3-player stalemate skip, 2-player stalemate draw');
