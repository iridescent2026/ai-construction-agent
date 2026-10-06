const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

test('homepage table filtering and location actions use the same factory catalogue without invented telemetry',()=>{
    class Element{
        constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.textContent='';this.value='';this.attributes={};this.listeners={};this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}
        appendChild(el){this.children.push(el);return el;}replaceChildren(...children){this.children=children;}setAttribute(k,v){this.attributes[k]=v;}addEventListener(type,fn){this.listeners[type]=fn;}
    }
    const elements=new Map(),node=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},events={},located=[];
    node('equipment-area').value='all';
    const catalog=[{id:'A-01',kind:'device',view:'a',title:'液压冲压机',text:'巡检关注：运动夹点 · 场景设计示意'},{id:'B-03',kind:'device',view:'b',title:'工艺介质阀门组',text:'巡检关注：泄漏 · 场景设计示意'},{id:'P002',kind:'person',view:'b',title:'巡检人员'},{id:'Z006',kind:'zone',view:'b',title:'阀门操作区',devices:['B-03']}];
    const context={document:{getElementById:node,createElement:tag=>new Element(tag)},window:{FactoryTwin:{catalog:()=>catalog,locate:id=>located.push(id)},addEventListener:(name,fn)=>events[name]=fn}};
    vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/factory-home.mjs'),'utf8'),context);
    assert.equal(node('equipment-rows').children.length,2);assert.equal(node('metric-devices').textContent,'02');
    assert.equal(node('equipment-rows').children[0].children[3].children[0].textContent,'待接入');
    node('equipment-area').value='b';node('equipment-area').listeners.change();assert.equal(node('equipment-rows').children.length,1);assert.equal(node('equipment-rows').children[0].dataset.entityId,'B-03');
    node('equipment-rows').children[0].children.at(-1).children[0].listeners.click();assert.deepEqual(located,['B-03']);
    events['factory-select']({detail:catalog[1]});assert.ok(node('equipment-rows').children[0].classes.has('row-selected'));
    node('equipment-search').value='不存在';node('equipment-search').listeners.input();assert.equal(node('equipment-rows').children[0].children[0].colSpan,6);
    node('personnel-rows').children[0].children.at(-1).children[0].listeners.click();node('zone-rows').children[0].children.at(-1).children[0].listeners.click();assert.deepEqual(located,['B-03','P002','Z006']);
});
