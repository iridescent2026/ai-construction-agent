const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const vendor=pathToFileURL(path.join(root,'frontend/vendor/three/three.module.js')).href;
const source=fs.readFileSync(path.join(root,'frontend/factory-model.mjs'),'utf8').replace("from 'three'",`from '${vendor}'`).replace("from './factory-footprints.mjs'",`from '${pathToFileURL(path.join(root,'frontend/factory-footprints.mjs')).href}'`);
(async()=>{const {buildFactory,VIEWS}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));const entities=Object.keys(VIEWS).flatMap(v=>{const m=buildFactory(v);return [...m.userData.devices,...m.userData.people,...m.userData.zones];});const {DEMO_PATHS}=await import(pathToFileURL(path.join(root,'frontend/factory-safety.mjs')));fs.writeFileSync(path.join(root,'gis/factory-catalog.json'),JSON.stringify({catalogRevision:3,entities,paths:DEMO_PATHS},null,2)+'\n');})();
