const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
test('an immediate login waits for mode and creates its demo space before authentication',async()=>{
 let resolveMode;const modeResponse=new Promise(r=>resolveMode=r),calls=[],nodes=new Map(),values=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',addEventListener(){},append(){},setAttribute(){}});return nodes.get(id)};
 const store={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};let destination;
 const context={document:{getElementById:get,createElement:()=>({})},factoryBase:'https://demo.test',setFactorySession(){},navigator:{},sessionStorage:store,localStorage:store,location:{replace:u=>destination=u},fetch:async(url,options)=>{calls.push({url,options});if(url.endsWith('/mode'))return modeResponse;if(url.endsWith('/demo-session'))return {ok:true,json:async()=>({workspace:'isolated-test-space',expiresAt:Date.now()/1000+86400})};return {ok:true,json:async()=>({token:'test-session'})}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/login.mjs'),'utf8').replace(/^import .*;\r?\n/,''),context);
 const pending=context.login('demo-safety','fixture-password');await Promise.resolve();assert.equal(calls.length,1);
 resolveMode({ok:true,json:async()=>({demoAccounts:true,project:'test',storage:{durable:true}})});await pending;
 assert.deepEqual(calls.map(c=>c.url.split('/').pop()),['mode','demo-session','login']);assert.equal(calls[2].options.headers['X-Demo-Workspace'],'isolated-test-space');assert.equal(destination,'home.html');
});
