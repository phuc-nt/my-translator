# Hướng dẫn cài đặt — Windows

Hướng dẫn từng bước cài đặt và sử dụng **MyJavis** trên Windows 10/11.

---

## Yêu cầu

- Windows 10 trở lên (x64 hoặc ARM64)
- API key từ [Soniox](https://soniox.com) (trả theo dùng, ~$0.12/giờ)
- **Thuyết minh TTS** (tuỳ chọn): API key của [ElevenLabs](https://elevenlabs.io) (gói Starter $5/tháng)

---

## Bước 1 — Tải xuống

Tải file `.exe` mới nhất tại: [**Releases — Windows**](https://github.com/phuc-nt/my-translator/releases/latest)

Chọn phiên bản phù hợp:
- **x64** — Đa số PC Windows (Intel/AMD)
- **arm64** — Windows trên ARM (Surface Pro X, laptop Snapdragon)

---

## Bước 2 — Bỏ qua SmartScreen

> ⚠️ Ứng dụng chưa có chữ ký số. Windows SmartScreen sẽ chặn lần chạy đầu tiên.

Khi thấy màn hình **"Windows protected your PC"**:

1. Nhấn **"More info"** (Thêm thông tin)

![SmartScreen — nhấn More info](user_manual_win/mytrans_win_01.png)

2. Nhấn **"Run anyway"** (Vẫn chạy)

![Nhấn Run anyway](user_manual_win/mytrans_win_02.png)

---

## Bước 3 — Cài đặt

Trình cài đặt sẽ hướng dẫn bạn:

1. Nhấn **Next** để bắt đầu

![Welcome to MyJavis Setup](user_manual_win/mytrans_win_03.png)

2. Chọn thư mục cài đặt (để mặc định là được) → nhấn **Next**

![Chọn thư mục cài đặt](user_manual_win/mytrans_win_04.png)

3. Đợi cài đặt hoàn tất → nhấn **Next**

![Cài đặt hoàn tất](user_manual_win/mytrans_win_05.png)

4. Tích **"Run MyJavis"** → nhấn **Finish**

![Hoàn thành — Chạy MyJavis](user_manual_win/mytrans_win_06.png)

---

## Bước 4 — Cấu hình API Key và ngôn ngữ

Ứng dụng mở lên. Nhấn ⚙️ để mở **Settings** (Cài đặt).

Cấu hình:

1. **SONIOX API KEY** — Dán API key (Bắt buộc)
2. **Source** — Chọn ngôn ngữ nguồn (hoặc để Auto-detect - tự nhận diện)
3. **Target** — Chọn ngôn ngữ đích (VD: Vietnamese, English...)
4. **Audio Source** — Chọn System Audio (âm thanh máy tính) hoặc Microphone

![Settings — API Key và ngôn ngữ](user_manual/mytrans_setting_1.png)

Kéo xuống để xem thêm tuỳ chọn:

- **Font Size** — Điều chỉnh cỡ chữ
- **Max Lines** — Số dòng hiển thị tối đa
- **Show original text** — Hiện text gốc bên cạnh bản dịch
- **Custom Context** — Thêm lĩnh vực/thuật ngữ để dịch chính xác hơn

![Settings — TTS Narration](user_manual/mytrans_setting_2.png)

Nhấn **Save & Close** khi xong.

> 💡 **Lấy API key Soniox ở đâu?**
> 1. Vào [console.soniox.com](https://console.soniox.com) → tạo tài khoản
> 2. Nạp tiền ($10 tối thiểu, dùng rất lâu với ~$0.12/giờ)
> 3. Vào **API Keys** → tạo và copy key

![Soniox Console — Billing](user_manual/mytrans_key_1.png)

---

## Bước 5 — Bật Thuyết Minh TTS (Tuỳ chọn)

Muốn bản dịch được **đọc thành lời**? Bật tính năng TTS:

1. Trong Settings, cuộn xuống phần **TTS Narration**
2. Tick **"Đọc bản dịch thành lời (Enable narration)"**

![Cài đặt — TTS tắt](user_manual/mytrans_setting_2.png)

3. Nhập **API key ElevenLabs**
4. Chọn **giọng nói** (2 nữ, 2 nam — đều hỗ trợ tiếng Việt)
5. Nhấn **Save & Close**

![Cài đặt — TTS bật với API key và giọng nói](user_manual/mytrans_setting_3.png)

> 💡 **Lấy API key ElevenLabs ở đâu?**
> 1. Vào [elevenlabs.io](https://elevenlabs.io) → tạo tài khoản
> 2. Đăng ký gói **Starter** ($5/tháng, ~60 phút TTS)
> 3. Vào **Developers → API Keys** → tạo key với quyền "Text to Speech"

![ElevenLabs — Gói Subscription](user_manual/mytrans_key_2.png)
![ElevenLabs — Tạo API Key](user_manual/mytrans_key_3.png)

> 💡 TTS là tuỳ chọn. Nếu tắt, app hoạt động như bình thường — chỉ dịch text.

---

## Bước 6 — Bắt đầu dịch!

Nhấn ▶ để bắt đầu. Ứng dụng sẽ hiện **Listening...**

Giờ phát bất kỳ âm thanh nào trên PC (YouTube, Zoom, podcast...) và bản dịch sẽ xuất hiện theo thời gian thực!

Nếu TTS đã bật, bạn có thể bật/tắt bằng nút **TTS** hoặc `Ctrl+T`.

![App đang dịch với TTS bật](user_manual/mytrans_tts_1.png)

---

## Mẹo sử dụng

- **System Audio** bắt tất cả âm thanh đang phát trên PC — không cần virtual cable
- **Microphone** bắt giọng nói trực tiếp từ mic
- **TTS** đọc bản dịch thành lời — bật/tắt bằng nút TTS hoặc `Ctrl+T`
- Ứng dụng hoạt động như **overlay** — kéo thả tự do, thay đổi kích thước tuỳ ý
- Bản dịch được **lưu tự động** — nhấn 📋 để xem file transcript

---

## Phím tắt

| Phím tắt | Chức năng |
|----------|-----------|
| `Ctrl+Enter` | Bắt đầu / Dừng |
| `Ctrl+,` | Mở Settings |
| `Esc` | Đóng Settings |
| `Ctrl+T` | Bật/tắt thuyết minh TTS |

---

## Khắc phục sự cố

### SmartScreen chặn trình cài đặt
→ Nhấn **"More info"** → **"Run anyway"** (xem Bước 2).

### Không hiện bản dịch
→ Kiểm tra API key Soniox đã đúng trong Settings (⚙️).

### Không bắt được âm thanh hệ thống
→ Đảm bảo đang phát audio trên PC. Một số ứng dụng dùng exclusive audio mode — thử nguồn audio khác.

### Ứng dụng không mở
→ Đảm bảo WebView2 Runtime đã cài. Windows 10/11 thường có sẵn, nhưng phiên bản cũ cần cài từ [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

---

## Cập nhật

MyJavis có tính năng **tự động cập nhật**. Khi có bản mới:

1. **Badge xanh** xuất hiện trên icon ⚙️ Settings
2. Mở Settings → tab **About** → bấm **Download & Install**
3. App sẽ tự khởi động lại với bản mới

Không cần tải installer thủ công cho các bản cập nhật sau!
