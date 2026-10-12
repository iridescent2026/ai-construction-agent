const test=require('node:test'),assert=require('node:assert/strict');
function container(){
 const c={childNodes:[],get children(){return this.childNodes.filter(n=>n.nodeType===1);},insertBefore(n,b){n.remove();const i=b?this.childNodes.indexOf(b):this.childNodes.length;this.childNodes.splice(i,0,n);n.parentNode=this;}};
 c.ownerDocument={createElement(){return {nodeType:1,dataset:{},textContent:'',listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},remove(){if(this.parentNode){this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this),1);this.parentNode=null;}}};}};return c;
}
test('live refresh preserves clickable nodes and uses the latest selection callback',async()=>{
 const {reconcileButtons}=await import('../frontend/live-buttons.mjs');const c=container(),calls=[];
 const opts={key:i=>i.id,label:i=>i.title,className:'alert-item',select:id=>calls.push('old:'+id)};
 reconcileButtons(c,[{id:'P1:Z1',title:'进入区域'}],opts);const button=c.children[0];
 reconcileButtons(c,[{id:'P1:Z1',title:'位置未知'}],{...opts,select:id=>calls.push('latest:'+id)});
 assert.equal(c.children[0],button);assert.equal(button.textContent,'位置未知');button.listeners.click();assert.deepEqual(calls,['latest:P1:Z1']);
});
test('order refresh reorders existing targets and removes only absent orders',async()=>{
 const {reconcileOrderList}=await import('../frontend/live-buttons.mjs');const c=container(),names={open:'待指派',closed:'已关闭'};
 reconcileOrderList(c,[{id:'1',entityId:'B-05',status:'open'},{id:'2',entityId:'A-01',status:'open'}],names,()=>{});const [one,two]=c.children;
 reconcileOrderList(c,[{id:'2',entityId:'A-01',status:'closed'},{id:'1',entityId:'B-05',status:'open'}],names,()=>{});assert.deepEqual(c.children,[two,one]);assert.match(two.textContent,/已关闭/);
 reconcileOrderList(c,[{id:'1',entityId:'B-05',status:'open'}],names,()=>{});assert.deepEqual(c.children,[one]);assert.equal(two.parentNode,null);
});
