const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('the pending task total opens maintenance orders, while alarms and evidence keep their own destinations',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../frontend/session-shell.mjs'),'utf8');
 const taskFunction=source.slice(source.indexOf('function updatePersonnelAlarmCard('),source.indexOf("$('account-open').onclick="));
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{children:[],textContent:'',replaceChildren(){this.children=[];},append(...children){this.children.push(...children);},scrollIntoView(){this.scrolled=true;}});return nodes.get(id);};
 const events=[],listeners={};let opened=false,snapshot={active:[{},{},{},{}]};
 const context={$:get,node:(tag,text)=>({tag,textContent:text,children:[],append(...children){this.children.push(...children);},setAttribute(){},set id(value){nodes.set(value,this);}}),paint(){},factoryRequest:async()=>({user:{project:'test'},next:'next',storage:{note:'local'},assigned:3,alarms:5,evidencePending:4,orders:[],reviews:[]}),dialog:{showModal(){opened=true;}},document:{getElementById:get},window:{FactoryTwin:{safetySnapshot:()=>snapshot},addEventListener:(name,fn)=>listeners[name]=fn,dispatchEvent:e=>events.push(e)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}};
 vm.createContext(context);vm.runInContext(taskFunction,context);await context.tasks();
 const [orders,alarms,evidence]=get('my-task-grid').children;
 orders.onclick();assert.equal(events[0].type,'analysis-navigate');assert.equal(events[0].detail.tab,'orders');
 assert.equal(alarms.children[1].textContent,'人员报警中心');assert.equal(get('personnel-alarm-count').textContent,'4');
 alarms.onclick();assert.equal(events[1].type,'personnel-alarm-open');
 snapshot={active:[{},{}]};listeners['factory-safety-update']({detail:snapshot});assert.equal(get('personnel-alarm-count').textContent,'2');
 await context.tasks();assert.equal(get('personnel-alarm-count').textContent,'2');
 evidence.onclick();assert.equal(opened,true);
});
