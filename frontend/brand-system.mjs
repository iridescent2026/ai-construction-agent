export function brandImage(){const img=new Image();img.src='assets/brand-eye.svg?v=35';img.alt='工安智瞳 · 原版机械字标识';img.className='ws-brand-image';img.width=760;img.height=190;return img;}
function apply(){for(const link of document.querySelectorAll('.blackgold-workspace .brand-lockup')){link.replaceChildren(brandImage());link.setAttribute('aria-label','工安智瞳首页');}document.querySelectorAll('.login-stage>.brand-overlay,.home-stage>.brand-overlay').forEach(n=>n.remove());}

apply();window.addEventListener('workspace-brand-ready',apply);
