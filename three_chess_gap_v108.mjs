import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const E=require('../three_chess_engine.js');
const s=E.fresh();
assert.equal(E.N,112);assert.equal(s.b.length,112);assert.equal(s.b.filter(Boolean).length,48);
for(let c=0;c<8;c++){
 assert.equal(s.b[E.at(12,c)]?.c,'w','white pawn front');
 for(let r=8;r<=11;r++)assert.equal(s.b[E.at(r,c)],null,`empty neutral row ${r} file ${c}`);
 assert.equal(s.b[E.at(7,1)]?.c,'b');assert.equal(s.b[E.at(7,6)]?.c,'r');
}
assert.equal(E.row(E.layouts.w.king),13);assert.equal(E.row(E.layouts.w.rooks[0]),13);
assert.equal(E.byName('E1'),E.at(13,4));assert.equal(E.byName('E14'),E.at(0,4));
assert(E.legal(s).some(m=>m.f===E.at(12,4)&&m.t===E.at(11,4)));
for(let i=0;i<112;i++){assert.equal(E.byName(E.id(i)),i,'notation roundtrip '+i);}
E.validate(s);
console.log('PASS 112 cells, four completely empty rows between pawn lines, notation, castling origins, and basic movement');
