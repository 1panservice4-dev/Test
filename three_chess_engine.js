/* Stage 07 · symmetric 96-square / three-sector chess.
 * Identical code runs on server and in browser. Each of six 4x4 panels
 * occupies 60 degrees of the hexagon, producing exactly six central cells.
 */
(function(root,factory){const engine=factory();if(typeof module==='object'&&module.exports)module.exports=engine;root.ThreeChess=engine;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const C=['w','b','r'],N=96,LABEL={w:'백',b:'흑',r:'빨강'};
const ICON={w:{k:'♔',q:'♕',r:'♖',b:'♗',n:'♘',p:'♙'},b:{k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'},r:{k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'}};
const idx=(team,depth,file)=>{const c=C.indexOf(team);return c<0||depth<0||depth>3||file<0||file>7?-1:c*32+depth*8+file;};
const zone=i=>C[Math.floor(i/32)],row=i=>Math.floor(i%32/8),col=i=>i%8;
const at=(r,c,team='w')=>idx(team,r,c);
const id=i=>i<0||i>=N?'—':zone(i).toUpperCase()+String.fromCharCode(65+col(i))+(row(i)+1);
const byName=s=>{const m=/^([WBR])([A-H])([1-4])$/i.exec(s||'');return m?idx(m[1].toLowerCase(),Number(m[3])-1,m[2].toUpperCase().charCodeAt(0)-65):-1;};
const own=(s,i)=>i>=0&&s.b[i]?s.b[i].c:null,empty=(s,i)=>i>=0&&!s.b[i];
const opposite=(p,q)=>p&&q&&p.c!==q.c;
const ORTHO=[[0,-1],[0,1],[-1,0],[1,0]],DIAG=[[-1,-1],[-1,1],[1,-1],[1,1]];
const KING=[...ORTHO,...DIAG];const CYCLE={w:{left:'b',right:'r'},b:{left:'r',right:'w'},r:{left:'w',right:'b'}};
function step(i,dr,df){
 if(i<0)return null;
 const z=zone(i),r=row(i),f=col(i),nr=r+dr,nf=f+df;
 if(dr===1&&r===3){
  if(nf<0||nf>7)return null;
  const destination=CYCLE[z][nf<4?'left':'right'];
  // The frontiers mirror their file numbering. Every crossing retains one
  // physical grid step; rooks bend at the center, bishops keep tile colour.
  return {i:idx(destination,3,7-nf),dr:-1,df:-df};
 }
 if(nr<0||nr>3||nf<0||nf>7)return null;
 return {i:idx(z,nr,nf),dr,df};
}
const oppositeSeat={w:120,b:-120,r:0};
const ORIGIN=[610,472],SIDE=524,HALFH=SIDE*Math.sqrt(3)/2;
const A=[610-SIDE/2,472-HALFH],B=[610+SIDE/2,472-HALFH],
      CMAX=[610+SIDE,472],D=[610+SIDE/2,472+HALFH],
      E=[610-SIDE/2,472+HALFH],F=[610-SIDE,472];
const midpoint=(x,y)=>[(x[0]+y[0])/2,(x[1]+y[1])/2];
const ME=midpoint(E,D),ML=midpoint(E,F),MR=midpoint(D,CMAX);
const interpolate=(p,q,t)=>[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];
function rotate(p,deg){const a=deg*Math.PI/180,dx=p[0]-ORIGIN[0],dy=p[1]-ORIGIN[1];return [ORIGIN[0]+dx*Math.cos(a)-dy*Math.sin(a),ORIGIN[1]+dx*Math.sin(a)+dy*Math.cos(a)];}
function vertex(team,r,f){
 // Exactly six congruent panels of 4x4 cells; two panels per player.
 const left=f<=4,t=left?f/4:(f-4)/4;
 const baseL=left?E:ME,baseR=left?ME:D;
 const frontL=left?ML:ORIGIN,frontR=left?ORIGIN:MR;
 const p=interpolate(interpolate(baseL,baseR,t),interpolate(frontL,frontR,t),r/4);
 return rotate(p,oppositeSeat[team]);
}
const polygons=Array.from({length:N},(_,i)=>{
 const z=zone(i),r=row(i),f=col(i);
 return [vertex(z,r,f),vertex(z,r,f+1),vertex(z,r+1,f+1),vertex(z,r+1,f)];
});
const centers=polygons.map(poly=>poly.reduce((s,p)=>[s[0]+p[0]/4,s[1]+p[1]/4],[0,0]));
const center=i=>polygons[i].some(p=>Math.hypot(p[0]-ORIGIN[0],p[1]-ORIGIN[1])<.01);
const layouts=Object.fromEntries(C.map(z=>[z,{king:idx(z,0,4),rooks:[idx(z,0,0),idx(z,0,7)],
 short:{rook:idx(z,0,7),end:idx(z,0,6),rookEnd:idx(z,0,5)},
 long:{rook:idx(z,0,0),end:idx(z,0,2),rookEnd:idx(z,0,3)}}]));
function fresh(){const b=Array(N).fill(null),order=['r','n','b','q','k','b','n','r'];
 for(const z of C)for(let f=0;f<8;f++){
  b[idx(z,0,f)]={c:z,k:order[f]};b[idx(z,1,f)]={c:z,k:'p'};
 }
 return {b,t:'w',alive:{w:true,b:true,r:true},rights:Object.fromEntries(C.map(z=>[z,{short:true,long:true}])),ep:null,seq:0,log:[],status:'playing',winner:null,reason:'',last:null,skip:[],game:1};
}
function clone(s){return {...s,b:s.b.slice(),alive:{...s.alive},rights:Object.fromEntries(C.map(z=>[z,{...s.rights[z]}])),ep:s.ep?{...s.ep}:null,log:s.log.slice(),skip:(s.skip||[]).slice()};}
function freezeArmy(s,z){for(let i=0;i<N;i++)if(s.b[i]?.c===z)s.b[i]={...s.b[i],frozen:true};}
function kingIndex(s,z){return s.b.findIndex(p=>p&&p.c===z&&p.k==='k');}
function nextColor(z){return C[(C.indexOf(z)+1)%3];}
function isPromotion(p,t){return p.k==='p'&&zone(t)!==p.c&&row(t)===0;}
function forwardDir(p,i){return zone(i)===p.c?1:-1;}
function ray(s,i,dr,df){const out=[],seen=new Set([i]);let st={i,dr,df};
 for(let count=0;count<14;count++){
  const nx=step(st.i,st.dr,st.df);if(!nx||seen.has(nx.i))break;
  out.push(nx.i);seen.add(nx.i);
  if(s.b[nx.i])break;
  st=nx;
 }
 return out;
}
function knightDest(i){
 // A knight follows two edges in one orthogonal direction and one in the
 // other. Near the six-piece seam, both possible orders are considered.
 const result=new Set();
 for(const [dr,df] of [[-1,0],[1,0],[0,-1],[0,1]]){
  for(const sign of [-1,1]){
   const tr=dr?0:sign,tf=dr?sign:0;
   for(const order of [[dr,df,tr,tf],[tr,tf,dr,df]]){
    let st={i,dr:order[0],df:order[1]},valid=true;
    // If we run in the minor direction first, use one step and then two.
    const minorFirst=order[0]===tr&&order[1]===tf;
    const directions=minorFirst?[[tr,tf],[dr,df],[dr,df]]:[[dr,df],[dr,df],[tr,tf]];
    let current=i,lastDir=null;
    for(let k=0;k<3;k++){
     let [a,b]=directions[k];
     // After crossing, both coordinate axes reverse under the seam mirror.
     if(lastDir&&lastDir.i!==current){} // extension point for symmetry checks
     const next=step(current,a,b);if(!next){valid=false;break;}
     // Track the seam reversal for subsequent steps on this side.
     if((a===1&&row(current)===3)&&zone(next.i)!==zone(current)){
      for(let j=k+1;j<3;j++){directions[j][0]*=-1;directions[j][1]*=-1;}
     }
     current=next.i;lastDir=next;
    }
    if(valid&&current!==i)result.add(current);
   }
  }
 }
 return [...result];
}
const KNIGHTS=Array.from({length:N},(_,i)=>knightDest(i));
function pseudo(s,color,attacks=false){if(!s.alive[color])return [];
 const result=[];
 const add=(f,t,p,flag='',extra={})=>{
  if(t<0||own(s,t)===color)return;
  if(!attacks&&isPromotion(p,t))for(const promote of ['q','r','b','n'])result.push({f,t,flag,promote,...extra});
  else result.push({f,t,flag,...extra});
 };
 for(let f=0;f<N;f++){
  const p=s.b[f];if(!p||p.c!==color||p.frozen)continue;
  if(p.k==='p'){
   const direction=forwardDir(p,f),fwd=step(f,direction,0);
   if(!attacks&&fwd&&empty(s,fwd.i)){
    add(f,fwd.i,p);
    if(zone(f)===color&&row(f)===1){const again=step(fwd.i,fwd.dr,0);if(again&&empty(s,again.i))add(f,again.i,p,'double',{passed:fwd.i});}
   }
   for(const diag of [-1,1]){
    const v=step(f,direction,diag);if(!v)continue;
    if(attacks||opposite(p,s.b[v.i]))add(f,v.i,p);
    else if(s.ep?.to===v.i&&s.ep.color!==color&&s.ep.createdAt===s.seq)
     result.push({f,t:v.i,flag:'ep',captured:s.ep.pawn});
   }
  }else if(p.k==='n')for(const t of KNIGHTS[f])add(f,t,p);
  else if(p.k==='k'){
   for(const [dr,df] of KING){const v=step(f,dr,df);if(v)add(f,v.i,p);}
   if(!attacks&&f===layouts[color].king&&!isCheck(s,color)){
    for(const side of ['short','long']){
     if(!s.rights[color][side])continue;
     const cas=layouts[color][side],rook=s.b[cas.rook];if(!rook||rook.c!==color||rook.k!=='r'||rook.frozen)continue;
     const src=col(f),dest=col(cas.rook),delta=Math.sign(dest-src);let okay=true;
     for(let file=src+delta;file!==dest;file+=delta)if(s.b[idx(color,0,file)]){okay=false;break;}
     if(!okay)continue;
     for(let m=1;m<=2;m++)if(isAttacked(s,idx(color,0,src+m*delta),color)){okay=false;break;}
     if(okay)add(f,cas.end,p,'castle-'+side);
    }
   }
  }else{
   const dirs=p.k==='q'?KING:p.k==='r'?ORTHO:DIAG;
   for(const [dr,df] of dirs)for(const t of ray(s,f,dr,df))add(f,t,p);
  }
 }
 return result;
}
function targets(s,color){return new Set(pseudo(s,color,true).map(m=>m.t));}
function isAttacked(s,i,friend){if(i<0)return true;for(const c of C)if(c!==friend&&s.alive[c]&&targets(s,c).has(i))return true;return false;}
function isCheck(s,c){return !!s.alive[c]&&isAttacked(s,kingIndex(s,c),c);}
function applyRaw(s,m,color){const q=clone(s),p=q.b[m.f];if(!p||p.c!==color||p.frozen)throw Error('not owner');
 const victim=q.b[m.t];if(victim?.k==='k'&&q.alive[victim.c]){q.alive[victim.c]=false;freezeArmy(q,victim.c);}
 q.b[m.f]=null;q.b[m.t]={...p,k:m.promote||p.k};
 if(m.flag==='ep'&&Number.isInteger(m.captured))q.b[m.captured]=null;
 if(m.flag==='castle-short'||m.flag==='castle-long'){
  const cas=layouts[color][m.flag==='castle-short'?'short':'long'];q.b[cas.rookEnd]=q.b[cas.rook];q.b[cas.rook]=null;
 }
 if(p.k==='k')q.rights[color]={short:false,long:false};
 if(p.k==='r')for(const side of ['short','long'])if(m.f===layouts[color][side].rook)q.rights[color][side]=false;
 if(victim?.k==='r')for(const side of ['short','long'])if(m.t===layouts[victim.c][side].rook)q.rights[victim.c][side]=false;
 q.ep=null;
 if(p.k==='p'&&m.flag==='double')q.ep={to:m.passed,pawn:m.t,color,createdAt:s.seq+1};
 return q;
}
function legal(s,color=s.t){if(s.status!=='playing'||!s.alive[color])return [];
 return pseudo(s,color).filter(m=>!isCheck(applyRaw(s,m,color),color));}
function advance(q,last){const living=()=>C.filter(c=>q.alive[c]);
 if(living().length===1){q.status='ended';q.winner=living()[0];q.reason='마지막 왕이 살아남았습니다.';q.t=q.winner;return q;}
 let player=nextColor(last),skipped=0;
 for(let steps=0;steps<9;steps++){
  if(!q.alive[player]){player=nextColor(player);continue;}
  q.t=player;const moves=legal(q,player);if(moves.length)return q;
  if(isCheck(q,player)){
   q.alive[player]=false;freezeArmy(q,player);
   q.log.push({text:`${LABEL[player]} 체크메이트 · 탈락`,kind:'elimination'});
   if(living().length===1){q.status='ended';q.winner=living()[0];q.reason='체크메이트로 마지막 플레이어가 승리했습니다.';q.t=q.winner;return q;}
  }else{
   if(living().length===2){q.status='draw';q.winner=null;q.reason='2명이 남은 상태에서 스테일메이트 · 무승부';return q;}
   if(!q.skip.includes(player))q.skip.push(player);skipped++;
  }
  player=nextColor(player);
 }
 q.status='draw';q.winner=null;q.reason='생존 플레이어가 수를 둘 수 없습니다.';return q;
}
function notation(m){return id(m.f)+(m.flag?.startsWith('castle')?' 캐슬링 ':' → ')+id(m.t)+(m.promote?'='+m.promote.toUpperCase():'');}
function move(s,input){if(s.status!=='playing')return {ok:false,error:'경기가 종료됐습니다.'};const c=s.t;
 const f=Number(input.f),t=Number(input.t),promote=input.promote||'q';
 const m=legal(s,c).find(x=>x.f===f&&x.t===t&&(!x.promote||x.promote===promote));
 if(!m)return {ok:false,error:isCheck(s,c)?'체크 상태를 먼저 벗어나야 합니다.':'허용되지 않는 이동입니다.'};
 const q=applyRaw(s,m,c);q.seq=s.seq+1;q.last={f,t,color:c};q.log.push({color:c,text:notation(m),kind:'move'});
 if(q.log.length>80)q.log=q.log.slice(-80);q.skip=[];q.t=nextColor(c);advance(q,c);
 return {ok:true,state:q,move:m};
}
function resign(s,c){if(!s.alive[c]||s.status!=='playing')return s;
 const q=clone(s);q.alive[c]=false;freezeArmy(q,c);q.log.push({text:`${LABEL[c]} 기권`,kind:'elimination'});
 if(C.filter(k=>q.alive[k]).length===1){q.status='ended';q.winner=C.find(k=>q.alive[k]);q.reason='상대 플레이어 기권';}
 else advance(q,s.t===c?c:C[(C.indexOf(s.t)+2)%3]);return q;
}
function validate(s){if(!s||!Array.isArray(s.b)||s.b.length!==N)throw Error('board length must be 96');
 for(const c of C){if(s.alive[c]&&kingIndex(s,c)<0)throw Error('missing king '+c);
  for(const p of s.b)if(p?.c===c&&!!p.frozen===!!s.alive[c])throw Error('frozen mismatch '+c);
 }return true;
}
return {N,C,LABEL,ICON,id,byName,idx,zone,row,col,at,layouts,fresh,clone,pseudo,legal,move,advance,isAttacked,isCheck,resign,validate,notation,knightDest,center,polygons,centers,step,ray,ORIGIN};
});
