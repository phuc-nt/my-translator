# Hướng Dẫn TTS (Text-to-Speech)

MyJavis có thể **đọc thành tiếng bản dịch** ngay khi xuất hiện — như có phiên dịch viên ngồi cạnh. Hỗ trợ 3 nhà cung cấp:

## So sánh các lựa chọn

| | Edge TTS ⭐ | Google Chirp 3 HD | ElevenLabs |
|-|-------------|-------------------|------------|
| **Chi phí** | Miễn phí | Free 1M ký tự/tháng, sau đó $30/1M | ~$5–$22/tháng |
| **Chất lượng** | Tự nhiên, rõ ràng | Gần giọng người thật, giàu cảm xúc | Rất tự nhiên, giàu cảm xúc |
| **Tiếng Việt** | ✅ HoaiMy, NamMinh | ✅ 6 giọng (Aoede, Kore, Charon...) | ✅ Có |
| **Cài đặt** | Không cần gì — bật là dùng | Cần Google Cloud API key | Cần ElevenLabs API key |
| **Chỉnh tốc độ** | ✅ -50% đến +100% | ✅ 0.5x đến 2.0x | ❌ |
| **Độ trễ** | ~300-500ms | ~200-500ms | ~500-800ms |
| **Phù hợp** | Đa số người dùng | Chất lượng tiếng Việt tốt nhất | Voice cloning |

**Tóm gọn**: Edge TTS đủ tốt cho 90% nhu cầu. Google Chirp 3 HD cho chất lượng tiếng Việt vượt trội với free tier hào phóng. ElevenLabs dành cho nhu cầu nâng cao (voice cloning).

---

## Edge TTS (Mặc định — Miễn phí)

### Edge TTS là gì?

Edge TTS dùng cùng công nghệ giọng nói neural của **Microsoft Edge** (tính năng "Đọc to"). MyJavis kết nối đến cùng dịch vụ để đọc bản dịch.

- **Không cần API key** — bật là dùng
- **Không giới hạn rõ ràng** — miễn phí cho mục đích cá nhân
- Microsoft có thể thay đổi chính sách, nhưng đến nay vẫn ổn định

### Giọng có sẵn

| Giọng | Ngôn ngữ | Giới tính |
|-------|----------|-----------|
| HoaiMy | Tiếng Việt 🇻🇳 | Nữ |
| NamMinh | Tiếng Việt 🇻🇳 | Nam |
| Jenny | English 🇺🇸 | Nữ |
| Guy | English 🇺🇸 | Nam |
| Nanami | 日本語 🇯🇵 | Nữ |
| SunHi | 한국어 🇰🇷 | Nữ |
| Xiaoxiao | 中文 🇨🇳 | Nữ |

### Tốc độ

Chỉnh trong Settings → TTS → Speed. Mặc định **+20%**.

---

## Google Cloud TTS — Chirp 3 HD (Cao cấp)

### Chirp 3 HD là gì?

Model TTS mới nhất của Google với chất lượng **gần giọng người thật**. Chirp 3 HD nắm bắt ngữ điệu tự nhiên, đặc biệt tốt cho tiếng Việt — nghe ít "máy" hơn nhiều so với Edge TTS.

### Giá

- **Miễn phí**: 1 triệu ký tự/tháng (~250K từ — đủ dùng cho cá nhân)
- **Vượt free tier**: $30 cho mỗi 1 triệu ký tự

### Cách lấy API Key

1. Vào [console.cloud.google.com](https://console.cloud.google.com)
2. Tạo project mới (hoặc dùng project có sẵn) — click dropdown góc trên trái → **New Project** → đặt tên `my-translator` → **Create**
3. Bật Text-to-Speech API:
   - Vào [console.cloud.google.com/apis/library/texttospeech.googleapis.com](https://console.cloud.google.com/apis/library/texttospeech.googleapis.com)
   - Click **Enable**
4. Tạo API Key:
   - Vào [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
   - Click **+ Create Credentials** → **API Key**
   - Copy key (dạng `AIzaSy...`)
5. *(Khuyến nghị)* Giới hạn key:
   - Click vào key vừa tạo → **Restrict key**
   - Mục **API restrictions** → chọn **Cloud Text-to-Speech API** only
   - **Save**

### Cài đặt trong App

1. Trong app: Settings → TTS → chọn **🌐 Google Chirp 3 HD**
2. Dán API key
3. Chọn giọng và tốc độ
4. Bấm **Save & Close**

### Giọng có sẵn

Tiếng Việt (6 giọng), English (4 giọng), Japanese (2), Korean (2), Chinese (2) — tất cả chất lượng Chirp 3 HD.

---

## ElevenLabs (Cao cấp)

### ElevenLabs là gì?

ElevenLabs chuyên về **AI voice**, nổi tiếng với giọng nói cực kỳ tự nhiên, có cảm xúc. Dịch vụ trả phí với API key riêng.

### Cách lấy API Key

1. Vào [elevenlabs.io](https://elevenlabs.io) → tạo tài khoản
2. Đăng ký gói **Starter** ($5/tháng, ~30 phút TTS) hoặc cao hơn
3. Click avatar góc trên phải → **API Keys**
4. Click **Create API Key** → copy key

### Cài đặt trong App

1. Trong app: Settings → TTS → chọn **✨ ElevenLabs**
2. Dán API key
3. Chọn giọng
4. Bấm **Save & Close**

---

## Cách sử dụng TTS

1. **Bật/tắt TTS**: Bấm nút **TTS** trên thanh công cụ hoặc nhấn `⌘ T`
2. TTS **mặc định TẮT** mỗi lần mở app — bạn phải bật thủ công
3. Khi bật, bản dịch sẽ được đọc thành tiếng ngay khi xuất hiện
4. Đổi nhà cung cấp bất kỳ lúc nào trong Settings → TTS

> **Chế độ dịch 2 chiều**: TTS tự động bị vô hiệu hoá khi dùng dịch hai chiều (two-way). Điều này ngăn vòng lặp âm thanh — TTS phát ra → mic thu lại → dịch lại. Nút TTS sẽ bị mờ trong chế độ hai chiều.

---

## Xử lý sự cố

- **Không có tiếng?** Kiểm tra nút TTS (🔊) đã bật và âm lượng hệ thống
- **Edge TTS không hoạt động?** Kiểm tra kết nối internet
- **Google TTS lỗi?** Kiểm tra API key đúng và đã bật Text-to-Speech API
- **Giọng TTS bị thu lại?** Giảm âm lượng TTS hoặc tạm dừng phiên dịch khi đang đọc
