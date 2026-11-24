
(function(){
'use strict';
const domain='klab.id.vn';
const $=id=>document.getElementById(id);
let current='', rules=[],busy=false;
function notice(text){$('status').textContent=text}
function randomName(){const bytes=new Uint8Array(5);crypto.getRandomValues(bytes);return 'mail'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}
function setCurrent(local){current=local+'@'+domain;$('generated').textContent=current}
async function request(path,options={}){
  const resp=await fetch('/api/mail/rules'+path,{credentials:'same-origin',cache:'no-store',...options});
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok)throw Error(data.error||'Máy chủ trả lỗi HTTP '+resp.status);
  return data;
}
async function copy(text){try{await navigator.clipboard.writeText(text);notice('Đã sao chép '+text)}catch{notice('Trình duyệt không thể sao chép tự động.')}}
function render(){
  const list=$('recent');list.textContent='';
  $('empty').hidden=rules.length>0;
  for(const rule of rules){
    const li=document.createElement('li');
    const code=document.createElement('code');code.textContent=rule.address;
    const buttons=document.createElement('div');buttons.className='mail-buttons';
    const copyButton=document.createElement('button');copyButton.type='button';copyButton.textContent='Sao chép';copyButton.addEventListener('click',()=>copy(rule.address));
    buttons.append(copyButton);
    if(rule.managed){
      const deleteButton=document.createElement('button');deleteButton.type='button';deleteButton.textContent='Xóa';
      deleteButton.addEventListener('click',async()=>{
        if(!confirm('Xóa rule '+rule.address+' trên Cloudflare? Catch-all đang bật có thể vẫn nhận mail đến địa chỉ này.'))return;
        deleteButton.disabled=true;
        try{await request('/'+encodeURIComponent(rule.id),{method:'DELETE'});notice('Đã xóa rule. Catch-all vẫn có thể nhận thư đến địa chỉ này.');await refresh()}
        catch(err){notice('Lỗi xóa: '+err.message);deleteButton.disabled=false}
      });
      buttons.append(deleteButton);
    }
    li.append(code,buttons);list.append(li);
  }
}
async function refresh(){
  try{const data=await request('');rules=data.rules||[];render();notice('Đã đồng bộ '+rules.length+' quy tắc email từ Cloudflare.')}
  catch(err){notice('Chưa đồng bộ được: '+err.message)}
}
async function create(){
  if(busy)return;
  const local=$('custom').value.trim().toLowerCase()||current.split('@')[0];
  if(!/^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$/.test(local)||local.includes('..')){notice('Tên không hợp lệ: chỉ dùng 3-40 ký tự a-z, 0-9, dấu chấm, gạch dưới, gạch ngang.');return}
  busy=true;$('apply').disabled=true;
  try{
    const data=await request('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({local})});
    setCurrent(local);await refresh();notice('Đã tạo thật trên Cloudflare: '+data.address)
  }catch(err){notice('Không tạo được: '+err.message)}
  finally{busy=false;$('apply').disabled=false}
}
$('apply').addEventListener('click',create);
$('random').addEventListener('click',()=>{setCurrent(randomName());$('custom').value='';notice('Đã tạo tên ngẫu nhiên. Nhấn Tạo trên Cloudflare để kích hoạt địa chỉ.')});
$('copy').addEventListener('click',()=>copy(current));
$('refresh').addEventListener('click',refresh);
$('custom').addEventListener('keydown',e=>{if(e.key==='Enter')create()});
setCurrent(randomName());refresh();
})();
