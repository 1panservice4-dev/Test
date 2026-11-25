/* Chess Tetris V7 — movement defined by the user's reference diagram.
   King: orthodox one-square movement; O pawn: adjacent 8; I rook: THREE squares maximum in each orthogonal direction.
   L knight / S bishop: bounded 5x5 diagram targets (rotated shape placements); T queen: Manhattan diamond radius 2.
   Every piece can jump past other pieces (landing square still must be empty/enemy).
   Standard king-safety, castling, promotion and repetition rules are retained where applicable.
   En passant is inapplicable because O pawns have no two-square advance. */
(function(root,factory){const a=factory();if(typeof module==='object'&&module.exports)module.exports=a;root.ChessTetris=a})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const START='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Offsets as (file Δ, rank-in-screen Δ); positive y points toward blue's home rank.
const O=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
const L=[[-1,-2],[0,-2],[1,-2],[-2,-1],[0,-1],[2,-1],[-2,0],[-1,0],[1,0],[2,0],[-2,1],[0,1],[2,1],[-1,2],[0,2],[1,2]];
const S=[[-1,-2],[1,-2],[-2,-1],[-1,-1],[0,-1],[1,-1],[2,-1],[-1,0],[1,0],[-2,1],[-1,1],[0,1],[1,1],[2,1],[-1,2],[1,2]];
const T=[[0,-2],[-1,-1],[0,-1],[1,-1],[-2,0],[-1,0],[1,0],[2,0],[-1,1],[0,1],[1,1],[0,2]];
// The reference sketch specifies selectable landing cells, not continuous sliding.
// Rotations of each tetromino are reflected by the bounded target map below.
// Every move jumps intervening pieces and occupies exactly one square.
const I=[];for(let n=1;n<=3;n++)I.push([n,0],[-n,0],[0,n],[0,-n]);
const SHAPES={p:O,n:L,r:I,b:S,q:T,k:O};
const on=i=>i>=0&&i<128&&!(i&0x88);
const color=p=>!p||p==='.'?0:(p===p.toUpperCase()?1:-1);
const sq=i=>'abcdefgh'[i&7]+(8-(i>>4));
const idx=s=>(8-Number(s[1]))*16+'abcdefgh'.indexOf(s[0]);
function initial(){const b=Array(128).fill('.');START.split(' ')[0].split('/').forEach((row,r)=>{let c=0;for(const p of row){if(/[1-8]/.test(p))c+=Number(p);else b[r*16+c++]=p}});return {b,t:1,c:15,ep:-1,half:0,full:1}}
function destinations(f,p){const x=f&7,y=f>>4;
 return (SHAPES[p]||[]).flatMap(([dx,dy])=>{const xx=x+dx,yy=y+dy;
  return xx>=0&&xx<8&&yy>=0&&yy<8?[yy*16+xx]:[];
 });
}
// Attacks obey the diagram even when pieces stand between attacker and king.
function attacked(s,target,by){if(target<0)return false;for(let f=0;f<128;f++){if(!on(f)||color(s.b[f])!==by)continue;for(const t of destinations(f,s.b[f].toLowerCase()))if(t===target)return true}return false}
function inCheck(s,who=s.t){const i=s.b.indexOf(who===1?'K':'k');return i<0||attacked(s,i,-who)}
function apply(s,m){const [f,t,q='',flag='']=m,b=s.b.slice(),p=b[f],captured=b[t];let c=s.c;
 b[f]='.';b[t]=q?(s.t===1?q.toUpperCase():q):p;
 if(flag==='castle'){const rf=t>f?f+3:f-4,rt=t>f?f+1:f-1;b[rt]=b[rf];b[rf]='.'}
 if(p==='K')c&=~3;if(p==='k')c&=~12;
 const bits={119:1,112:2,7:4,0:8};if(p.toLowerCase()==='r')c&=~(bits[f]||0);if(captured.toLowerCase()==='r')c&=~(bits[t]||0);
 return {b,t:-s.t,c,ep:-1,half:p.toLowerCase()==='p'||captured!=='.'?0:s.half+1,full:s.full+(s.t===-1?1:0)}
}
function pseudo(s){const out=[];
 for(let f=0;f<128;f++){
  if(!on(f)||color(s.b[f])!==s.t)continue;
  const p=s.b[f].toLowerCase();
  const add=(t,flag='')=>{
   if(color(s.b[t])===s.t||s.b[t].toLowerCase()==='k')return;
   if(p==='p'&&(t>>4===0||t>>4===7))for(const q of ['q','r','b','n'])out.push([f,t,q,flag]);
   else out.push([f,t,'',flag]);
  };
  for(const t of destinations(f,p))add(t);
  if(p==='k'){
   const home=s.t===1?116:4,rook=s.t===1?'R':'r',bits=s.t===1?[1,2]:[4,8];
   if(f===home&&!inCheck(s)){
    if((s.c&bits[0])&&s.b[f+3]===rook&&s.b[f+1]==='.'&&s.b[f+2]==='.'&&!attacked(s,f+1,-s.t)&&!attacked(s,f+2,-s.t))add(f+2,'castle');
    if((s.c&bits[1])&&s.b[f-4]===rook&&s.b[f-1]==='.'&&s.b[f-2]==='.'&&s.b[f-3]==='.'&&!attacked(s,f-1,-s.t)&&!attacked(s,f-2,-s.t))add(f-2,'castle');
   }
  }
 }
 return out;
}
function legal(s){return pseudo(s).filter(m=>!inCheck(apply(s,m),s.t))}
// Horizontal: exclude the mover's first THREE home ranks; Vertical: ALL eight ranks, home ranks included.
function lineWin(s,who){const owns=i=>color(s.b[i])===who;const rows=who===1?[0,1,2,3,4]:[3,4,5,6,7];
 for(const r of rows)if(Array.from({length:8},(_,c)=>r*16+c).every(owns))return {kind:'row',index:r};
 for(let c=0;c<8;c++)if(Array.from({length:8},(_,r)=>r).every(r=>owns(r*16+c)))return {kind:'column',index:c};
 return null;
}
// Orthodox insufficient-material patterns aren't valid for these custom moving pieces.
// Only bare kings are known to lack a possible line/checkmate under the current setup.
function insufficient(s){for(let i=0;i<128;i++)if(on(i)&&s.b[i]!=='.'&&s.b[i].toLowerCase()!=='k')return false;return true}
function key(s){return s.b.filter((p,i)=>on(i)).join('')+'|'+s.t+'|'+s.c}
function outcome(s,history=[]){const winner=-s.t,ln=lineWin(s,winner);if(ln)return {done:true,winner,reason:'line',line:ln};const moves=legal(s);
 if(!moves.length){const check=inCheck(s);return {done:true,winner:check?winner:0,reason:check?'checkmate':'stalemate'}}
 if(insufficient(s))return {done:true,winner:0,reason:'insufficient'};
 if(s.half>=150)return {done:true,winner:0,reason:'75move'};
 if(history.filter(x=>x===key(s)).length>=5)return {done:true,winner:0,reason:'fivefold'};
 return {done:false,winner:null,reason:''};
}
function moveKey(m){return sq(m[0])+sq(m[1])+m[2]}
function parseMove(s,str){return legal(s).find(m=>moveKey(m)===str)||null}
function notation(s,m){const p=s.b[m[0]].toUpperCase();if(m[3]==='castle')return m[1]>m[0]?'O-O':'O-O-O';
 const capture=s.b[m[1]]!=='.';let label=p==='P'?(capture?sq(m[0])[0]:''):p;
 if(p!=='P'){const competing=legal(s).filter(x=>x[0]!==m[0]&&x[1]===m[1]&&s.b[x[0]]===s.b[m[0]]);
 if(competing.length)label+=!competing.some(x=>(x[0]&7)===(m[0]&7))?sq(m[0])[0]:!competing.some(x=>(x[0]>>4)===(m[0]>>4))?sq(m[0])[1]:sq(m[0]);}
 label+=(capture?'x':'')+sq(m[1])+(m[2]?'='+m[2].toUpperCase():'');const next=apply(s,m);
 return label+(lineWin(next,s.t)?'★':inCheck(next)?legal(next).length?'+':'#':'');
}
return {START,SHAPES,initial,on,color,sq,idx,destinations,attacked,inCheck,legal,apply,lineWin,insufficient,key,outcome,moveKey,parseMove,notation};
});
