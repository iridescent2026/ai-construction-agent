const test=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const markers=import(pathToFileURL(path.resolve(__dirname,'../frontend/scene-markers.mjs')).href);

class Element {
    constructor(){this.children=[];this.events={};this.attributes={};this.classes=new Set();this.hidden=false;this.offsetWidth=100;this.offsetHeight=28;
        this.style={setProperty(){}};this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c)};}
    appendChild(node){node.parent=this;this.children.push(node);}
    remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}
    setAttribute(key,value){this.attributes[key]=value;}
    removeAttribute(key){delete this.attributes[key];}
    addEventListener(type,fn){this.events[type]=fn;}
    emit(type,event={}){this.events[type]?.(event);}
}

test('hover and keyboard preview survive live updates, use current details, and clear when hidden or removed',async()=>{
    const {SceneMarkers}=await markers;global.document={createElement:()=>new Element()};
    try{
        const previews=[],selections=[],container=new Element();
        const layer=new SceneMarkers(container,info=>selections.push(info),info=>previews.push(info));
        const first={id:'P001',kind:'person',title:'P001',text:'old'};
        layer.begin();const record=layer.set('person:P001','P001',first,'red');layer.end();
        layer.layout(new Map([['person:P001',{x:5,y:80}]]),320,300);
        record.node.emit('pointerenter',{pointerType:'mouse'});
        assert.equal(previews.at(-1),first);assert.equal(layer.tooltip.textContent,'P001');assert.equal(layer.tooltip.hidden,false);
        assert.equal(selections.length,0,'preview must not select or reposition the camera');
        assert.match(layer.tooltip.style.transform,/translate\(5px,/,'tooltip stays inside the left edge');
        const updated={...first,text:'latest'};
        layer.begin();assert.equal(layer.set('person:P001','P001',updated,'orange').node,record.node);layer.end();
        assert.equal(previews.at(-1),updated);assert.equal(layer.tooltip.hidden,false);
        record.node.emit('click');assert.equal(selections.at(-1),updated,'click must not capture stale observation');
        record.node.emit('pointerleave');assert.equal(previews.at(-1),null);assert.equal(layer.tooltip.hidden,true);
        record.node.emit('focus');record.node.emit('pointerenter',{pointerType:'mouse'});record.node.emit('pointerleave');
        assert.equal(previews.at(-1),updated,'mouse leaving must preserve keyboard focus');
        record.node.emit('keydown',{key:'Escape',preventDefault(){}});assert.equal(previews.at(-1),null);
        record.node.emit('blur');record.node.emit('pointerenter',{pointerType:'touch'});assert.equal(layer.active,null);
        record.node.emit('pointerenter',{pointerType:'mouse'});layer.layout(new Map(),320,300);
        assert.equal(previews.at(-1),null);assert.equal(record.node.hidden,true);
        layer.layout(new Map([['person:P001',{x:285,y:80}]]),320,300);record.node.emit('focus');
        assert.match(layer.tooltip.style.transform,/translate\(215px,/,'tooltip stays inside the right edge');
        layer.begin();layer.end();assert.equal(previews.at(-1),null);assert.equal(layer.records.size,0);
        layer.dispose();assert.equal(container.children.length,0);
    }finally{delete global.document;}
});
