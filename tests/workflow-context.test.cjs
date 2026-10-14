const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
class Element{
 constructor(){this.children=[];this.options=[];this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.listeners={};this.classList={toggle(){},contains(){return false;}};}
 addEventListener(type,fn){this.listeners[type]=fn;}
 replaceChildren(...nodes){this.children=nodes;this.options=nodes;}
 after(){} append(...nodes){this.children.push(...nodes);}querySelectorAll(){return [];}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function caseFor(id){return {observation:{id,title:id,statusLabel:'待核验',measurements:{},source:'demo',observedAt:null,rule:{basis:'unverified'}},ledger:[],toolResults:[],factoryRevision:1,capturedAt:new Date().toISOString()};}
async function harness(){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};get('workflow-entity').value='B-05';
 const panel=new Element();panel.querySelector=selector=>get(selector.replace(/^#/,''));
 const events={},requests=[],replies=[],confirmReplies=[],dispatched=[];
 const context={document:{createElement:tag=>tag==='section'?panel:new Element(),body:{classList:{contains:()=>false}}},window:{addEventListener:(name,fn)=>events[name]=fn,dispatchEvent:e=>dispatched.push(e)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},factoryRefresh:{register(){}},initBusinessEvidence(){},factorySession:()=>null,
  factoryRequest:async(url='/state',body)=>{if(url==='/auth/mode')return {simulationEnabled:true};if(url==='/state')return {entities:['B-05','B-01'].map(id=>({id,title:id,kind:'device'}))};if(url.startsWith('/workflow/case/'))return caseFor('B-05');if(url==='/workflow/chat'){requests.push(body);return replies.shift();}if(url.endsWith('/confirm'))return confirmReplies.shift();throw Error(url);}};
 vm.createContext(context);const source=fs.readFileSync(path.join(__dirname,'../frontend/device-workflow.mjs'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function','function');
 vm.runInContext(source,context);context.initDeviceWorkflow({querySelector:()=>new Element()});await flush();
 return {get,events,requests,replies,confirmReplies,dispatched,async ask(query,response){get('workflow-query').value=query;replies.push(response);get('workflow-ask').listeners.submit({preventDefault(){},submitter:new Element()});await flush();}};
}
test('a new question immediately clears a previous draft, even if the request fails',async()=>{
 const h=await harness(),draft={id:'draft-1',entityId:'B-05',reason:'check',case:caseFor('B-05')};
 await h.ask('prepare',{answer:'draft',case:draft.case,draft});assert.equal(h.get('workflow-draft').hidden,false);assert.match(h.get('workflow-confirm').textContent,/B-05/);
 let reject;const pending=new Promise((_,r)=>reject=r);h.replies.push(pending);h.get('workflow-query').value='other device';h.get('workflow-ask').listeners.submit({preventDefault(){},submitter:new Element()});
 assert.equal(h.get('workflow-draft').hidden,true);assert.equal(h.get('workflow-confirm').disabled,true);
 reject(Error('offline'));await flush();assert.equal(h.get('workflow-draft').hidden,true);
});
test('a resolved device is used by the next pronoun-only question',async()=>{
 const h=await harness();await h.ask('B01 status',{answer:'B01',case:caseFor('B-01')});assert.equal(h.get('workflow-entity').value,'B-01');
 await h.ask('its temperature',{answer:'temperature',case:caseFor('B-01')});assert.equal(h.requests.at(-1).entityId,'B-01');
});
test('external results clear old drafts and late external draft responses cannot overwrite a new question',async()=>{
 const h=await harness(),draft={id:'old',entityId:'B-05',reason:'check',case:caseFor('B-05')};
 h.events['workflow-chat-result']({detail:{answer:'draft',case:draft.case,draft}});assert.equal(h.get('workflow-draft').hidden,false);
 h.events['workflow-chat-result']({detail:{answer:'status',case:caseFor('B-01')}});assert.equal(h.get('workflow-draft').hidden,true);
 const token={};h.events['workflow-request-start']({detail:{token}});
 await h.ask('B01 status',{answer:'new answer',case:caseFor('B-01')});
 h.events['workflow-chat-result']({detail:{token,answer:'late old draft',case:draft.case,draft}});
 assert.equal(h.get('workflow-answer').textContent,'new answer');assert.equal(h.get('workflow-draft').hidden,true);
});

test('an earlier confirmation response does not replace the answer to a newer question',async()=>{
 const h=await harness(),draft={id:'draft-confirm',entityId:'B-05',reason:'check',case:caseFor('B-05')};
 h.events['workflow-chat-result']({detail:{answer:'draft',case:draft.case,draft}});
 let resolve;h.confirmReplies.push(new Promise(r=>resolve=r));
 h.get('workflow-confirm').listeners.click({currentTarget:h.get('workflow-confirm')});
 await h.ask('B01 status',{answer:'latest question',case:caseFor('B-01')});
 resolve({order:{id:'order-1',assignee:'repair'}});await flush();
 assert.equal(h.get('workflow-answer').textContent,'latest question');assert.equal(h.get('workflow-entity').value,'B-01');
 assert.equal(h.dispatched[0].type,'workflow-order-created');
});

test('general chat retains history and clearing it invalidates a pending response',async()=>{
 const h=await harness();await h.ask('what is calculus',{success:true,intent:'general',answer:'Rates and accumulation',tool_results:[]});
 await h.ask('give an example',{success:true,intent:'general',answer:'Speed',tool_results:[]});
 assert.equal(h.requests.at(-1).history.length,2);
 let resolve;h.replies.push(new Promise(r=>resolve=r));h.get('workflow-query').value='late question';h.get('workflow-ask').listeners.submit({preventDefault(){},submitter:new Element()});
 h.get('workflow-clear').listeners.click();resolve({success:true,intent:'general',answer:'late answer'});await flush();
 assert.notEqual(h.get('workflow-answer').textContent,'late answer');
 await h.ask('new conversation',{success:true,intent:'general',answer:'new',tool_results:[]});assert.equal(h.requests.at(-1).history.length,0);
});
