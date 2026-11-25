import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const E=require('../three_chess_engine.js');
const at=E.at;
const p=(c,k,frozen=false)=>({c,k,...(frozen?{frozen:true}:{})});
function bare(){let s=E.fresh();s.b.fill(null);s.b[at(13,4)]=p('w','k');s.b[at(4,0)]=p('b','k');s.b[at(3,7)]=p('r','k');s.rights={w:{short:false,long:false},b:{short:false,long:false},r:{short:false,long:false}};s.t='w';return s;}
let s=E.fresh();
assert.equal(s.b.length,112);assert.equal(s.b.filter(Boolean).length,48);
assert.equal(s.t,'w');assert.deepEqual(E.C,['w','b','r']);
// Reference image positions: white at bottom, black at left, red at right.
for(const [c,king,pawn,rook1,rook2] of [['w',at(13,4),at(12,4),at(13,0),at(13,7)],['b',at(4,0),at(4,1),at(0,0),at(7,0)],['r',at(3,7),at(3,6),at(0,7),at(7,7)]]){
 assert.equal(s.b[king].c,c);assert.equal(s.b[king].k,'k');assert.equal(s.b[pawn].k,'p');assert.equal(s.b[rook1].k,'r');assert.equal(s.b[rook2].k,'r');
 assert.equal(s.b.filter(x=>x?.c===c).length,16);
}
assert(E.legal(s,'w').some(m=>m.f===at(12,4)&&m.t===at(11,4)));
assert(E.legal(s,'b').some(m=>m.f===at(4,1)&&m.t===at(4,2)));
assert(E.legal(s,'r').some(m=>m.f===at(4,6)&&m.t===at(4,5)));
for(const [f,t,c,next] of [[at(12,4),at(11,4),'w','b'],[at(4,1),at(4,2),'b','r'],[at(4,6),at(4,5),'r','w']]){
 assert.equal(s.t,c);let m=E.move(s,{f,t});assert(m.ok,m.error);s=m.state;assert.equal(s.t,next);E.validate(s);
}
console.log('PASS photo-exact team placement and white→black→red opening');
// Elimination freezes every remaining piece rather than deleting it; those pieces are capturable.
s=bare();s.b[at(3,6)]=p('w','q');s.b[at(1,7)]=p('r','r');s.b[at(1,6)]=p('b','q');
let m=E.move(s,{f:at(3,6),t:at(3,7)});assert(m.ok,m.error);s=m.state;
assert.equal(s.alive.r,false);assert.equal(s.b[at(1,7)].c,'r');assert.equal(s.b[at(1,7)].frozen,true);
assert.equal(E.legal(s,'r').length,0);assert.equal(s.b.filter(x=>x?.c==='r').length,1); // captured king disappears, other pieces persist
assert.equal(s.t,'b');
let take=E.move(s,{f:at(1,6),t:at(1,7)});assert(take.ok,take.error);assert.equal(take.state.b[at(1,7)].c,'b');
console.log('PASS captured king -> frozen army stays, non-moving and capturable');
// Resignation also freezes; dead pieces do not attack and do block sliding paths.
s=bare();s.b[at(4,1)]=p('b','r');s.b[at(4,3)]=p('w','r');
let q=E.resign(s,'b');assert.equal(q.alive.b,false);assert(q.b[at(4,0)].frozen);assert(q.b[at(4,1)].frozen);assert.equal(q.b.filter(x=>x?.c==='b').length,2);
// No attacks from an eliminated rook.
assert.equal(E.isAttacked(q,at(4,3),'w'),false);
assert.equal(E.legal(q,'b').length,0);
E.validate(q);
console.log('PASS defeated team remains gray, cannot attack or move');
// Castling is still available on each of the three home edges.
for(const c of E.C){s=bare();s.b.fill(null);const cfg=E.layouts[c];
 for(const k of E.C)s.b[E.layouts[k].king]=p(k,'k');
 for(const r of cfg.rooks)s.b[r]=p(c,'r');s.rights[c]={short:true,long:true};s.t=c;
 const castles=E.legal(s,c).filter(m=>m.flag?.startsWith('castle'));
 assert.equal(castles.length,2,`${c} castles`);
 for(const mv of castles){const o=E.move(s,mv);assert(o.ok,o.error);assert.equal(o.state.b[mv.t].k,'k');}
}
console.log('PASS castling retained for all three colours');
// Multi-game safety & state integrity.
let cnt=0;for(let game=0;game<12;game++){s=E.fresh();for(let t=0;t<65&&s.status==='playing';t++){
 let opts=E.legal(s);assert(opts.length,'turn player must be able to move');
 const mv=opts[(game*13+t*17)%opts.length],res=E.move(s,mv);
 assert(res.ok,res.error);s=res.state;E.validate(s);cnt++;
 }}
console.log('PASS',cnt,'legal moves across 12 independent matches');
