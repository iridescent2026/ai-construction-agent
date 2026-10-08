// Both pages run the same renderer, asset catalogue and observation subscription.
export class SiteScene{
    constructor(container){
        this.container=container;this.frame=document.createElement('iframe');
        this.frame.src='factory.html?embed=1';this.frame.title='与首页同步的工厂数字孪生全景';
        Object.assign(this.frame.style,{width:'100%',height:'100%',border:'0',display:'block'});
        container.replaceChildren(this.frame);this.markers={clearPreview:()=>this.send({action:'clear'})};
        this.load=()=>this.update(this.state);this.frame.addEventListener('load',this.load);
        this.message=e=>{if(e.origin===location.origin&&e.source===this.frame.contentWindow&&e.data?.type==='factory-frame-ready')this.update(this.state);};window.addEventListener('message',this.message);
    }
    send(data){this.frame.contentWindow?.postMessage({type:'factory-gis',...data},location.origin);}
    update(state){this.state=state;if(state){this.send({action:'layers',visibility:state.visibility});this.send({action:'state',data:state.factoryData||null});this.send({action:'route',points:state.visibility.route===false?[]:state.route,origin:state.factoryData?.coordinateSystem.origin});}}
    focus(lng,lat){const all=[...(this.state?.devices||[]).map(d=>({id:d.device_id,lng:d.location[0],lat:d.location[1]})),...(this.state?.spatial?.people||[]).map(p=>({id:p.person_id,lng:p.lng,lat:p.lat}))];const info=all.find(e=>Math.abs(e.lng-lng)<1e-8&&Math.abs(e.lat-lat)<1e-8);if(info)this.send({action:'locate',id:info.id});}
    reset(){this.send({action:'reset'});}
    resize(){}
    setVisible(visible){this.send({action:'visible',visible});}
    dispose(){this.frame.removeEventListener('load',this.load);window.removeEventListener('message',this.message);this.frame.remove();}
}
