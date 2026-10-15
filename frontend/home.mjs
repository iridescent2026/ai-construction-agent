import {mountHomeAccount} from './home-account-modal.mjs?v=46';
import {factorySession,setFactorySession,factoryRequest} from './factory-client.mjs';
const $=id=>document.getElementById(id);
const roles={admin:'管理员',safety:'安全员',maintenance:'维修员',reviewer:'复核员',observer:'只读员',collector:'采集员'};
function toLogin(){location.replace('login.html?next=%2Fhome.html');}
function paint(user){const role=roles[user.role]||'项目成员';$('home-user-name').textContent=user.name||user.id;$('home-user-role').textContent=role+(user.department?' · '+user.department:'');$('home-account-label').textContent=role;$('home-account').setAttribute('aria-label','打开'+(user.name||role)+'的账号');if(role!=='安全员'){const label=document.createElement('span');label.className='account-role';label.textContent=role;$('home-account').append(label);}}
$('home-account').onclick=()=>{const open=$('home-account-menu').hidden;$('home-account-menu').hidden=!open;$('home-account').setAttribute('aria-expanded',String(open));};
document.addEventListener('click',e=>{if(!e.target.closest('.home-account,.account-menu')){$('home-account-menu').hidden=true;$('home-account').setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('home-account-menu').hidden=true;$('home-account').setAttribute('aria-expanded','false');$('home-account').focus();}});
$('home-logout').onclick=async()=>{const button=$('home-logout');button.disabled=true;try{await factoryRequest('/auth/logout',{});setFactorySession(null);toLogin();}catch(e){$('home-status').textContent=e.message;button.disabled=false;}};
if(!factorySession()?.token)toLogin();else{if(factorySession().user)paint(factorySession().user);try{const user=await factoryRequest('/auth/me');setFactorySession({...factorySession(),user});$('home-account').querySelectorAll('.account-role').forEach(n=>n.remove());paint(user);}catch(e){if(e.status===401||e.status===403)toLogin();else $('home-status').textContent='账号验证暂不可用：'+e.message;}}

mountHomeAccount();window.addEventListener('home-profile-updated',e=>{$('home-account').querySelectorAll('.account-role').forEach(n=>n.remove());paint(e.detail);});
