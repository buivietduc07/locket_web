# Locket Web - Windows

Website Locket không chính thức sử dụng npm `locket.js` phiên bản 0.0.3.

## Cài đặt

1. Cài Node.js >= 18 và FFmpeg (cần cho xử lý video). Có thể dùng `winget install Gyan.FFmpeg` trên Windows.
2. Giải nén vào `Downloads\locket-web-full`.
3. CMD:

```cmd
cd %USERPROFILE%\Downloads\locket-web-full
npm install
npm start
```

4. Mở http://127.0.0.1:3000. Cho phép camera nếu muốn quay.

Nếu đã đăng nhập bằng thư viện ở thư mục khác, chép `locket.js_session.json` vào thư mục này khi server chưa chạy.

## Chức năng

- Bảng tin ảnh/video từ `client.moments.getLatest()`.
- Bạn bè và xem bài họ chia sẻ bằng `getSharedMomentsByUsername()` hoặc `getSharedMomentsByUser()` khi phiên bản thư viện hỗ trợ.
- Hội thoại, lịch sử tin nhắn, gửi tin nhắn.
- Chụp ảnh/quay video trong trình duyệt, đăng cùng caption.

## Lưu ý

- Đăng ảnh/video là thao tác thực trên tài khoản của bạn, không phải dữ liệu demo.
- Quay video phụ thuộc vào MediaRecorder trong trình duyệt, codec và FFmpeg. Trên iOS/Safari, định dạng và quyền camera có thể khác.
- Camera yêu cầu secure context. `http://127.0.0.1:3000` được phép trên máy chạy server; để dùng điện thoại qua mạng cần HTTPS và bảo vệ truy cập.
- `locket.js` dùng API không chính thức, có thể thay đổi hoặc lỗi; quyền xem bài vẫn phụ thuộc vào tài khoản và API.
- Server chỉ lắng nghe `127.0.0.1`, không được đưa thẳng lên Internet do chưa có cơ chế đăng nhập đa người dùng.
- Giữ file `locket.js_session.json` bí mật. Không đưa file này lên GitHub.
- Không có chức năng cấp quyền Locket Gold.
- UI được xây theo phong cách app Locket, không sao chép chính xác website tham chiếu do trang tham chiếu không truy cập được từ môi trường phát triển.


## Bảng tin mở rộng
- `GET /api/feed`: kết hợp bài mới nhất với lịch sử chia sẻ, hỗ trợ `cursor` để lấy thêm 30 bài mỗi lần.
- `GET /api/archive`: các bài do chính tài khoản đăng, giới hạn 30 theo khả năng truy xuất của SDK.
- API không bảo đảm có thể xem lại ảnh đã xóa hoặc ảnh chưa từng được chia sẻ với tài khoản này.
- Bản này dùng `locket.js` hỗ trợ `getMoments` và `getAllMyMoments`; API có thể thay đổi.
