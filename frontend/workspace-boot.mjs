// Reveal only the assembled cockpit; data loading continues inside that shell.
window.addEventListener('workspace-shell-ready',()=>{
 requestAnimationFrame(()=>document.documentElement.classList.remove('workspace-pending'));
},{once:true});
try{
 await import('./blackgold-workspace.mjs?v=46');
}catch(error){
 console.error('Workspace initialization failed',error);
 document.documentElement.classList.add('workspace-failed');
 const panel=document.createElement('div');panel.className='workspace-boot-error';panel.setAttribute('role','alert');
 const message=document.createElement('p');message.textContent='工作空间加载失败，请重新加载。';
 const retry=document.createElement('button');retry.textContent='重新加载';retry.onclick=()=>location.reload();
 panel.append(message,retry);document.body.append(panel);
}
