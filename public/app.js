'use strict';
const $ = s => document.querySelector(s);
const view = $('#view');
const state={token:'',tab:'feed',friends:[],profile:null,activeFriend:null,conversation:null,stream:null,recorder:null,chunks:[],recordedFile:null,file:null,mediaPreview:null};
let toastTimer;
function toast(message,isError=false){const t=$('#toast');t.textContent=String(message);t.classList.toggle('error',isError);t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),3500)}
function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function field(o,...keys){if(!o||typeof o!=='object')return '';for(const k of keys){if(o[k]!==undefined&&o[k]!==null&&o[k]!=='')return o[k]}return ''}
function deep(o,keys,limit=0){if(limit>3||!o||typeof o!=='object')return '';const val=field(o,...keys);if(val)return val;for(const [k,v] of Object.entries(o)){if(['members','messages','recipients','friends','moments'].includes(k))continue;if(v&&typeof v==='object'&&!Array.isArray(v)){const x=deep(v,keys,limit+1);if(x)return x}}return ''}
function arr(v,keys=[]){if(Array.isArray(v))return v;if(v&&typeof v==='object'){for(const k of keys){if(Array.isArray(v[k]))return v[k]}}return []}
function displayName(item){return String(deep(item,['display_name','displayName','name','full_name','fullName','first_name','username','peer_name','peerName'])||'Bạn bè')}
function username(item){return String(deep(item,['username'])||'').replace(/^@/,'')}
function uid(item){return String(deep(item,['peer_uid','peerUid','user_id','userId','uid','id','other_user_id','otherUserId'])||'')}
function urlOf(v){if(typeof v!=='string')return '';try{const u=new URL(v);return u.protocol==='https:'?u.href:''}catch{return ''}}
function media(item,video=false){const names=video?['video_url','videoUrl','video','video_download_url']:['image_url','imageUrl','thumbnail_url','thumbnailUrl','photo_url','photoUrl','media_url','mediaUrl','url'];const v=deep(item,names);return urlOf(typeof v==='string'?v:'')}
function avatar(item){const url=urlOf(deep(item,['avatar_url','avatarUrl','profile_picture_url','profilePictureUrl','profile_image_url','profileImageUrl']));const letter=displayName(item).slice(0,1).toUpperCase();return `<div class="avatar">${url?`<img src="${esc(url)}" alt="">`:esc(letter)}</div>`}
function date(v){if(!v)return '';let n=typeof v==='number'&&v<1e11?v*1000:v;const d=new Date(n);return Number.isNaN(d.getTime())?'':d.toLocaleString('vi-VN')}
function caption(item){const c=deep(item,['caption','text','note','message']);return typeof c==='string'?c:''}
function loading(){view.innerHTML='<div class="empty">Đang tải dữ liệu...</div>'}
function empty(s){view.innerHTML=`<div class="empty">${esc(s)}</div>`}
async function api(url,options={}){const response=await fetch(url,{...options,credentials:'same-origin',headers:{...(options.headers||{})}});const str=await response.text();let body;try{body=JSON.parse(str)}catch{throw Error(`HTTP ${response.status}: phản hồi không phải JSON`)}if(!response.ok)throw Error(body.error||`HTTP ${response.status}`);return body}
async function refresh(){await openTab(state.tab)}
function stopCamera(){clearRecordTimer();if(state.recorder&&state.recorder.state==='recording'){state.recorder.onstop=null;state.recorder.stop()}state.recorder=null;if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null}}
async function openTab(tab){closeLiveChat();if(state.tab==='camera'&&tab!=='camera')stopCamera();state.tab=tab;state.activeFriend=null;state.conversation=null;document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));loading();try{if(tab==='feed')await showFeed();if(tab==='friends')await showFriends();if(tab==='camera')showCamera();if(tab==='chat')await showChats();if(tab==='profile')await showProfile()}catch(e){empty(e.message);toast(e.message,true)}}

function momentCard(m, isArchive = false) {
  const poster = media(m);
  const clip = media(m, true);

  const author = field(m, 'user', 'sender', 'creator', 'owner');
  const sourceUid = field(m, 'user_uid', 'author_uid', 'sender_uid', 'owner_uid');
  const authorId = String(
    sourceUid ||
    (typeof author === 'string' ? author : uid(author)) ||
    ''
  ).split('/').pop();

  const myUid = uid(state.profile);
  const friend = state.friends.find(f => uid(f) === authorId);
  const isMine = Boolean(authorId && myUid && authorId === myUid);
  const authorProfile = field(m, 'author_profile');
  const person = isMine
    ? state.profile
    : friend || (authorProfile && typeof authorProfile === 'object' ? authorProfile : null) ||
      (author && typeof author === 'object' ? author : null) ||
      (isArchive ? state.profile : null);

  const name = person ? displayName(person) : 'Chưa xác định người đăng';
  const user = person ? username(person) : '';

  const time = date(
    deep(m, ['created_at', 'createdAt', 'date', 'timestamp'])
  );

  const momentId = String(
    field(m, 'moment_uid', 'canonical_uid', 'id') || ''
  );

  return `
    <article class="moment">
      <div class="moment-head">
        ${avatar(person || { name: name })}

        <div>
          <div class="name">${esc(name)}</div>
          <div class="sub">
            ${user ? '@' + esc(user) : esc(time || 'Đã chia sẻ')}
          </div>
        </div>
      </div>

      <div class="moment-media">
        ${
          clip
            ? `<video src="${esc(clip)}"
                 controls playsinline
                 preload="metadata"
                 poster="${esc(poster)}"></video>`
            : poster
              ? `<img src="${esc(poster)}"
                   alt="Ảnh Locket" loading="lazy">`
              : '<div class="moment-fallback">Không có ảnh</div>'
        }
      </div>

      ${
        caption(m)
          ? `<div class="moment-caption">${esc(caption(m))}</div>`
          : ''
      }

      ${
        isArchive && momentId
          ? `<div class="moment-view-section">
               <button class="viewers-btn"
                 type="button"
                 data-viewers="${esc(momentId)}">
                 Ai đã xem
               </button>
               <div class="viewers-result"></div>
             </div>`
          : ''
      }
    </article>
  `;
}


let feedCursor=null;
let feedItems=[];
let feedLoading=false;
let feedMode='all';

async function showMomentViewers(button) {
  const momentId = button.dataset.viewers;
  const result = button.parentElement.querySelector(
    '.viewers-result'
  );

  button.disabled = true;
  result.textContent = 'Đang tải lượt xem...';

  try {
    const data = await api(
      '/api/moment-views?id=' + encodeURIComponent(momentId)
    );

    const viewers = arr(data, [
      'moment_views',
      'viewers',
      'views'
    ]);

    const count = data.count ?? viewers.length;

    result.replaceChildren();

    const heading = document.createElement('strong');
    heading.textContent = `${count} lượt xem`;
    result.append(heading);

    if (!viewers.length) {
      const message = document.createElement('p');
      message.textContent =
        'Chưa có danh sách người xem từ Locket.';
      result.append(message);
      return;
    }

    for (const viewer of viewers) {
      const viewerId = String(
        typeof viewer === 'string'
          ? viewer
          : field(
              viewer,
              'user',
              'user_uid',
              'viewer_uid',
              'uid',
              'sender'
            ) || ''
      );

      const friend = state.friends.find(
        f => uid(f) === viewerId
      );

      const row = document.createElement('div');
      row.className = 'viewer-row';

      const name = friend
        ? displayName(friend)
        : viewerId || 'Người xem chưa xác định';

      row.textContent = name;
      result.append(row);
    }

  } catch (error) {
    result.textContent = 'Lỗi: ' + error.message;
  } finally {
    button.disabled = false;
  }
}

