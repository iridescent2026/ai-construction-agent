const paths={
 cube:'m12 2 10 5v10l-10 5-10-5V7zM2 7l10 5 10-5M12 12v10M7 4.5l10 5',
 helmet:'M4 15v-3a8 8 0 0 1 16 0v3M9 4v8M15 4v8M2 15h20v3H2zM5 21h14',
 database:'M3 6c0-5 18-5 18 0S3 11 3 6v12c0 5 18 5 18 0V6M3 12c0 5 18 5 18 0',
 target:'M12 1v5M12 18v5M1 12h5M18 12h5M20 12a8 8 0 1 1-16 0 8 8 0 1 1 16 0M15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0',
 image:'M2 3h20v18H2zM3 19l6-7 5 5 3-3 5 6M18 8a2 2 0 1 1-4 0 2 2 0 1 1 4 0',
 impact:'M12 2a3 3 0 1 1 0 6 3 3 0 1 1 0-6M5 15a3 3 0 1 1 0 6 3 3 0 1 1 0-6M19 15a3 3 0 1 1 0 6 3 3 0 1 1 0-6M10 8l-4 6M14 8l4 6M9 18h6',
 plans:'M5 5h14v15H5zM8 3v4M16 3v4M5 10h14M8 13h3M14 13h2M8 16h3M14 16h2',
 replay:'M10 7l8 5-8 5zM22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0',
 orders:'M14 3a6 6 0 0 0-6 8L2 17a3 3 0 0 0 5 4l7-7a6 6 0 0 0 7-8l-4 4-3-3 4-4z',
 energy:'M3 21h18M5 20V12h3v8M11 20V5h3v15M17 20V9h3v11',
 ai:'M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM12 3v4M10 3h4M7 11v3M17 11v3M8 17h8M1 11v5M23 11v5',
 people:'M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0M3 22v-4a9 9 0 0 1 18 0v4',
 device:'M6 5h12v16H6zM9 9h6M9 13h6M9 17h2M12 2v3',
 layers:'m12 2 10 6-10 6L2 8zM2 12l10 6 10-6M2 16l10 6 10-6',
 locate:'M19 9c0 5-7 13-7 13S5 14 5 9a7 7 0 1 1 14 0M15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 walk:'M15 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0M8 21l3-7 3 3 1 5M10 14l2-7 3 4 4 1M12 7 8 9l-2 5',
 reset:'M20 7a9 9 0 1 0 1 9M20 2v6h-6',
 alert:'M12 2 23 21H1zM12 9v5M12 17v1',
 home:'m2 10 10-8 10 8M5 8v14h14V8M9 22v-8h6v8',
 map:'m2 5 7-3 6 3 7-3v17l-7 3-6-3-7 3zM9 2v17M15 5v17',
 expand:'M8 2H2v6M16 2h6v6M2 16v6h6M22 16v6h-6',
 collapse:'M8 2v6H2M16 2v6h6M2 16h6v6M22 16h-6v6'
};
export function icon(key){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','ws-vector-icon');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[key]||paths.device);svg.append(path);return svg;}
export function labelButton(host,key,title){host.replaceChildren(icon(key),Object.assign(document.createElement('span'),{textContent:title}));}
export function equipmentType(info){if(info.kind==='person')return '人员';const t=info.title||'';return /泵|水|换热|过滤|储气|气罐|空压|冷却/.test(t)?'流体与水处理':/电|柜|变压|UPS|PLC|控制|传感/.test(t)?'电气与控制':/机|机器人|输送|装配|焊接|压床/.test(t)?'机械与制造':'其他设备';}
export function thumbnail(info){const box=document.createElement('span');box.className='ws-equipment-thumbnail';box.setAttribute('aria-label',info.kind==='person'?'人员示意图':info.title+'设备示意图');const img=new Image();img.alt=info.title||info.id;img.loading='eager';img.src=info.kind==='person'?'assets/cockpit-worker.svg':/^[ABE]-\d{2}$/.test(info.id)?'assets/device-portraits/'+info.id+'.png?v=41':'assets/cockpit-excavator.svg';img.onerror=()=>{img.onerror=null;img.src='assets/cockpit-excavator.svg';};box.append(img);return box;}
