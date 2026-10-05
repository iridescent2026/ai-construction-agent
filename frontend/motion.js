// Synthetic sensor demonstration. No camera stream or GPS permission is accessed.
(()=>{
 const start=document.getElementById('motion-start'),stop=document.getElementById('motion-stop'),mode=document.getElementById('motion-mode'),text=document.getElementById('motion-status'),canvas=document.getElementById('camera-preview');
 const ctx=canvas.getContext('2d');let timer=null,step=0,running=false,busy=false,generation=0;
 function paint(people=[]){
  ctx.fillStyle='#0b1721';ctx.fillRect(0,0,640,250);
  ctx.strokeStyle='#27434c';for(let x=0;x<640;x+=40){ctx.beginPath();ctx.moveTo(320,40);ctx.lineTo(x,250);ctx.stroke();}
  for(let y=70;y<250;y+=30){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(640,y);ctx.stroke();}
  ctx.fillStyle='#314a57';ctx.fillRect(25,50,150,75);ctx.fillRect(450,30,150,100);
  ctx.fillStyle='#f7bd50';ctx.font='15px sans-serif';ctx.fillText('SIMULATED CAMERA · 非真实视频 / 非 AI 检测',15,22);
  for(const p of people){
   const x=320+(p.lng-120.008)*140000,y=145-(p.lat-30.293)*35000;
   ctx.fillStyle='#ecb342';ctx.beginPath();ctx.arc(x,y-24,7,0,Math.PI*2);ctx.fill();ctx.fillStyle='#4ccfc4';ctx.fillRect(x-7,y-16,14,22);
   ctx.strokeStyle='#4ccfc4';ctx.strokeRect(x-19,y-40,38,60);ctx.fillStyle='#d7f5ef';ctx.font='12px monospace';ctx.fillText(p.person_id,x-36,y-46);
  }
 }
 async function tick(){
  if(!running||busy)return;busy=true;const current=generation,source=mode.value;
  try{
   const result=await request(`${API_BASE}/simulation/motion`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:source,step:step++})});
   if(!running||current!==generation)return;
   state.spatial=result.state;renderSpatial();status('gis-status',`空间已连接 · 版本 ${state.spatial.revision}`,true);
   const people=result.state.people.filter(p=>p.source===`simulation_${source}`);
   if(source==='camera')paint(people);
   text.textContent=`${source==='phone'?'模拟手机定位':'模拟摄像头坐标'} · 已上报 ${step} 帧 · ${people.length} 人 · ${new Date().toLocaleTimeString()}`;
  }catch(error){if(current!==generation)return;running=false;clearInterval(timer);text.textContent=`演示停止：${error.message}`;start.disabled=false;stop.disabled=true;mode.disabled=false;}
  finally{busy=false;}
 }
 start.addEventListener('click',()=>{generation++;running=true;start.disabled=true;stop.disabled=false;mode.disabled=true;canvas.hidden=mode.value!=='camera';text.textContent='正在启动模拟上报…';tick();timer=setInterval(tick,1000);});
 stop.addEventListener('click',()=>{generation++;running=false;clearInterval(timer);start.disabled=false;stop.disabled=true;mode.disabled=false;text.textContent='已停止后续采样；在途请求可能完成。最后位置 120 秒后变为未知。';});
 mode.addEventListener('change',()=>{canvas.hidden=mode.value!=='camera';paint();});
 window.addEventListener('pagehide',()=>{running=false;clearInterval(timer);});paint();
})();