function drawFeed(){
  if(state.tab!=='feed')return;
  const archive=feedMode==='archive';
  view.innerHTML=`<h2 class="page-title">${archive?'Kho lưu trữ':'Khoảnh khắc'}</h2>
    <p class="intro">${archive?'Những khoảnh khắc bạn đã đăng và thư viện có thể truy xuất.':'Ảnh và video bạn bè đã chia sẻ, bao gồm lịch sử được phép xem.'}</p>
    <div class="feed-switch">
      <button class="feed-switch-btn ${!archive?'selected':''}" type="button" data-feed-mode="all">Bảng tin</button>
      <button class="feed-switch-btn ${archive?'selected':''}" type="button" data-feed-mode="archive">Kho lưu trữ</button>
    </div>
    <div class="stack" id="feedMoments">${feedItems.length?feedItems.map(m => momentCard(m, archive)).join(''):'<div class="empty">Chưa có khoảnh khắc nào trong mục này.</div>'}</div>
    ${!archive&&feedCursor?'<button class="primary full feed-more" id="loadMoreMoments" type="button">Tải thêm khoảnh khắc</button>':''}`;
  view.querySelectorAll('[data-feed-mode]').forEach(b=>b.onclick=async()=>{
    if(feedMode===b.dataset.feedMode)return;
    feedMode=b.dataset.feedMode;
    await showFeed();
  });

  const more = $('#loadMoreMoments');

  if (more) {
    more.onclick = () => loadFeedMore();
  }

  // Bấm nút Ai đã xem
  view.querySelectorAll('[data-viewers]').forEach(button => {
    button.onclick = () => showMomentViewers(button);
  });
}


async function showFeed(){
  loading();
  feedCursor=null;
  feedItems=[];
  try{
    if(!state.friends.length){
      const list=await api('/api/friends').catch(()=>[]);
      state.friends=arr(list,['friends','users','items','data']);
    }
    if(feedMode==='archive'){
      const data=await api('/api/archive');
      feedItems=arr(data,['moments','items','data']);
    }else{
      const data=await api('/api/feed');
      feedItems=arr(data,['moments','items','data']);
      feedCursor=data.nextPageToken||null;
    }
    drawFeed();
  }catch(e){empty(e.message);toast(e.message,true)}
}

async function loadFeedMore(){
  if(feedLoading||!feedCursor||feedMode!=='all')return;
  feedLoading=true;
  const button=$('#loadMoreMoments');
  if(button){button.disabled=true;button.textContent='Đang tải thêm...';}
  try{
    const data=await api('/api/feed?cursor='+encodeURIComponent(feedCursor));
    const added=arr(data,['moments','items','data']);
    const seen=new Set(feedItems.map(x=>x.moment_uid||x.canonical_uid||x.id));
    for(const item of added){const id=item.moment_uid||item.canonical_uid||item.id;if(!id||!seen.has(id)){feedItems.push(item);if(id)seen.add(id);}}
    feedCursor=data.nextPageToken||null;
    drawFeed();
  }catch(e){toast(e.message,true);if(button){button.disabled=false;button.textContent='Tải thêm khoảnh khắc';}}
  finally{feedLoading=false;}
}
async function showFriends(){const data=await api('/api/friends');const friends=arr(data,['friends','users','items','data']);state.friends=friends;view.innerHTML=`<h2 class="page-title">Bạn bè</h2><p class="intro">Chọn một người để xem ảnh và video họ chia sẻ với bạn.</p><div class="stack" id="friendList">${friends.length?friends.map((f,i)=>`<button type="button" class="person" data-friend="${i}">${avatar(f)}<div class="person-text"><div class="name">${esc(displayName(f))}</div><div class="sub">${esc(username(f)?'@'+username(f):uid(f))}</div></div><span class="pill">Xem ảnh</span></button>`).join(''):'<div class="empty">Chưa lấy được danh sách bạn bè.</div>'}</div>`;view.querySelectorAll('[data-friend]').forEach(b=>b.addEventListener('click',()=>showFriendMoments(friends[Number(b.dataset.friend)])))}
async function showFriendMoments(friend) {
  state.activeFriend=friend;
  loading();
  const friendUid=uid(friend);
  if(!friendUid){empty('Không tìm được UID của người bạn này.');return;}
  const display=displayName(friend);
  const seen=new Set();
  let cursor=null;
  let loadingMore=false;

  function appendMoments(items) {
    const stack=$('#friendArchiveList');
    if(!stack)return;
    for(const m of items){
      const id=String(m.moment_uid||m.canonical_uid||m.id||'');
      if(id&&seen.has(id))continue;
      if(id)seen.add(id);
      const wrapper=document.createElement('div');
      wrapper.innerHTML=momentCard({...m,user_uid:friendUid});
      while(wrapper.firstChild) stack.appendChild(wrapper.firstChild);
    }
  }

  async function loadPage(firstPage=false) {
    if(loadingMore)return;
    loadingMore=true;
    const button=$('#moreFriendArchive');
    if(button){button.disabled=true;button.textContent='Đang tải...';}
    try{
      const params=new URLSearchParams({uid:friendUid});
      if(!firstPage&&cursor)params.set('cursor',cursor);
      const data=await api('/api/friend-moments?'+params);
      if(state.activeFriend!==friend)return;
      appendMoments(arr(data,['moments','items','data']));
      cursor=data.nextPageToken||null;
      const stack=$('#friendArchiveList');
      if(firstPage&&stack&&!stack.children.length)
        stack.innerHTML='<div class="empty">Không có khoảnh khắc được chia sẻ trong lưu trữ.</div>';
      if(button){button.hidden=!cursor;button.textContent='Xem bài cũ hơn';}
    }catch(err){
      toast('Không tải được lưu trữ: '+err.message,true);
      if(firstPage)empty(err.message);
      else if(button)button.textContent='Thử tải lại';
    }finally{loadingMore=false;if(button)button.disabled=false;}
  }

  view.innerHTML=`<div class="section-row">
    <button type="button" id="backFriends" class="back">Bạn bè</button>
    <div class="name">${esc(display)}</div>
  </div>
  <div class="stack" id="friendArchiveList"></div>
  <button type="button" class="primary full" id="moreFriendArchive" hidden>Xem bài cũ hơn</button>`;
  $('#backFriends').onclick=showFriends;
  $('#moreFriendArchive').onclick=()=>loadPage();
  await loadPage(true);
}

