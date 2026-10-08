let nextTooltipId=0;

// Reuse marker buttons so live observations do not interrupt hover or keyboard focus.
export class SceneMarkers {
    constructor(container,onSelect,onPreview=()=>{}) {
        this.onSelect=onSelect;this.onPreview=onPreview;this.records=new Map();this.active=null;
        this.layer=document.createElement('div');this.layer.className='scene-labels';container.appendChild(this.layer);
        this.tooltip=document.createElement('div');this.tooltip.className='scene-marker-tooltip';this.tooltip.id=`scene-marker-tooltip-${++nextTooltipId}`;
        this.tooltip.setAttribute('role','tooltip');this.tooltip.hidden=true;this.layer.appendChild(this.tooltip);
    }
    begin(){this.seen=new Set();}
    set(id,text,info,color) {
        this.seen.add(id);let record=this.records.get(id);
        if(!record){
            const node=document.createElement('button');node.type='button';
            const glyph=document.createElement('span');glyph.className='marker-glyph';glyph.setAttribute('aria-hidden','true');node.appendChild(glyph);
            record={id,node,pointer:false,focused:false};this.records.set(id,record);this.layer.appendChild(node);
            node.addEventListener('pointerenter',e=>{if(e.pointerType==='touch')return;record.pointer=true;this.preview(record);});
            node.addEventListener('pointerleave',()=>{record.pointer=false;if(!record.focused&&this.active===record)this.clearPreview();});
            node.addEventListener('focus',()=>{record.focused=true;this.preview(record);});
            node.addEventListener('blur',()=>{record.focused=false;if(!record.pointer&&this.active===record)this.clearPreview();});
            node.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();this.clearPreview();}});
            node.addEventListener('click',()=>this.onSelect(record.info));
        }
        record.text=text;record.info=info;
        record.node.className='model-label '+info.kind;
        record.node.style.setProperty('--label-color',color||'#bfd3d3');record.node.setAttribute('aria-label',`查看${text}`);
        return record;
    }
    end(){
        for(const [id,record] of this.records)if(!this.seen.has(id)){
            if(this.active===record)this.clearPreview();record.node.remove();this.records.delete(id);
        }
        if(this.active)this.preview(this.active);
    }
    preview(record){
        if(this.active!==record){this.active?.node.removeAttribute('aria-describedby');this.active?.node.classList.remove('previewing');}
        this.active=record;record.node.classList.add('previewing');record.node.setAttribute('aria-describedby',this.tooltip.id);
        this.tooltip.textContent=record.text;this.tooltip.hidden=false;this.onPreview(record.info);
        if(this.places)this.positionTooltip();
    }
    clearPreview(){
        if(!this.active)return;
        this.active.node.removeAttribute('aria-describedby');this.active.node.classList.remove('previewing');
        this.active=null;this.tooltip.hidden=true;this.onPreview(null);
    }
    layout(places,width,height){
        this.places=places;this.width=width;this.height=height;
        for(const record of this.records.values()){
            const p=places.get(record.id);record.node.hidden=!p;
            if(p)record.node.style.transform=`translate(${p.x}px,${p.y}px)`;
            else if(this.active===record)this.clearPreview();
        }
        this.positionTooltip();
    }
    positionTooltip(){
        if(!this.active)return;const p=this.places?.get(this.active.id);if(!p)return;
        const width=this.tooltip.offsetWidth,height=this.tooltip.offsetHeight;
        const x=Math.max(5,Math.min(this.width-width-5,p.x+11-width/2));
        const y=p.y-height-6>=5?p.y-height-6:Math.min(this.height-height-5,p.y+28);
        this.tooltip.style.transform=`translate(${x}px,${y}px)`;
    }
    dispose(){this.clearPreview();this.layer.remove();this.records.clear();}
}
