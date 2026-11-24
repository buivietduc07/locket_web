'use strict';
const $=id=>document.getElementById(id);
const defaults={
  2:[[76,64,928,454],[76,540,928,466]],
  3:[[64,54,952,310],[64,385,952,310],[64,716,952,310]],
  4:[[54,54,475,475],[551,54,475,475],[54,551,475,475],[551,551,475,475]]
};
let frames=[],editing='',slots=[],picture=null,objectURL='',drag=null,revision=0;
const canvas=$('preview'),ctx=canvas.getContext('2d');
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
async function request(url,options={}){
  const response=await fetch(url,{...options,cache:'no-store',credentials:'same-origin',headers:{...options.headers}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'HTTP '+response.status);
  return data;
}
function release(){if(objectURL){URL.revokeObjectURL(objectURL);objectURL='';}}
function setPicture(src){
  const token=++revision;
  picture=null;draw();
  if(!src)return;
  const img=new Image();
  img.onload=()=>{if(token===revision){picture=img;draw();}};
  img.onerror=()=>{if(token===revision)status('Không đọc được ảnh khung.',true);};
  img.src=src;
}
function resetSlots(){
  slots=defaults[Number($('frameCount').value)].map(p=>p.map(v=>v/1080));
  renderFields();draw();
}
function draw(){
  const w=canvas.width,h=canvas.height;
  ctx.fillStyle='#d8d5ce';ctx.fillRect(0,0,w,h);
  if(picture)ctx.drawImage(picture,0,0,w,h);
  slots.forEach((p,i)=>{
    const [x,y,a,b]=[p[0]*w,p[1]*h,p[2]*w,p[3]*h];
    ctx.fillStyle='rgba(37,112,195,.24)';ctx.fillRect(x,y,a,b);
    ctx.strokeStyle='#286eb5';ctx.lineWidth=2;ctx.strokeRect(x,y,a,b);
    ctx.fillStyle='#286eb5';ctx.fillRect(x+3,y+3,27,25);
    ctx.fillStyle='#fff';ctx.font='bold 16px system-ui';ctx.fillText(String(i+1),x+11,y+21);
    ctx.fillStyle='#fff';ctx.fillRect(x+a-10,y+b-10,10,10);
    ctx.strokeStyle='#286eb5';ctx.strokeRect(x+a-10,y+b-10,10,10);
  });
}
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
function constrain(p){
  p[0]=clamp(p[0],0,.97);p[1]=clamp(p[1],0,.97);
  p[2]=clamp(p[2],.03,1-p[0]);p[3]=clamp(p[3],.03,1-p[1]);
}
function updateFields(){
  $('slotFields').querySelectorAll('input').forEach(el=>{el.value=(slots[Number(el.dataset.i)][Number(el.dataset.j)]*100).toFixed(1);});
}
function renderFields(){
  const box=$('slotFields');box.replaceChildren();
  slots.forEach((p,i)=>{
    const row=document.createElement('section');row.className='slot-row';
    const title=document.createElement('strong');title.textContent='Ảnh '+(i+1)+' (%)';
    const grid=document.createElement('div');grid.className='slot-grid';
    ['Trái','Trên','Rộng','Cao'].forEach((label,j)=>{
      const wrap=document.createElement('label');wrap.textContent=label;
      const input=document.createElement('input');input.type='number';input.min='0';input.max='100';input.step='0.1';input.required=true;input.dataset.i=i;input.dataset.j=j;
      input.value=(p[j]*100).toFixed(1);
      input.onchange=()=>{const val=Number(input.value);if(Number.isFinite(val)){p[j]=val/100;constrain(p);}updateFields();draw();};
      wrap.append(input);grid.append(wrap);
    });row.append(title,grid);box.append(row);
  });
}
function position(event){const r=canvas.getBoundingClientRect();return [(event.clientX-r.left)/r.width,(event.clientY-r.top)/r.height];}
canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  const [x,y]=position(event);
  for(let i=slots.length-1;i>=0;i--){
    const p=slots[i],edge=Math.abs(x-p[0]-p[2])<.04&&Math.abs(y-p[1]-p[3])<.04;
    if(edge||(x>=p[0]&&x<=p[0]+p[2]&&y>=p[1]&&y<=p[1]+p[3])){
      drag={i,x,y,p:p.slice(),edge};canvas.setPointerCapture(event.pointerId);event.preventDefault();return;
    }
  }
});
canvas.addEventListener('pointermove',event=>{
  if(!drag)return;
  const [x,y]=position(event),dx=x-drag.x,dy=y-drag.y,p=drag.p.slice();
  if(drag.edge){p[2]=clamp(p[2]+dx,.03,1-p[0]);p[3]=clamp(p[3]+dy,.03,1-p[1]);}
  else{p[0]=clamp(p[0]+dx,0,1-p[2]);p[1]=clamp(p[1]+dy,0,1-p[3]);}
  slots[drag.i]=p;updateFields();draw();
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{drag=null;});
function newFrame(){
  editing='';release();$('editor').reset();$('editorTitle').textContent='Thêm khung mới';setPicture('');resetSlots();
}
function editFrame(frame){
  editing=frame.id;release();$('editor').reset();
  $('frameName').value=frame.name;$('frameCount').value=String(frame.count);$('frameMode').value=frame.mode;
  slots=frame.slots.map(p=>p.slice());renderFields();
  $('editorTitle').textContent='Sửa khung: '+frame.name;setPicture(frame.url+'?v='+frame.updated);
  $('editorTitle').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderList(){
  const list=$('frameList');list.replaceChildren();
  if(!frames.length){const p=document.createElement('p');p.textContent='Chưa có khung tải lên.';list.append(p);return;}
  for(const f of frames){
    const card=document.createElement('article');card.className='frame-card';
    const img=document.createElement('img');img.alt=f.name;img.loading='lazy';img.src=f.url+'?v='+f.updated;
    const name=document.createElement('strong');name.textContent=f.name+' · '+f.count+' ảnh';
    const actions=document.createElement('div');
    const edit=document.createElement('button');edit.type='button';edit.textContent='Sửa';edit.onclick=()=>editFrame(f);
    const del=document.createElement('button');del.type='button';del.textContent='Xóa';del.className='danger';
    del.onclick=async()=>{if(!confirm('Xóa khung '+f.name+'?'))return;del.disabled=true;try{await request('/api/booth/admin/'+f.id,{method:'DELETE'});if(editing===f.id)newFrame();await refresh();status('Đã xóa khung.');}catch(err){status(err.message,true);}finally{del.disabled=false;}};
    actions.append(edit,del);card.append(img,name,actions);list.append(card);
  }
}
async function refresh(){frames=(await request('/api/booth/admin')).frames||[];renderList();}
async function checkAccess(){
  const btn=$('checkAccess');btn.disabled=true;
  try{await refresh();$('loginPanel').hidden=true;$('workspace').hidden=false;newFrame();status('Đã xác minh quyền quản trị.');}
  catch(err){$('workspace').hidden=true;$('loginPanel').hidden=false;status(err.message,true);}finally{btn.disabled=false;}
}
$('checkAccess').onclick=checkAccess;
$('logout').onclick=()=>{location.href='/';};
checkAccess();
$('frameCount').onchange=resetSlots;$('resetSlots').onclick=resetSlots;$('newFrame').onclick=newFrame;
$('frameFile').onchange=()=>{
  const file=$('frameFile').files[0];if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024){$('frameFile').value='';status('Chỉ nhận PNG, JPG, WebP tối đa 2 MB.',true);return;}
  if(file.type==='image/jpeg')$('frameMode').value='background';
  release();objectURL=URL.createObjectURL(file);setPicture(objectURL);
};
$('editor').onsubmit=async e=>{
  e.preventDefault();
  const file=$('frameFile').files[0];
  if(!editing&&!file){status('Hãy chọn ảnh khung.',true);return;}
  const form=new FormData();
  form.append('name',$('frameName').value.trim());form.append('count',$('frameCount').value);form.append('mode',$('frameMode').value);
  form.append('slots',JSON.stringify(slots));if(editing)form.append('id',editing);if(file)form.append('image',file);
  $('saveFrame').disabled=true;
  try{await request('/api/booth/admin',{method:'POST',body:form});await refresh();newFrame();status('Đã lưu. Khung mới sẽ xuất hiện khi mở menu Photobooth.');}
  catch(err){status(err.message,true);}finally{$('saveFrame').disabled=false;}
};
newFrame();