async function showProfile() {
  const p = await api('/api/profile');
  state.profile = p;

  const name = displayName(p);
  const user = username(p);

  $('#accountLabel').textContent = user ? '@' + user : name;

  view.innerHTML = `
    <h2 class="page-title">Cá nhân</h2>

    <div class="profile-panel">
      <div class="profile-top">
        ${avatar(p)}

        <div>
          <div class="name">${esc(name)}</div>
          <div class="sub">
            ${esc(user ? '@' + user : 'Tài khoản Locket')}
          </div>
        </div>
      </div>

      <div style="margin-top:18px">
        <div class="kv">
          <span>UID</span>
          <strong>${esc(uid(p) || 'Không có')}</strong>
        </div>

        <div class="kv">
          <span>Giới thiệu</span>
          <strong>
            ${esc(deep(p, ['bio', 'description']) || 'Chưa cập nhật')}
          </strong>
        </div>
      </div>
    </div>

    <button
      id="logoutBtn"
      class="logout-btn"
      type="button"
    >
      Đăng xuất
    </button>
  `;

  $('#logoutBtn').onclick = async () => {
    const confirmed = confirm(
      'Bạn có chắc chắn muốn đăng xuất tài khoản Locket?'
    );

    if (!confirmed) return;

    const button = $('#logoutBtn');
    button.disabled = true;
    button.textContent = 'Đang đăng xuất...';

    try {
      await api('/api/logout', {
        method: 'POST'
      });

      stopCamera();
      state.profile = null;
      state.friends = [];
      state.token = '';

      window.location.reload();

    } catch (err) {
      toast('Đăng xuất thất bại: ' + err.message, true);

      button.disabled = false;
      button.textContent = 'Đăng xuất';
    }
  };
}

function chatPeer(c){return uid(c)}

function chatTimestamp(chat) {
  const latest = field(
    chat,
    'latest_message',
    'latestMessage',
    'last_message',
    'lastMessage'
  );

  const value = deep(latest, [
    'created_at',
    'createdAt',
    'timestamp',
    'sent_at',
    'sentAt',
    'date'
  ]) || deep(chat, [
    'last_message_at',
    'lastMessageAt',
    'updated_at',
    'updatedAt',
    'timestamp'
  ]);

  if (!value) return 0;

  if (typeof value === 'object') {
    return Number(value._seconds || value.seconds || 0) * 1000;
  }

  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const n = Number(value);
    return n < 1e11 ? n * 1000 : n;
  }

  return Date.parse(value) || 0;
}

async function showChats(){closeLiveChat();
  if (!state.friends.length) {
    const friendData = await api('/api/friends').catch(() => []);
    state.friends = arr(friendData, [
      'friends', 'users', 'items', 'data'
    ]);
  }

  const data = await api('/api/chats');const chats = [...arr(data, [
  'conversations',
  'items',
  'data'
])].sort((a, b) => chatTimestamp(b) - chatTimestamp(a));view.innerHTML=`<h2 class="page-title">Tin nhắn</h2><p class="intro">Mở hội thoại để đọc và nhắn tin cho bạn bè.</p><div class="stack">${chats.length?chats.map((c,i)=>{const recent=field(c,'latest_message','latestMessage','last_message','lastMessage');let preview=typeof recent==='string'?recent:caption(recent);return `<button type="button" class="conversation" data-chat="${i}">${chatAvatar(c)}<div class="conversation-text"><div class="name">${esc(chatDisplayName(c))}</div><div class="sub">${esc(preview||chatPeer(c)||'Hội thoại')}</div></div>${Number(field(c,'unread_count','unreadCount'))>0?`<span class="pill">${esc(field(c,'unread_count','unreadCount'))}</span>`:''}</button>`}).join(''):'<div class="empty">Chưa có cuộc trò chuyện.</div>'}</div>`;view.querySelectorAll('[data-chat]').forEach(b=>b.onclick=()=>showMessages(chats[Number(b.dataset.chat)]))}

