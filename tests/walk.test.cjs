const test=require('node:test'),assert=require('node:assert/strict');
const bounds={minX:-10,maxX:10,minZ:-10,maxZ:10};
test('large steps cannot tunnel through a wall',async()=>{const {stepWalk}=await import('../frontend/walk-math.mjs');const boxes=[{minX:0,maxX:1,minZ:-10,maxZ:10}];assert(stepWalk([-5,0],12,0,bounds,boxes)[0]<-.3);});
test('camera stays within bounds and slides past obstruction',async()=>{const {stepWalk}=await import('../frontend/walk-math.mjs');const boxes=[{minX:0,maxX:1,minZ:-3,maxZ:3}];const p=stepWalk([-.5,0],1,2,bounds,boxes);assert(p[0]<-.3&&p[1]>1.9);assert(stepWalk([0,0],200,0,bounds,[])[0]<9.7);});
test('equipment observation points are outside collision boxes',async()=>{const {freeObservationSpot,blocked}=await import('../frontend/walk-math.mjs');const boxes=[{minX:-3,maxX:3,minZ:-3,maxZ:3}];const p=freeObservationSpot([0,0],bounds,boxes);assert(p&&!blocked(...p,bounds,boxes,.5));});
