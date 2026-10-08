const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const UI=require('../frontend/ui-core.js');
const fixture=(id='D001',temperature=42)=>({device_id:id,device_type:'配电箱',location:[120.008,30.293],risk_level:temperature>=70?'高':'低',risk_score:temperature>=70?0.7:0.1,alert:temperature>=70?'严重：高温':'正常',temperature,load:20,leakage:0.1,status:'online',timestamp:new Date().toISOString(),source:'demo'});

test('freshness rejects old, missing and future observations',()=>{
    const now=Date.now();assert.equal(UI.fresh({timestamp:new Date(now-120001).toISOString()},now),false);
    assert.equal(UI.fresh({timestamp:new Date(now+1).toISOString()},now),false);
    assert.equal(UI.fresh({},now),false);assert.equal(UI.fresh({timestamp:new Date(now).toISOString()},now),true);
    assert.equal(UI.fresh({timestamp:new Date(now).toISOString().slice(0,-1)},now),false);
});
test('device status distinguishes attention, severe and unknown',()=>{
    assert.equal(UI.deviceState(fixture()).level,'低');
    assert.equal(UI.deviceState({...fixture(),alert:'关注：高温'}).label,'需关注');
    assert.equal(UI.deviceState({...fixture(),hard_alert:true}).level,'高');
    assert.equal(UI.deviceState({...fixture(),temperature:NaN}).level,'未知');
    assert.equal(UI.deviceState({...fixture(),status:'offline'}).level,'未知');
    assert.equal(UI.deviceState({...fixture(),alert:undefined}).level,'未知');
});
test('expired people never become safe markers',()=>{
    assert.equal(UI.personState({timestamp:'2000-01-01T00:00:00Z'},{risk_level:'低'}).level,'未知');
});
test('untrusted labels are escaped',()=>{
    assert.equal(UI.escape('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');
});
test('scene coordinates use east and north consistently',()=>{
    assert.deepEqual(UI.localPoint(120.008,30.293),[0,0]);
    const [east,north]=UI.localPoint(120.009,30.294);assert.ok(east>90 && east<100 && north>110 && north<112);
});

test('single response drives maps/cards; route response uses original request coordinates; disconnection clears markers',async()=>{
    const elements=new Map(),groups=[],calls=[];
    const node=id=>{
        if(!elements.has(id))elements.set(id,{value:id==='device-filter'?'all':'',innerHTML:'',textContent:'',hidden:false,
            classList:{toggle(){},add(){},remove(){}},setAttribute(){},getAttribute(){return '';},focus(){},
            addEventListener(type,handler){this[type]=handler;}});
        return elements.get(id);
    };
    const makeLayer=()=>({children:[],addTo(parent){if(parent.children)parent.children.push(this);return this;},
        on(){return this;},bindPopup(text){this.popup=text;return this;},bindTooltip(){return this;},
        clearLayers(){this.children=[];return this;},addData(){return this;},getBounds(){return {};}});
    let current={snapshot_id:'first-snapshot',devices:[fixture(),{...fixture('D002'),location:[120.009,30.294]}]};
    let offline=false,finishRoute;
    const context={console,Date,Map,Number,JSON,Promise,AbortSignal,encodeURIComponent,
        window:{SiteUI:UI,addEventListener(){}},document:{getElementById:node,querySelectorAll:()=>[]},setInterval(){},
        L:{map:()=>({setView(){return this;},fitBounds(){},invalidateSize(){},removeLayer(){}}),
            tileLayer:makeLayer,geoJSON:makeLayer,divIcon:v=>v,
            layerGroup:()=>{const g=makeLayer();groups.push(g);return g;},
            marker:(point)=>({...makeLayer(),point}),polyline:points=>({...makeLayer(),points}),control:{scale:makeLayer}},
        fetch:async(url,options={})=>{
            calls.push({url,options});
            if(url.endsWith('/devices') && offline)throw new Error('offline');
            if(url.includes('/chat?'))return new Promise(resolve=>{finishRoute=()=>resolve({ok:true,json:async()=>({success:true,answer:'完成',route_data:{route:['D001','D002','D001']}})});});
            let data=url.endsWith('/devices')?current:url.endsWith('/state')?{revision:1,people:[],results:[],heatmap:[]}:{features:[]};
            return {ok:true,json:async()=>data};
        }};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/app.js'),'utf8'),context);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(groups[1].children.length,2);
    vm.runInContext(`showDetail({title:'D001',text:'selected'});previewDetailFor({title:'P001',text:'hover'});`,context);
    assert.match(node('detail-content').innerHTML,/P001/);assert.equal(node('scene-detail').hidden,false);
    vm.runInContext('previewDetailFor(null)',context);assert.match(node('detail-content').innerHTML,/D001/);
    node('close-detail').click();assert.equal(node('scene-detail').hidden,true);
    vm.runInContext(`previewDetailFor({title:'<P002>',text:'<hover>'});previewDetailFor(null);`,context);
    assert.equal(node('scene-detail').hidden,true);assert.match(node('detail-content').innerHTML,/&lt;P002&gt;/);
    assert.match(node('device-list').innerHTML,/42℃/);
    assert.ok(groups[1].children.every(marker=>marker.popup.includes('42℃')));
    assert.ok(calls.every(c=>!c.options.method || c.options.method==='GET'));
    assert.ok(!calls.some(c=>c.url.includes('/devices.geojson')));
    node('query').value='规划巡检路线';node('route-start').value='D001';
    const pending=node('ask-form').submit({preventDefault(){}});
    await new Promise(resolve=>setImmediate(resolve));
    current={snapshot_id:'newer-snapshot',devices:[{...fixture(),location:[121,31]},fixture('D002')]};
    vm.runInContext(`acceptDevices(${JSON.stringify(current)})`,context);
    finishRoute();await pending;
    assert.deepEqual(JSON.parse(JSON.stringify(groups[2].children[0].points)),[[30.293,120.008],[30.294,120.009],[30.293,120.008]]);
    offline=true;await vm.runInContext('loadDevices()',context);
    assert.equal(groups[1].children.length,0);assert.equal(groups[2].children.length,0);
    assert.equal(node('route-start').innerHTML,'');
});