let activeChatStop = null;
function closeLiveChat(){
  if(activeChatStop){activeChatStop();activeChatStop=null;}
}
function messageItems(result){return arr(result,['messages','items','data','documents'])}
async function showMessages(chat){
  closeLiveChat();
  state.conversation=chat;
  const other=chatPeer(chat);
  if(!other){toast('Không tìm thấy người nhận.',true);return;}
  const myUid=uid(state.profile);
  const name=chatDisplayName(chat);
  const localKey='locket:hidden-messages:'+myUid+':'+other;
  let hiddenIds=[];
  try{hiddenIds=JSON.parse(localStorage.getItem(localKey)||'[]');if(!Array.isArray(hiddenIds))hiddenIds=[];}catch{hiddenIds=[];}
  const hidden=new Set(hiddenIds);
  let alive=true, busy=false, lastSignature='', firstLoad=true, typingAt=0, typingBusy=false;
  const stop=()=>{alive=false;clearInterval(timer);};
  activeChatStop=stop;
  loading();
  view.innerHTML='<div class="section-row"><button class="back" id="backChats" type="button">Tin nhắn</button><div class="name">'+esc(name)+'</div><button class="secondary" id="reloadMessages" type="button">Tải lại</button></div>'+
    '<div class="messages" id="messages"></div>'+
    '<div id="typingIndicator" class="typing-indicator" hidden>Đang soạn tin nhắn <span class="typing-dots"><i></i><i></i><i></i></span></div>'+
    '<form id="sendForm" class="chat-compose"><label class="chat-photo-select" title="Gửi ảnh" aria-label="Chọn ảnh">Ảnh<input id="chatPhotoInput" type="file" accept="image/jpeg,image/png,image/webp" hidden></label><input name="message" maxlength="4000" autocomplete="off" required placeholder="Nhập tin nhắn..."><button class="primary" type="submit">Gửi</button></form>'+
    '<div class="chat-action-overlay" id="chatActionOverlay" hidden><div class="chat-action-menu" id="chatActionMenu"><div class="chat-action-title">Tùy chọn tin nhắn</div><button type="button" id="deleteForMe">Thu hồi về phía tôi</button><button type="button" id="deleteForEveryone">Thu hồi tất cả</button><button type="button" id="cancelChatAction">Hủy</button></div></div>';
  const root=$('#messages'), form=$('#sendForm'), overlay=$('#chatActionOverlay');
  let selected=null, pressTimer=null, pressStartX=0,pressStartY=0;

  const closeMenu=()=>{overlay.hidden=true;selected=null;clearTimeout(pressTimer);};
  function showMenu(m,id,isMine){
    selected={message:m,id,isMine};
    $('#deleteForEveryone').hidden=!isMine||!id||!String(m.conversation_id||m.conversationId||chat.conversation_id||chat.conversationId||'');
    overlay.hidden=false;
  }
  $('#cancelChatAction').onclick=closeMenu;
  overlay.addEventListener('click',e=>{if(e.target===overlay)closeMenu();});
  $('#deleteForMe').onclick=async()=>{
    if(!selected)return;
    if(selected.id)hidden.add(selected.id);
    else hidden.add('fallback:'+String(selected.message.timestamp||'')+':'+String(selected.message.text||''));
    try{localStorage.setItem(localKey,JSON.stringify([...hidden].slice(-1500)));}catch{}
    closeMenu();
    lastSignature='';
    await refreshMessages(true);
  };
  $('#deleteForEveryone').onclick=async()=>{
    if(!selected||!selected.isMine)return;
    const msgId=selected.id,convId=String(selected.message.conversation_id||selected.message.conversationId||chat.conversation_id||chat.conversationId||'');
    if(!msgId||!convId)return toast('Không có ID để thu hồi.',true);
    closeMenu();
    try{
      await api('/api/message/recall',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationUid:convId,messageUid:msgId})});
      toast('Đã gửi yêu cầu thu hồi với mọi người.');
      lastSignature='';
      await refreshMessages(true);
    }catch(error){toast('Thu hồi thất bại: '+error.message,true);}
  };
  const chatIsActive=()=>alive && state.conversation===chat && state.tab==='chat' && root.isConnected;
  function buildMessage(m,index){
    const sender=String(deep(m,['sender_uid','senderUid','sender_id','senderId','from_uid','fromUid'])||'');
    const isMine=Boolean(sender&&myUid&&sender===myUid);
    const text=String(caption(m)||deep(m,['content','body'])||'');
    const id=String(field(m,'message_id','messageId')||'');
    const fallback='fallback:'+String(m.timestamp||'')+':'+String(m.text||'');
    if(hidden.has(id)||hidden.has(fallback))return null;
    const el=document.createElement('div');
    el.className='message-item'+(isMine?' mine':'');
    const bubble=document.createElement('div');
    bubble.className='bubble'+(isMine?' mine':'');
    const photo=urlOf(String(m.image_url||''));
    if(photo){
      const img=document.createElement('img');
      img.className='chat-photo';
      img.src=photo;
      img.alt='Ảnh trong tin nhắn Locket';
      img.loading='lazy';
      img.onerror=()=>{img.replaceWith(document.createTextNode('Không tải được ảnh.'));};
      bubble.append(img);
      if(m.image_caption) {
        const description=document.createElement('div');
        description.textContent=m.image_caption;
        bubble.append(description);
      }
    }else if(m.moment_uid) {
      bubble.textContent='Ảnh Locket đã được chia sẻ';
    } else {
      if(!text.trim() || /^[\u200b\u200c\u200d\ufeff\s]*$/.test(text))return null;
      bubble.textContent=text;
    }
    bubble.setAttribute('role','button');
    bubble.setAttribute('tabindex','0');
    bubble.setAttribute('aria-label','Nhấn giữ để xem tùy chọn tin nhắn');
    bubble.oncontextmenu=e=>{e.preventDefault();showMenu(m,id,isMine);};
    bubble.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showMenu(m,id,isMine);}};
    bubble.addEventListener('pointerdown',e=>{
      if(e.pointerType==='mouse'&&e.button!==0)return;
      pressStartX=e.clientX;pressStartY=e.clientY;
      clearTimeout(pressTimer);
      pressTimer=setTimeout(()=>{pressTimer=null;if(navigator.vibrate)navigator.vibrate(18);showMenu(m,id,isMine);},500);
    });
    bubble.addEventListener('pointermove',e=>{
      if(Math.abs(e.clientX-pressStartX)>12||Math.abs(e.clientY-pressStartY)>12){clearTimeout(pressTimer);pressTimer=null;}
    });
    for(const type of ['pointerup','pointercancel','pointerleave'])bubble.addEventListener(type,()=>{clearTimeout(pressTimer);pressTimer=null;});
    el.append(bubble);
    return el;
  }
  async function refreshMessages(force=false){
    if(!chatIsActive()||busy)return;
    busy=true;
    try{
      const data=await api('/api/messages?uid='+encodeURIComponent(other));
      if(!chatIsActive())return;
      const messages=messageItems(data);
      const signature=JSON.stringify(messages.map(m=>[m.message_id,m.timestamp,m.text,m.body,m.sender_uid]))+JSON.stringify([...hidden]);
      if(force||signature!==lastSignature){
        const nearBottom=view.scrollHeight-view.scrollTop-view.clientHeight<130;
        const list=document.createDocumentFragment();
        messages.forEach((m,i)=>{const row=buildMessage(m,i);if(row)list.append(row);});
        root.replaceChildren(list);
        if(!root.childNodes.length)root.innerHTML='<div class="empty">Chưa có tin nhắn.</div>';
        lastSignature=signature;
        if(firstLoad||nearBottom){requestAnimationFrame(()=>{if(chatIsActive())view.scrollTop=view.scrollHeight;});}
      }
      firstLoad=false;
    }catch(err){if(firstLoad&&chatIsActive())root.textContent='Không tải được tin nhắn: '+err.message;}
    finally{busy=false;}
  }
  async function getTyping(){
    if(!chatIsActive()||document.hidden)return;
    try{
      const data=await api('/api/chat-typing?uid='+encodeURIComponent(other));
      if(chatIsActive())$('#typingIndicator').hidden=!data.typing;
    }catch{}
  }
  let timer=setInterval(()=>{
    if(document.hidden||!chatIsActive())return;
    refreshMessages();
    getTyping();
  },4500);
  $('#backChats').onclick=()=>{closeLiveChat();showChats();};
  $('#reloadMessages').onclick=()=>refreshMessages(true);
  form.elements.message.addEventListener('input',()=>{
    const now=Date.now();
    if(now-typingAt<2400||typingBusy)return;
    typingAt=now;typingBusy=true;
    api('/api/chat-typing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:other,typing:Boolean(form.elements.message.value.trim())})}).catch(()=>{}).finally(()=>{typingBusy=false;});
  });
  async function optimizeChatPhoto(file){
    // Giữ nguyên ảnh nhỏ; nén ảnh lớn ngay trên máy để giảm thời gian tải lên.
    if(file.size<450*1024)return file;
    try{
      const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
      const maxSide=1280;
      const ratio=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*ratio));
      canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
      const ctx=canvas.getContext('2d');
      if(!ctx){bitmap.close();return file;}
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      bitmap.close();
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.79));
      if(!blob||blob.size>=file.size)return file;
      return new File([blob],(file.name||'locket-photo').replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});
    }catch{return file;}
  }
  $('#chatPhotoInput').onchange=async event=>{
    const file=event.target.files?.[0];
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>12*1024*1024){
      toast('Chọn ảnh JPG, PNG hoặc WebP tối đa 12 MB.',true);
      event.target.value='';
      return;
    }
    const button=form.querySelector('.chat-photo-select');
    button.classList.add('sending');
    try{
      const reduced=await optimizeChatPhoto(file);
      const data=new FormData();
      data.append('uid',other);
      data.append('photo',reduced,reduced.name);
      const text=form.elements.message.value.trim();
      if(text)data.append('caption',text.slice(0,250));
      await api('/api/chat/photo',{method:'POST',body:data});
      form.elements.message.value='';
      toast('Đã gửi ảnh vào Locket.');
      await refreshMessages(true);
    }catch(err){toast('Gửi ảnh thất bại: '+err.message,true);}
    finally{button.classList.remove('sending');event.target.value='';}
  };
  form.onsubmit=async event=>{
    event.preventDefault();
    const text=form.elements.message.value.trim();
    if(!text)return;
    const button=form.querySelector('button[type="submit"]');
    button.disabled=true;
    try{
      await api('/api/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:other,message:text})});
      form.elements.message.value='';
      api('/api/chat-typing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:other,typing:false})}).catch(()=>{});
      await refreshMessages(true);
    }catch(err){toast('Gửi thất bại: '+err.message,true);}
    finally{button.disabled=false;}
  };
  await refreshMessages(true);
  getTyping();
}

function chatAvatar(chat) {
  const id = chatPeer(chat);

  const friend = state.friends.find(f => uid(f) === id);

  const person = friend || chat;

  const picture = urlOf(
    deep(person, [
      'avatar_url',
      'avatarUrl',
      'profile_picture_url',
      'profilePictureUrl',
      'profile_image_url',
      'profileImageUrl',
      'profile_picture'
    ])
  );

  const name = chatDisplayName(chat);
  const letter = name.replace(/^@/, '').slice(0, 1).toUpperCase();

  return `
    <div class="avatar">
      ${picture
        ? `<img src="${esc(picture)}"
                alt="${esc(name)}"
                loading="lazy"
                referrerpolicy="no-referrer">`
        : esc(letter || '?')}
    </div>
  `;
}

function chatDisplayName(chat) {
  const id = chatPeer(chat);

  const friend = state.friends.find(f => uid(f) === id);

  if (friend) {
    const name = displayName(friend);
    if (name !== 'Bạn bè') return name;

    const user = username(friend);
    if (user) return '@' + user;
  }

  const name = displayName(chat);
  if (name !== 'Bạn bè' && name !== id) {
    return name;
  }

  const user = username(chat);
  if (user) return '@' + user;

  return 'Người dùng Locket';
}

const MAX_RECORD_MS = 60000;
let recordTimer = null;
let recordAnimation = null;
let recordStartedAt = 0;
let cameraRequestId = 0;

function clearRecordTimer() {
  clearTimeout(recordTimer);
  cancelAnimationFrame(recordAnimation);
  recordTimer = null;
  recordAnimation = null;
}

function showCamera() {
  view.innerHTML = `
    <div class="locket-camera">
      <div class="camera-friends">${state.friends.length} người bạn</div>
      <h2 class="camera-title">LOCKET CAMERA</h2>
      <div class="camera-stage" id="cameraStage">
        <video id="liveVideo" autoplay muted playsinline></video>
        <div id="cameraPlaceholder" class="camera-placeholder">Đang mở camera...</div>
        <div class="record-progress" id="recordProgress"></div>
        <div class="record-time" id="recordTime">00:00 / 01:00</div>
      </div>
      <div class="camera-bottom">
        <button id="chooseMedia" class="camera-side" type="button">Thư viện</button>
        <button id="takePhoto" class="camera-shutter" type="button" aria-label="Chạm để chụp, giữ để quay"></button>
        <button id="switchCamera" class="camera-side" type="button">Đổi camera</button>
      </div>
      <button id="cameraHistory" class="camera-history" type="button">Lịch sử</button>
    </div>`;

  let facing = 'user';
  let holdTimer = null;
  let holding = false;
  let recordingStarted = false;
  const shutter = $('#takePhoto');

  shutter.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (holding || state.recorder?.state === 'recording') return;
    event.preventDefault();
    if (!state.stream) { toast('Camera chưa sẵn sàng.', true); return; }
    holding = true;
    recordingStarted = false;
    shutter.setPointerCapture?.(event.pointerId);
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (holding) recordingStarted = startRecording();
    }, 300);
  });

  function finishPress(cancel = false) {
    if (!holding) return;
    holding = false;
    clearTimeout(holdTimer);
    holdTimer = null;
    if (recordingStarted) {
      recordingStarted = false;
      stopRecording();
    } else if (!cancel) {
      takePhoto();
    }
  }
  shutter.addEventListener('pointerup', () => finishPress());
  shutter.addEventListener('pointercancel', () => finishPress(true));
  shutter.addEventListener('contextmenu', (event) => event.preventDefault());
  $('#switchCamera').onclick = async () => {
    if (holding || state.recorder?.state === 'recording') return;
    facing = facing === 'user' ? 'environment' : 'user';
    await startCamera(facing);
  };
  $('#chooseMedia').onclick = () => {
    if (holding || state.recorder?.state === 'recording') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime';
    input.onchange = () => { if (input.files?.[0]) chooseFile(input.files[0]); };
    input.click();
  };
  $('#cameraHistory').onclick = () => openTab('feed');
  startCamera(facing);
}

