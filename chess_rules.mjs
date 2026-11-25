import assert from 'node:assert/strict';
import E from '../chess_engine.js';
const {idx}=E;
const from=(p,origin='d4')=>new Set(E.destinations(idx(origin),p).map(E.sq));
const eq=(a,expected,msg)=>assert.deepEqual([...a].sort(),expected.sort(),msg);
function empty(turn=1){const s=E.initial();s.b.fill('.');s.t=turn;s.c=0;s.half=0;s.full=1;return s}
function load(s,map){for(const [sqr,p] of Object.entries(map))s.b[idx(sqr)]=p;return s}
function movesFrom(s,square){return E.legal(s).filter(m=>m[0]===idx(square)).map(m=>E.sq(m[1]))}
function test(name,fn){fn();console.log('PASS',name)}
test('O pawn uses all eight adjacent diagram destinations, not traditional forward-only pawn moves',()=>{
 eq(from('p'),['c3','d3','e3','c4','e4','c5','d5','e5']);
 const s=load(empty(),{e1:'K',a8:'k',d4:'P'});eq(new Set(movesFrom(s,'d4')),[...from('p')]);
 assert(!movesFrom(load(empty(),{e1:'K',a8:'k',e2:'P'}),'e2').includes('e4'));
});
test('I rook has exactly 3-square maximum on orthogonal axes and JUMPS blockers',()=>{
 assert.equal(from('r').size,12);
 eq(from('r'),['d5','d6','d7','d3','d2','d1','a4','b4','c4','e4','f4','g4']);
 assert(!from('r','a3').has('a7'),'rook may NOT move four squares');
 const s=load(empty(),{e1:'K',h8:'k',a4:'R',a5:'P',a6:'p'});let moves=new Set(movesFrom(s,'a4'));
 assert(!moves.has('a8'),'rook must reject four squares');
 assert(moves.has('a7'),'rook must be able to jump exactly 3 squares over other pieces');
 assert(moves.has('a6'),'rook must capture landing enemy');
 assert(!moves.has('a5'),'rook cannot land on own piece');
});
test('L knight follows sixteen marked offsets and can jump friend/enemy',()=>{
 eq(from('n'),['c6','d6','e6','b5','d5','f5','b4','c4','e4','f4','b3','d3','f3','c2','d2','e2']);
 const s=load(empty(),{e1:'K',h8:'k',d4:'N',c4:'P',d5:'P',d3:'p',b3:'p'});
 const moves=new Set(movesFrom(s,'d4'));
 assert(moves.has('d6')&&moves.has('d3')&&moves.has('b3'));
 assert(!moves.has('c4')&&!moves.has('d5'));
 assert(!moves.has('g5'),'L cannot move outside diagram');
});
test('S bishop follows sixteen distinct marked offsets and jumps other pieces',()=>{
 eq(from('b'),['c6','e6','b5','c5','d5','e5','f5','c4','e4','b3','c3','d3','e3','f3','c2','e2']);
 const s=load(empty(),{e1:'K',h8:'k',d4:'B',c5:'P',d5:'P',f5:'p'});
 const moves=new Set(movesFrom(s,'d4'));
 assert(moves.has('c6')&&moves.has('f5')&&!moves.has('c5')&&!moves.has('d5'));
 assert(!moves.has('f6'));
});
test('T queen follows twelve marked diamond offsets, not unlimited standard queen movement',()=>{
 eq(from('q'),['d6','c5','d5','e5','b4','c4','e4','f4','c3','d3','e3','d2']);
 const s=load(empty(),{e1:'K',h8:'k',d4:'Q',c5:'P',d5:'P',f4:'p'});
 const moves=new Set(movesFrom(s,'d4'));
 assert(moves.has('d6')&&moves.has('f4')&&!moves.has('c5'));
 assert(!moves.has('g4'),'T queen cannot move 3 squares right');
});
test('king uses traditional adjacent movement; prohibits adjacent enemy kings',()=>{
 eq(from('k'),[...from('p')]);
 const s=load(empty(),{e4:'K',f6:'k'});const moves=movesFrom(s,'e4');
 assert(!moves.includes('f5'),'king cannot enter opposing king attack');
});
test('king safety: jumping I rook gives check even behind blockers',()=>{
 const s=load(empty(),{d1:'K',d4:'r',d3:'P',a8:'k'});
 assert(E.inCheck(s,1),'rook attack cannot be blocked');
 assert(!movesFrom(s,'d3').includes('e3'),'king cannot remain in check');
 s.b[idx('d4')]='.';s.b[idx('d5')]='r';assert(!E.inCheck(s,1),'a rook beyond 3 squares must not give check');
});
test('blue/red pawn promotion on opposite back rank; no en-passant',()=>{
 const b=load(empty(),{h1:'K',h8:'k',d7:'P'});
 const moves=E.legal(b).filter(m=>E.sq(m[0])==='d7'&&E.sq(m[1])==='e8');
 assert.equal(moves.length,4);assert.deepEqual(moves.map(m=>m[2]).sort(),['b','n','q','r']);
 const r=load(empty(-1),{h1:'K',h8:'k',d2:'p'});
 assert.equal(E.legal(r).filter(m=>E.sq(m[0])==='d2'&&E.sq(m[1])==='e1').length,4);
 assert(E.legal(b).every(m=>m[3]!=='ep'));
});
test('ordinary castling still requires clear squares and no attack through king path',()=>{
 const s=load(empty(),{e1:'K',h1:'R',e8:'k'});s.c=1;
 assert(E.legal(s).some(m=>m[3]==='castle'&&E.sq(m[1])==='g1'));
 s.b[idx('f1')]='P';assert(!E.legal(s).some(m=>m[3]==='castle'));
});
test('line win: horizontal 8 excludes OWN home three ranks, vertical 8 INCLUDES home ranks',()=>{
 let s=load(empty(),{e1:'K',e8:'k'});
 for(let c=0;c<8;c++)s.b[idx('abcdefgh'[c]+'4')]='P';
 assert.deepEqual(E.lineWin(s,1),{kind:'row',index:4});
 // Blue starts at ranks 1-3; only ranks 4-8 may count for horizontal.
 s=load(empty(),{e1:'K',e8:'k'});for(let c=0;c<8;c++)s.b[idx('abcdefgh'[c]+'3')]='P';
 assert.equal(E.lineWin(s,1),null,'blue rank 3 is excluded');
 s=load(empty(),{e1:'K',e8:'k'});for(let c=0;c<8;c++)s.b[idx('abcdefgh'[c]+'4')]='P';
 assert.deepEqual(E.lineWin(s,1),{kind:'row',index:4},'blue rank 4 eligible');
 // Red starts at ranks 8-6; only ranks 1-5 count for horizontal.
 s=load(empty(),{e1:'K',e8:'k'});for(let c=0;c<8;c++)s.b[idx('abcdefgh'[c]+'6')]='p';
 assert.equal(E.lineWin(s,-1),null,'red rank 6 is excluded');
 s=load(empty(),{e1:'K',e8:'k'});for(let c=0;c<8;c++)s.b[idx('abcdefgh'[c]+'5')]='p';
 assert.deepEqual(E.lineWin(s,-1),{kind:'row',index:3},'red rank 5 eligible');
 s=load(empty(),{e1:'K',e8:'k'});
 for(let r=3;r<=8;r++)s.b[idx('a'+r)]='P';
 assert.equal(E.lineWin(s,1),null,'six squares without blue home ranks cannot win');
 s.b[idx('a1')]='R';assert.equal(E.lineWin(s,1),null,'seven not enough');
 s.b[idx('a2')]='P';assert.deepEqual(E.lineWin(s,1),{kind:'column',index:0});
 s=load(empty(),{e1:'K',e8:'k'});
 for(let c=0;c<8;c++)s.b[idx('abcdefgh'[c]+'1')]='P';
 assert.equal(E.lineWin(s,1),null,'blue home row excluded for horizontal');
 s=load(empty(),{e1:'K',e8:'k'});
 for(let r=1;r<=8;r++)s.b[idx('h'+r)]='p';
 assert.deepEqual(E.lineWin(s,-1),{kind:'column',index:7},'red vertical includes home ranks');
 s=load(empty(),{e1:'K',e8:'k'});
 for(let c=0;c<8;c++)s.b[idx('abcdefgh'[c]+'8')]='p';
 assert.equal(E.lineWin(s,-1),null,'red home row excluded for horizontal');
});
test('move cannot capture king; move notation and parse legal consistent',()=>{
 const s=load(empty(),{e1:'K',e8:'k',e4:'Q'});
 assert(!E.legal(s).some(m=>E.sq(m[1])==='e8'));
 const m=E.parseMove(s,'e4e6');assert(m&&E.moveKey(m)==='e4e6');
});
test('new starting position does not accidentally start in check or already finish',()=>{
 let s=E.initial();assert.equal(E.inCheck(s,1),false);assert.equal(E.inCheck(s,-1),false);assert.equal(E.outcome(s,[E.key(s)]).done,false);
});
console.log('ALL 12 MOVEMENT AND RULE TESTS PASSED');
