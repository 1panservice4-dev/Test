import assert from 'node:assert/strict';import{createRequire}from'node:module';
const require=createRequire(import.meta.url),E=require('../three_chess_engine.js'),eps=1e-6;
const xyz=p=>p.map(x=>Math.round(x*1e4)/1e4).join(',');
const sample=new Map();let edges=0;
for(let i=0;i<E.N;i++){
 const poly=E.polygons[i];assert.equal(poly.length,4);
 for(let k=0;k<4;k++){
  const a=xyz(poly[k]),b=xyz(poly[(k+1)%4]),key=[a,b].sort().join('|');sample.set(key,(sample.get(key)||0)+1);
 }
}
const vals=[...sample.values()];assert(vals.every(n=>n<=2));assert.equal(vals.filter(x=>x===1).length,48);assert.equal(vals.filter(x=>x===2).length,168);
assert.equal(E.N,96);assert.equal(Array.from({length:96},(_,i)=>E.center(i)).filter(Boolean).length,6);
const rot=(pt,deg)=>{const a=deg*Math.PI/180,x=pt[0]-610,y=pt[1]-472;return [610+x*Math.cos(a)-y*Math.sin(a),472+x*Math.sin(a)+y*Math.cos(a)]};
for(let r=0;r<4;r++)for(let f=0;f<8;f++)for(const [z,angle]of[['w',120],['b',-120]]){
 const a=E.polygons[E.idx('r',r,f)].map(p=>rot(p,angle)),b=E.polygons[E.idx(z,r,f)];
 for(let k=0;k<4;k++)assert(Math.hypot(a[k][0]-b[k][0],a[k][1]-b[k][1])<eps);
}
console.log('PASS 96 quads, six central cells, 168 shared edges, exact 120° symmetry');
let s=E.fresh();assert.equal(s.b.filter(Boolean).length,48);for(const z of E.C){
 assert.equal(s.b.filter(x=>x?.c===z).length,16);
 assert.equal(E.legal(s,z).length,20);
 for(let f=0;f<8;f++){
  let cell=E.idx(z,1,f);const path=[];
  for(let j=0;j<5;j++){
   let dr=E.zone(cell)===z?1:-1,n=E.step(cell,dr,0);assert(n);
   cell=n.i;path.push(cell);
  }
  assert(path.slice(0,4).every(i=>!s.b[i]),`4-gap violated ${z} ${f}`);
  assert(s.b[path[4]]?.k==='p'&&s.b[path[4]].c!==z);
 }
}
console.log('PASS 4 empty squares separate each pawn front, for all 3 pairs');
s.b.fill(null);for(const z of E.C)s.b[E.layouts[z].king]={c:z,k:'k'};
for(const z of E.C){for(const f of [3,4]){
 const src=E.idx(z,3,f);s.b[src]={c:z,k:'q'};const neighbors=new Set(E.legal(s,z).filter(m=>m.f===src).map(m=>E.zone(m.t)));
 assert(neighbors.has(E.C.filter(x=>x!==z)[0]));assert(neighbors.has(E.C.filter(x=>x!==z)[1]));s.b[src]=null;
}}
console.log('PASS all teams have routes into each of the two opposing sectors');
for(const z of E.C){let g=E.fresh();g.b.fill(null);for(const c of E.C)g.b[E.layouts[c].king]={c,k:'k'};
 for(const rook of E.layouts[z].rooks)g.b[rook]={c:z,k:'r'};
 g.t=z;const castles=E.legal(g,z).filter(m=>m.flag.startsWith('castle'));
 assert.equal(castles.length,2,`castling ${z}`);
}
console.log('PASS castle both wings for each of three colors');
let count=0;for(let game=0;game<12;game++){
 s=E.fresh();for(let turn=0;turn<65&&s.status==='playing';turn++){
  const options=E.legal(s);assert(options.length);
  const m=options[(game*11+turn*19)%options.length],result=E.move(s,m);
  assert(result.ok,result.error);s=result.state;E.validate(s);count++;
 }
}
console.log('PASS',count,'random-ish legal moves / state invariants');