async function startCamera(facing = 'user') {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Trình duyệt không hỗ trợ camera hoặc chưa dùng HTTPS/localhost.', true);
    return;
  }
  const requestId = ++cameraRequestId;
  const video = $('#liveVideo');
  const placeholder = $('#cameraPlaceholder');
  if (!video) return;
  try {
    if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
    if (placeholder) { placeholder.hidden = false; placeholder.textContent = 'Đang mở camera...'; }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true
    }).catch(async () => navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing } }, audio: false
    }));
    if (requestId !== cameraRequestId || !video.isConnected || state.tab !== 'camera') {
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    state.stream = stream;
    video.srcObject = stream;
    video.style.transform =
  facing === 'user' ? 'scaleX(-1)' : 'none';
    await video.play();
    if (placeholder) placeholder.hidden = true;
  } catch (err) {
    if (placeholder) placeholder.textContent = 'Không mở được camera';
    toast('Không mở được camera: ' + err.message, true);
  }
}

function takePhoto() {
  const video = $('#liveVideo');
  if (!state.stream || !video?.videoWidth) { toast('Camera chưa sẵn sàng.', true); return; }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');

const isMirrored =
  video.style.transform.includes('scaleX(-1)');

context.save();

if (isMirrored) {
  context.translate(canvas.width, 0);
  context.scale(-1, 1);
}

context.drawImage(video, 0, 0);
context.restore();
  canvas.toBlob(blob => {
    if (blob) chooseFile(new File([blob], `locket-${Date.now()}.jpg`, { type: 'image/jpeg' }));
  }, 'image/jpeg', .9);
}

function updateRecordProgress() {
  if (state.recorder?.state !== 'recording') return;
  const elapsed = Math.min(performance.now() - recordStartedAt, MAX_RECORD_MS);
  const progress = $('#recordProgress');
  if (progress) progress.style.setProperty('--progress', `${elapsed / MAX_RECORD_MS * 100}%`);
  const time = $('#recordTime');
  if (time) time.textContent = `00:${String(Math.floor(elapsed / 1000)).padStart(2, '0')} / 01:00`;
  if (elapsed >= MAX_RECORD_MS) { stopRecording(); return; }
  recordAnimation = requestAnimationFrame(updateRecordProgress);
}

