const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('stopping an in-flight simulation cannot restore running UI or switch source',async()=>{
 const nodes=new Map();const draw=new Proxy({},{get:()=>()=>{}});
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'phone',textContent:'',getContext:()=>draw,addEventListener(type,fn){this[type]=fn;}});return nodes.get(id);};
 let resolve,rendered=0,body;
 const sandbox={document:{getElementById:node},window:{addEventListener(){}},API_BASE:'local',setInterval:()=>1,clearInterval(){},state:{},status(){},renderSpatial(){rendered++;},request:(_,opts)=>{body=JSON.parse(opts.body);return new Promise(r=>resolve=r);}};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../frontend/motion.js'),'utf8'),sandbox);
 node('motion-start').click();assert.equal(body.mode,'phone');
 node('motion-stop').click();const stopped=node('motion-status').textContent;node('motion-mode').value='camera';
 resolve({state:{people:[],revision:1}});await new Promise(r=>setImmediate(r));
 assert.equal(rendered,0);assert.equal(node('motion-status').textContent,stopped);assert.equal(node('motion-start').disabled,false);
});
