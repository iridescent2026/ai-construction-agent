// Live refreshes must preserve focus and the target of an in-progress click.
const lists=new WeakMap();
export function reconcileButtons(container,items,{key,label,select,className}){
 let list=lists.get(container);if(!list){list={nodes:new Map()};lists.set(container,list);}list.select=select;
 const active=new Set();
 items.forEach((item,index)=>{
  const id=key(item);active.add(id);let button=list.nodes.get(id);
  if(!button){button=container.ownerDocument.createElement('button');button.className=className;button.dataset.liveId=id;button.addEventListener('click',()=>list.select(id));list.nodes.set(id,button);}
  const value=label(item);if(button.textContent!==value)button.textContent=value;
  if(container.children[index]!==button)container.insertBefore(button,container.children[index]||null);
 });
 for(const [id,button] of list.nodes)if(!active.has(id)){button.remove();list.nodes.delete(id);}
 for(const node of [...container.childNodes])if(node.nodeType!==1)node.remove();
}
export function reconcileOrderList(container,orders,names,onSelect){
 reconcileButtons(container,orders,{key:o=>o.id,label:o=>`${o.id} · ${o.entityId} · ${names[o.status]}`,select:onSelect,className:'order-item'});
}