function startRecording() {
  if (!state.stream || state.recorder?.state === 'recording') return false;
  if (typeof MediaRecorder === 'undefined') { toast('Trình duyệt không hỗ trợ quay video.', true); return false; }
  const types = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t));
  if (!mime) { toast('Không có định dạng quay được hỗ trợ.', true); return false; }
  try {
    const chunks = [];
    const liveVideo = $('#liveVideo');
    const mirrored = liveVideo?.style.transform.includes('scaleX(-1)');
    let recordingStream = state.stream;
    let mirrorStream = null;
    let mirrorTimer = null;
    let oldTransform = null;
    if (mirrored && liveVideo?.videoWidth && typeof HTMLCanvasElement !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = liveVideo.videoWidth;
      canvas.height = liveVideo.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx && typeof canvas.captureStream === 'function') {
        try {
          mirrorStream = canvas.captureStream(30);
          for (const track of state.stream.getAudioTracks()) mirrorStream.addTrack(track);
          const frame = () => {
            if (!state.recorder || state.recorder.state === 'inactive') return;
            ctx.save();
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(liveVideo, 0, 0, canvas.width, canvas.height);
            ctx.restore();
            mirrorTimer = requestAnimationFrame(frame);
          };
          recordingStream = mirrorStream;
          // Render one frame before recording begins.
          ctx.save();
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(liveVideo, 0, 0, canvas.width, canvas.height);
          ctx.restore();
          mirrorTimer = requestAnimationFrame(frame);
        } catch (error) {
          mirrorStream?.getVideoTracks().forEach(track => track.stop());
          mirrorStream = null;
          recordingStream = state.stream;
          if (mirrorTimer) cancelAnimationFrame(mirrorTimer);
          mirrorTimer = null;
        }
      }
    }
    // Canvas captureStream is unavailable on some iPhones: show the same
    // orientation that the original camera track actually records.
    if (mirrored && !mirrorStream && liveVideo) {
      oldTransform = liveVideo.style.transform;
      liveVideo.style.transform = 'none';
    }
    const recorder = new MediaRecorder(recordingStream, { mimeType: mime });
    state.recorder = recorder;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = event => { clearRecordTimer(); toast('Quay video bị lỗi.', true); console.error(event); };
    recorder.onstop = () => {
      if (mirrorTimer) cancelAnimationFrame(mirrorTimer);
      if (mirrorStream) mirrorStream.getVideoTracks().forEach(track => track.stop());
      if (oldTransform && liveVideo?.isConnected) liveVideo.style.transform = oldTransform;
      clearRecordTimer();
      $('#cameraStage')?.classList.remove('is-recording');
      $('#takePhoto')?.classList.remove('is-recording');
      state.recorder = null;
      if (!chunks.length || state.tab !== 'camera') return;
      const type = mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
      const ext = type === 'video/mp4' ? 'mp4' : 'webm';
      chooseFile(new File(chunks, `locket-${Date.now()}.${ext}`, { type }));
    };
    recorder.start(250);
    recordStartedAt = performance.now();
    $('#cameraStage')?.classList.add('is-recording');
    $('#takePhoto')?.classList.add('is-recording');
    recordAnimation = requestAnimationFrame(updateRecordProgress);
    recordTimer = setTimeout(stopRecording, MAX_RECORD_MS);
    return true;
  } catch (err) { toast('Không quay được: ' + err.message, true); return false; }
}

function stopRecording() {
  clearRecordTimer();
  if (state.recorder?.state === 'recording') state.recorder.stop();
  $('#cameraStage')?.classList.remove('is-recording');
  $('#takePhoto')?.classList.remove('is-recording');
}

let selectedRecipients = new Set();
let recipientMode = 'all';

async function loadRecipients() {
  try {
    const data = await api('/api/friends');
    const friends = arr(data, ['friends', 'users', 'items', 'data']);
    state.friends = friends;
    return friends;
  } catch (err) {
    toast('Không tải được bạn bè: ' + err.message, true);
    return [];
  }
}


const STUDIO_GROUPS = [
  {title:'Tùy chỉnh',items:[['Văn bản','','neutral','focus'],['Thời gian','','neutral','time'],['Vị trí','','neutral','location'],['Chuỗi','Chuỗi hôm nay','amber'],['Bình chọn','Bình chọn: Có hay không?','purple'],['Review','Đánh giá hôm nay: ','neutral'],['Âm nhạc','Bài hát đang nghe: ','neutral']]},
  {title:'Theo mùa',items:[['Chào mùa đông','Chào mùa đông','ice'],['Chào mùa thu','Chào mùa thu','sunset'],['Chào mùa hè','Chào mùa hè','amber'],['Chào mùa xuân','Chào mùa xuân','mint']]},
  {title:'Ngày đặc biệt',items:[['Giáng sinh','Giáng sinh an lành','green'],['Năm mới','Chúc mừng năm mới','red'],['Sinh nhật','Chúc mừng sinh nhật','pink'],['Tri ân thầy cô','Tri ân thầy cô','mint']]},
  {title:'Caption gợi ý',items:[['Hôm nay','Hôm nay có một chút đáng yêu.','purple'],['Đi chơi','Một chuyến đi thật vui!','sunset'],['Đói rồi','Ăn gì bây giờ?','amber'],['Chill','Một chút bình yên.','mint'],['Nhớ ai đó','Có ai đang nhớ mình không?','ice'],['Bạn thân','Có bạn là có niềm vui.','pink'],['Khoảnh khắc','Giữ lại khoảnh khắc này.','blue'],['Cuối tuần','Cuối tuần nhẹ nhàng.','green']]},
  {title:'Trang trí caption',items:[['Tối giản','Một ngày thật đẹp.','neutral'],['Dễ thương','Đáng yêu quá đi!','pink'],['Năng lượng','Hôm nay thật rực rỡ!','sunset'],['Hoài niệm','Một ngày để nhớ.','ice'],['Tâm trạng','Có đôi điều muốn nói...','purple']]}
];

