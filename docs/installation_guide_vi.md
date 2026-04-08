# Hướng Dẫn Cài Đặt MyJavis

Hướng dẫn từng bước cài đặt và sử dụng **MyJavis** trên macOS.

---

## Yêu cầu

- macOS 13 trở lên (Apple Silicon — chip M1/M2/M3/M4)
- **Chế độ Cloud**: API key của [Soniox](https://soniox.com) (trả theo dùng, ~$0.12/giờ)
- **Chế độ Local**: ~5 GB dung lượng ổ cứng (cho mô hình AI, tải một lần)
- **Thuyết minh TTS** (tuỳ chọn): Xem [Hướng dẫn TTS](tts_guide_vi.md)

---

## Bước 1 — Tải về

Tải file `.dmg` mới nhất tại: [**Releases — macOS**](https://github.com/phuc-nt/my-translator/releases/latest)

Chọn đúng file:
- `MyJavis_x.x.x_aarch64.dmg` — Apple Silicon (M1/M2/M3/M4)
- `MyJavis_x.x.x_x64.dmg` — Intel Mac

---

## Bước 2 — Cài đặt

1. Mở file `.dmg` vừa tải
2. Kéo **MyJavis** vào thư mục **Applications**
3. Eject DMG

---

## Bước 3 — Mở lần đầu

Mở MyJavis từ Applications.

> ✅ App đã được ký và notarize — macOS sẽ cho phép mở mà không cảnh báo bảo mật.

---

## Bước 4 — Cấp quyền Screen Recording

Lần đầu mở app, macOS sẽ hỏi quyền **Screen & System Audio Recording**:

1. Bấm **Open System Settings** khi được hỏi
2. Tìm **MyJavis** trong danh sách
3. **Bật công tắc ON**
4. macOS sẽ yêu cầu **Quit & Reopen** — bấm nút đó

> Quyền này bắt buộc để app bắt được âm thanh hệ thống (YouTube, Zoom, podcast, v.v.)

---

## Bước 5 — Lấy API Key Soniox

Soniox cung cấp nhận diện giọng nói và dịch real-time.

1. Vào [console.soniox.com](https://console.soniox.com) → tạo tài khoản
2. Nạp tiền:
   - Click **Billing** ở thanh bên trái
   - Thêm phương thức thanh toán
   - Nạp tiền ($10 tối thiểu — dùng được ~80+ giờ với ~$0.12/giờ)
3. Tạo API key:
   - Click **API Keys** ở thanh bên trái
   - Click **Create API Key**
   - Copy key (dạng `soniox_...`)

> 💡 Soniox tính ~$0.12/giờ audio. $10 ≈ 80+ giờ dịch.

---

## Bước 6 — Cấu hình App

1. Bấm ⚙️ (hoặc `⌘ ,`) để mở **Settings**
2. Vào tab **General**
3. Dán **Soniox API key**
4. Chọn kiểu dịch:
   - **One-way** (Một chiều): Chọn ngôn ngữ nguồn và ngôn ngữ đích
   - **Two-way** (Hai chiều): Chọn Language A và Language B (dành cho meeting song ngữ — app tự nhận diện ai đang nói và dịch sang ngôn ngữ còn lại)
5. Chọn Translation Engine:

| Chế độ | Tốc độ | Chất lượng | Chi phí | Internet |
|--------|--------|------------|---------|----------|
| ☁️ **Soniox API (Cloud)** | Real-time (~2 giây) | 9/10 | ~$0.12/giờ | Cần |
| 🖥️ **Local MLX (Offline)** | ~10 giây delay | 7/10 | Miễn phí | Không cần |

6. Bấm **Save & Close**

> **Local MLX** yêu cầu Apple Silicon (M1+) và ~5 GB ổ cứng. Model tự tải lần đầu.

---

## Bước 7 — Bật Thuyết Minh TTS (Tuỳ chọn)

Muốn bản dịch được **đọc thành lời**? Có 3 nhà cung cấp:

| Nhà cung cấp | Chi phí | Chất lượng | Cài đặt |
|---------------|---------|------------|---------|
| 🎙️ **Edge TTS** | Miễn phí | Tự nhiên | Không cần gì |
| 🌐 **Google Chirp 3 HD** | Free 1M ký tự/tháng | Gần giọng người | Cần Google Cloud API key |
| ✨ **ElevenLabs** | ~$5/tháng trở lên | Cao cấp | Cần ElevenLabs API key |

### Cài nhanh (Edge TTS — miễn phí):

1. Settings → tab **TTS** → Provider: **Edge TTS**
2. Chọn giọng → **Save & Close**
3. Trên màn hình chính, bấm nút **TTS** (hoặc `⌘ T`) để bật

### Google hoặc ElevenLabs:

Xem [Hướng dẫn TTS](tts_guide_vi.md) để biết cách lấy API key từng bước.

---

## Bước 8 — Bắt đầu dịch!

1. Quay lại màn hình chính
2. Bấm ▶ (hoặc `⌘ Enter`) để bắt đầu
3. Phát bất kỳ audio nào trên máy (YouTube, Zoom, podcast...)
4. Bản dịch xuất hiện real-time!

**Chế độ hiển thị:**
- **Single** (mặc định): Chỉ bản dịch
- **Dual**: Nguồn | Bản dịch song song (bật bằng nút panel, góc dưới phải)

**Cỡ chữ:** Dùng nút A-/A+ (góc dưới phải khi hover) để chỉnh

---

## Phím tắt

| Phím tắt | Chức năng |
|----------|-----------|
| `⌘ Enter` | Bắt đầu / Dừng |
| `⌘ ,` | Mở Settings |
| `Esc` | Đóng Settings |
| `⌘ 1` | Chuyển sang System Audio |
| `⌘ 2` | Chuyển sang Microphone |
| `⌘ T` | Bật/tắt thuyết minh TTS |

---

## Xử lý sự cố

### Không có bản dịch / không hiện text
→ Kiểm tra đã bật quyền **Screen & System Audio Recording** chưa (xem Bước 4)

### Lỗi "No API key"
→ Vào Settings (⚙️) và dán API key Soniox (xem Bước 5)

### Lỗi "No microphone found"
→ Mac Mini không có mic tích hợp. Cần kết nối mic ngoài (USB, headset, AirPods)

### TTS không hoạt động
→ Xem [Hướng dẫn TTS — Xử lý sự cố](tts_guide_vi.md#xử-lý-sự-cố)

---

## Cập nhật

MyJavis có tính năng **tự động cập nhật**. Khi có bản mới:

1. **Badge xanh** xuất hiện trên icon ⚙️ Settings
2. Mở Settings → tab **About** → bấm **Download & Install**
3. App sẽ tự khởi động lại với bản mới

Không cần tải DMG thủ công cho các bản cập nhật sau!
