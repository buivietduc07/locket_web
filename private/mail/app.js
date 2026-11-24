(function () {
'use strict';
const domain = 'klab.id.vn';
const storageKey = 'klab-mail-addresses-v2';
const $ = id => document.getElementById(id);
let current = '';
function notice(message) { $('status').textContent = message; }
function randomName() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return 'mail' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function load() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(value) ? value.filter(s => typeof s === 'string' && /^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]@klab\.id\.vn$/.test(s)).slice(0, 100) : [];
  } catch { return []; }
}
function save(addresses) {
  try { localStorage.setItem(storageKey, JSON.stringify(addresses)); }
  catch { notice('Trình duyệt không cho lưu danh sách.'); }
}
function setCurrent(local) {
  current = local + '@' + domain;
  $('generated').textContent = current;
}
async function copy(address) {
  try {
    await navigator.clipboard.writeText(address);
    notice('Đã sao chép ' + address);
  } catch { notice('Không sao chép tự động được.'); }
}
function render() {
  const list = $('recent');
  list.textContent = '';
  const addresses = load();
  $('empty').hidden = addresses.length > 0;
  for (const address of addresses) {
    const li = document.createElement('li');
    const label = document.createElement('code');
    label.textContent = address;
    const actions = document.createElement('div');
    actions.className = 'mail-buttons';
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Sao chép';
    copyButton.addEventListener('click', () => copy(address));
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Xóa';
    deleteButton.addEventListener('click', () => {
      if (!confirm('Xóa ' + address + ' khỏi danh sách trên trình duyệt này? Catch-all vẫn tiếp tục nhận thư cho địa chỉ này.')) return;
      save(load().filter(item => item !== address));
      render();
      notice('Đã xóa khỏi danh sách. Địa chỉ vẫn có thể nhận thư qua Catch-all.');
    });
    actions.append(copyButton, deleteButton);
    li.append(label, actions);
    list.append(li);
  }
}
function create() {
  const local = ($('custom').value.trim().toLowerCase() || current.split('@')[0]);
  if (!/^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$/.test(local) || local.includes('..')) {
    notice('Tên email không hợp lệ (3–40 ký tự).');
    return;
  }
  const address = local + '@' + domain;
  save([address, ...load().filter(item => item !== address)].slice(0, 100));
  setCurrent(local);
  render();
  notice('Đã lưu ' + address + '. Catch-all Cloudflare sẽ chuyển tiếp thư đến Gmail nếu đang hoạt động.');
}
$('apply').addEventListener('click', create);
$('random').addEventListener('click', () => {
  setCurrent(randomName());
  $('custom').value = '';
  notice('Đã chọn tên mới. Nhấn Lưu địa chỉ để thêm vào danh sách.');
});
$('copy').addEventListener('click', () => copy(current));
$('refresh').addEventListener('click', () => {
  render();
  notice('Đã tải lại danh sách lưu trên trình duyệt này.');
});
$('custom').addEventListener('keydown', event => { if (event.key === 'Enter') create(); });
setCurrent(load()[0]?.split('@')[0] || randomName());
render();
notice('Chế độ đơn giản: không cần Cloudflare API Token hoặc Zone ID.');
})();