// Mỗi mẫu có màu nền và màu chữ cố định, gửi qua overlay Locket.
const STUDIO_PRESET_STYLE = {
  neutral:{colors:[],textColor:'#FFFFFF'},
  amber:{colors:['#F7C844','#E9AC1C'],textColor:'#24201A'},
  purple:{colors:['#8A40F2','#5746E9'],textColor:'#FFFFFF'},
  ice:{colors:['#C5F3FF','#81D3ED'],textColor:'#174052'},
  sunset:{colors:['#FFB363','#F08B3A'],textColor:'#26211C'},
  mint:{colors:['#58EFC0','#2CCBC6'],textColor:'#143D37'},
  green:{colors:['#36B971','#197B52'],textColor:'#FFFFFF'},
  red:{colors:['#EF5151','#BA2F36'],textColor:'#FFFFFF'},
  pink:{colors:['#FFA5CC','#F6BED3'],textColor:'#38202D'},
  blue:{colors:['#239EFB','#356EE7'],textColor:'#FFFFFF'}
};
function studioMarkup() {
  return '<div id="customizeSheet" class="customize-sheet" hidden>'+
    '<div class="customize-top"><strong>CUSTOMIZE STUDIO</strong><button type="button" id="closeCustomize" aria-label="Đóng">×</button></div>'+
    //'<p class="customize-hint">Chọn mẫu nào dùng đúng màu nền và chữ của mẫu đó. Không cần chọn màu riêng.</p>'+

    STUDIO_GROUPS.map(group=>'<section class="customize-group"><h3>'+esc(group.title)+'</h3><div class="customize-chips">'+
    group.items.map(item=>'<button type="button" class="customize-chip '+esc(item[2])+'" data-custom-style="'+esc(item[2])+'" data-custom-text="'+esc(item[3] ? item[1] : item[0])+'" data-custom-action="'+esc(item[3]||'text')+'">'+esc(item[0])+'</button>').join('')+
    '</div></section>').join('')+'</div>';
}
function chooseFile(file) {
  if (!file) return;
  if (state.mediaPreview) URL.revokeObjectURL(state.mediaPreview);
  state.file = file;
  state.mediaPreview = URL.createObjectURL(file);
  cameraRequestId++;
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
  recipientMode = 'all';
  selectedRecipients.clear();
  let selectedTextColor = '#FFFFFF';
  let selectedBackgroundColors = [];
  const isVideo = file.type.startsWith('video/');
  view.innerHTML = `
    <div class="locket-send-screen send-studio">
      <div class="send-top"><button id="backToCamera" class="send-back" type="button">Quay lại</button><strong>Gửi đến...</strong><button id="downloadMoment" class="send-download" type="button">Lưu</button></div>
      <h2 class="send-heading">LOCKET CAMERA</h2>
      <form id="postForm" class="send-form">
        <div class="send-media">
          ${isVideo ? `<video src="${esc(state.mediaPreview)}" controls playsinline preload="metadata"></video>` : `<img src="${esc(state.mediaPreview)}" alt="Khoảnh khắc xem trước">`}
          <div class="caption-fx-shell" id="captionFxShell"><div class="caption-fx-particles" id="captionFxParticles" aria-hidden="true"></div><input id="postCaption" name="caption" type="text" maxlength="250" placeholder="Nhập tin nhắn..." aria-label="Caption"></div>
        </div>
        <div class="send-media-info">${isVideo ? 'Video' : 'Ảnh'} · ${(file.size / 1024 / 1024).toFixed(2)} MB</div>
        <div class="studio-actions">
          <button id="cancelMoment" class="studio-action" type="button" aria-label="Hủy">×</button>
          <button id="sendMoment" class="studio-action studio-send" type="submit" aria-label="Gửi đến tất cả">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 3-7.4 18-3.1-7.5L3 10.4 21 3Z"/><path d="m10.5 13.5 10.3-10.3"/></svg>
          </button>
          <button id="openCustomize" class="studio-action" type="button" aria-label="Tùy chỉnh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 1.8 5.3L19 10l-5.2 1.7L12 17l-1.8-5.3L5 10l5.2-1.7L12 3Z"/><path d="M19 16v5m-2.5-2.5h5M4 15v4m-2-2h4"/></svg>
          </button>
        </div>
        <div class="recipient-caption" id="recipientCaption">Chọn người nhận</div>
        <div class="recipient-strip" id="recipientStrip" aria-label="Người nhận">
          <button type="button" class="recipient-choice" data-mode="private"><span class="recipient-avatar">Tôi</span><span class="recipient-name">Riêng tư</span></button>
          <button type="button" class="recipient-choice selected" data-mode="all"><span class="recipient-avatar">Tất cả</span><span class="recipient-name">Tất cả</span></button>
          <span id="recipientLoading" class="recipient-loading">Đang tải bạn bè...</span>
        </div>
      </form>
      ${studioMarkup()}
    </div>`;
  // Mỗi lần chụp/chọn media, bỏ vị trí cuộn cũ của màn Camera.
  // Canh giữa vùng ảnh trong khung nhìn và giữ tiêu đề khi đủ chỗ.
  view.scrollTop = 0;
  const centerPhotoPreview = () => {
    const preview = view.querySelector('.send-media');
    if (!preview || !preview.isConnected) return;
    const available = view.clientHeight;
    const previewTop = preview.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;
    const ideal = previewTop + preview.offsetHeight / 2 - available / 2;
    const maxScroll = Math.max(0, view.scrollHeight - available);
    view.scrollTop = Math.max(0, Math.min(maxScroll, ideal));
  };
  requestAnimationFrame(centerPhotoPreview);

  $('#backToCamera').onclick = () => {
    state.file = null;
    if (state.mediaPreview) URL.revokeObjectURL(state.mediaPreview);
    state.mediaPreview = null;
    showCamera();
  };
  $('#downloadMoment').onclick = () => {
    const a = document.createElement('a');
    a.href = state.mediaPreview;
    a.download = file.name || 'locket-media';
    a.click();
  };
  $('#postForm').onsubmit = postMedia;
  const colorInput = document.createElement('input');
  colorInput.type='hidden';
  colorInput.name='textColor';
  $('#postForm').appendChild(colorInput);
  const backgroundInput = document.createElement('input');
  backgroundInput.type='hidden';
  backgroundInput.name='captionColors';
  $('#postForm').appendChild(backgroundInput);
  function applyPresetStyle(name) {
    const preset=STUDIO_PRESET_STYLE[name] || STUDIO_PRESET_STYLE.neutral;
    selectedTextColor=preset.textColor;
    selectedBackgroundColors=preset.colors.slice();
    colorInput.value=selectedTextColor;
    backgroundInput.value=JSON.stringify(selectedBackgroundColors);
    const shell=$('#captionFxShell');
    const captionInput=$('#postCaption');
    captionInput.style.color=selectedTextColor;
    shell.style.background=selectedBackgroundColors.length
      ? 'linear-gradient(110deg,'+selectedBackgroundColors.join(',')+')'
      : 'rgba(30,34,40,.65)';
  }
  function showCaptionEffect(label, style) {
    const layer=$('#captionFxParticles');
    const shell=$('#captionFxShell');
    if(!layer || !shell)return;
    const lower=String(label||'').toLowerCase();
    const mode=/đông|giáng sinh/.test(lower)?'snow':
      /thu/.test(lower)?'leaves':
      /sinh nhật|dễ thương|nhớ ai/.test(lower)?'hearts':
      /xuân|tri ân|bạn thân/.test(lower)?'petals':
      /bình chọn|năm mới|hôm nay|năng lượng/.test(lower)?'sparkles':
      /hè|đi chơi|cuối tuần/.test(lower)?'sunlight':
      style==='purple'||style==='blue'?'sparkles':'none';
    const symbols={snow:'❄',leaves:'✦',hearts:'♥',petals:'✿',sparkles:'✧',sunlight:'✴'};
    shell.dataset.effect=mode;
    layer.replaceChildren();
    if(mode==='none')return;
    for(let i=0;i<8;i++){
      const particle=document.createElement('span');
      particle.className='caption-fx-particle';
      particle.textContent=symbols[mode];
      particle.style.setProperty('--fx-left',(5+i*13)%100+'%');
      particle.style.setProperty('--fx-delay',(-i*.53)+'s');
      particle.style.setProperty('--fx-time',(2.8+(i%4)*.6)+'s');
      particle.style.setProperty('--fx-size',(10+(i%3)*4)+'px');
      layer.append(particle);
    }
  }
  applyPresetStyle('neutral');
  showCaptionEffect('','neutral');
  $('#cancelMoment').onclick = $('#backToCamera').onclick;
  $('#openCustomize').onclick = () => { const sheet = $('#customizeSheet'); sheet.hidden = false; sheet.scrollTop = 0; };
  $('#closeCustomize').onclick = () => { $('#customizeSheet').hidden = true; };
  $('#customizeSheet').addEventListener('click', event => {
    const button = event.target.closest('[data-custom-action]');
    if (!button) return;
    const input = $('#postCaption');
    const action = button.dataset.customAction;
    applyPresetStyle(button.dataset.customStyle);
    showCaptionEffect(button.textContent,button.dataset.customStyle);
    if (action === 'focus') {
      $('#customizeSheet').hidden = true;
      input.focus();
      return;
    }
    if (action === 'time') {
      input.value = 'Bây giờ là ' + new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});
    } else if (action === 'location') {
      if (!navigator.geolocation) { toast('Trình duyệt không hỗ trợ vị trí.',true); return; }
      button.disabled = true;
      navigator.geolocation.getCurrentPosition(
        position => {
          input.value = ('Vị trí: ' + position.coords.latitude.toFixed(4)+', '+position.coords.longitude.toFixed(4)).slice(0,250);
          button.disabled = false;
          if ($('#customizeSheet')) $('#customizeSheet').hidden = true;
        },
        () => { button.disabled = false; toast('Không lấy được vị trí hoặc chưa cấp quyền.',true); },
        {enableHighAccuracy:false, timeout:8000, maximumAge:60000}
      );
      return;
    } else {
      input.value = button.dataset.customText || '';
    }
    input.dispatchEvent(new Event('input',{bubbles:true}));
    $('#customizeSheet').hidden = true;
  });

  const strip = $('#recipientStrip');
  function updateRecipientUi() {
    strip.querySelectorAll('[data-mode]').forEach(button => {
      button.classList.toggle('selected', button.dataset.mode === recipientMode);
    });
    strip.querySelectorAll('[data-recipient]').forEach(button => {
      button.classList.toggle('selected', selectedRecipients.has(button.dataset.recipient));
    });
    const btn = $('#sendMoment');
    btn.setAttribute('aria-label', recipientMode === 'private' ? 'Đăng riêng tư' :
      recipientMode === 'all' ? 'Gửi đến tất cả' :
      `Gửi đến ${selectedRecipients.size} bạn bè`);
    $('#recipientCaption').textContent = recipientMode === 'private'
      ? 'Chỉ mình bạn xem được khoảnh khắc này'
      : recipientMode === 'all'
      ? 'Tất cả bạn bè nhận được khoảnh khắc'
      : `Đã chọn ${selectedRecipients.size} người nhận`;
  }
  strip.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.dataset.mode) {
      recipientMode = button.dataset.mode;
      selectedRecipients.clear();
    } else if (button.dataset.recipient) {
      const id = button.dataset.recipient;
      if (recipientMode !== 'selected') selectedRecipients.clear();
      recipientMode = 'selected';
      if (selectedRecipients.has(id)) selectedRecipients.delete(id);
      else selectedRecipients.add(id);
    }
    updateRecipientUi();
  });
  loadRecipients().then(friends => {
    if (!strip.isConnected) return;
    $('#recipientLoading')?.remove();
    const unique = new Set();
    friends.forEach(friend => {
      const id = uid(friend);
      if (!id || unique.has(id)) return;
      unique.add(id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recipient-choice';
      button.dataset.recipient = id;
      const picture = urlOf(deep(friend, ['avatar_url','avatarUrl','profile_picture_url','profilePictureUrl','profile_image_url','profileImageUrl']));
      const name = displayName(friend);
      const bubble = document.createElement('span');
      bubble.className = 'recipient-avatar';
      if (picture) {
        const img = document.createElement('img');
        img.src = picture;
        img.alt = '';
        bubble.append(img);
      } else bubble.textContent = name.slice(0, 2).toUpperCase();
      const label = document.createElement('span');
      label.className = 'recipient-name';
      label.textContent = name;
      button.append(bubble, label);
      strip.append(button);
    });
    updateRecipientUi();
  });
}

