export async function notifyTelegramLogin() {
  const botToken = String(
    process.env.TELEGRAM_BOT_TOKEN || ''
  ).trim().replace(/^bot/i, '');

  const chatId = String(
    process.env.TELEGRAM_CHAT_ID || ''
  ).trim();

  if (!botToken || !chatId) {
    console.warn('[Telegram] Thiếu biến môi trường.');
    return;
  }

  const message = [
    'Đăng nhập Locket thành công',
    'Thời gian: ' + new Date().toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh'
    })
  ].join('\n');

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message
        }),
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!response.ok) {
      console.error('[Telegram] HTTP', response.status);
    }
  } catch (error) {
    console.error('[Telegram]', error.message);
  }
}