async function postMedia(event) {
  event.preventDefault();
  const file = state.file;
  if (!file) { toast('Chưa chọn ảnh hoặc video.', true); return; }
  if (recipientMode === 'selected' && !selectedRecipients.size) {
    toast('Hãy chọn ít nhất một người bạn.', true);
    return;
  }
  const form = event.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  const data = new FormData();
  data.append('media', file, file.name);
  data.append('caption', form.elements.caption.value);
  data.append('textColor', form.elements.textColor?.value || '#FFFFFF');
  data.append('captionColors', form.elements.captionColors?.value || '[]');
  data.append('visibility', recipientMode);
  if (recipientMode === 'selected') {
    data.append('recipients', JSON.stringify([...selectedRecipients]));
  }
  toast('Đang tải lên Locket...');
  try {
    await api('/api/post', { method:'POST', body:data });
    toast('Gửi khoảnh khắc thành công');
    state.file = null;
    if (state.mediaPreview) URL.revokeObjectURL(state.mediaPreview);
    state.mediaPreview = null;
    await openTab('feed');
  } catch (err) {
    toast('Gửi thất bại: ' + err.message, true);
  } finally { btn.disabled = false; }
}

async function init(){try{const res=await fetch('/api/bootstrap');const data=await res.json();$('#login').hidden=!!data.loggedIn;$('#app').hidden=!data.loggedIn;if(data.loggedIn){try{state.profile=await api('/api/profile');$('#accountLabel').textContent=username(state.profile)?'@'+username(state.profile):displayName(state.profile)}catch{}await openTab('camera')}}catch(err){toast('Không kết nối được server: '+err.message,true)}}
$('#loginForm').onsubmit=async e=>{e.preventDefault();const btn=e.currentTarget.querySelector('button');btn.disabled=true;try{const d=new FormData(e.currentTarget);await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:d.get('email'),password:d.get('password')})});await init();toast('Đăng nhập thành công')}catch(err){toast(err.message,true)}finally{btn.disabled=false}};
document.querySelectorAll('.nav button').forEach(btn=>btn.onclick=()=>openTab(btn.dataset.tab));
$('#reloadBtn').onclick=refresh;
window.addEventListener('pagehide',stopCamera);
init();
