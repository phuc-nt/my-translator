# Future Plans & Feature Requests

> Cập nhật lần cuối: 2026-03-22

---

## Bảng Ưu Tiên Tổng Hợp

> Cập nhật sau khi review source code thực tế.

| # | Feature | Value | Code Complexity | Perf Impact | Effort ước tính | Ưu tiên |
|---|---------|-------|----------------|-------------|----------------|---------|
| 1 | Copy / Export Transcript | ⭐⭐⭐ | 🟢 Rất thấp | 🟢 Không có | ~0.5 ngày | 🔴 P1 |
| 2 | Audio Normalization | ⭐⭐⭐ | 🟢 Rất thấp | 🟢 Không đáng kể | ~1 ngày | 🔴 P1 |
| 3 | AI Summarize / Q&A | ⭐⭐⭐ | 🟡 Thấp-Trung | 🟢 Không có (async) | ~2 ngày | 🟠 P2 |
| 4 | Furigana (Hiragana) | ⭐⭐ | 🟡 Thấp | 🟡 Nhẹ (~10-50ms/segment) | ~1 ngày | 🟡 P3 |
| 5 | File Upload Mode | ⭐⭐⭐⭐ | 🔴 Cao | 🟡 Trung bình | ~5-7 ngày | 🟡 P3 |
| 6 | OCR Screen Translate | ⭐⭐⭐ | 🔴 Rất cao | 🟡 Nhẹ (~500ms/shot) | ~7-10 ngày | 🟢 P4 |

### Lý do thay đổi so với đánh giá ban đầu

**Copy Transcript lên P1 (dễ hơn nghĩ):**
`ui.js` đã có sẵn `getPlainText()` và `getMarkdownText()`. `app.js` đã có copy button handler và `invoke('save_transcript')`. Về cơ bản chỉ cần wire lại + thêm export `.srt`.

**AI Summarize xuống P2→ thực ra dễ hơn nghĩ:**
Không cần thay đổi Rust. Chỉ cần thêm 1 JS module gọi REST API LLM + 1 panel UI sau khi session kết thúc (~150 lines JS tổng).

**File Upload xuống P3 (khó hơn nghĩ):**
Vấn đề lớn nhất là **audio extraction** — cần ffmpeg (dependency nặng) hoặc macOS AVFoundation (cần Objective-C FFI bridge trong Rust). Lazy processing logic cũng phức tạp.

**OCR xuống P4 (khó nhất):**
macOS Vision framework yêu cầu Objective-C FFI trong Rust (`objc` crate) — non-trivial. Region selection UI cũng cần thiết kế lại UX phức tạp. Cộng thêm cần thêm translation provider mới (Soniox không nhận text input).

---

## Chi Tiết từng Feature

---

### 🔴 P1 — Audio Volume Normalization

**Nguồn**: Hoang Anh — comment public
**Vấn đề**: Khi user giảm âm lượng video, ASR nhận diện kém → chất lượng dịch giảm. Root cause: app capture PCM ở mức gain thấp → signal yếu gửi lên Soniox/Whisper.

**Value**: Fixes pain point trực tiếp cho người dùng hiện tại — không cần feature mới, chỉ cần cải thiện core pipeline.

**Hướng triển khai**:
- Normalize/boost gain trên PCM stream trong Rust trước khi gửi ASR (không ảnh hưởng volume thực tế user nghe)
- Implement RMS-based gain normalization hoặc dùng `webrtc-audio-processing`
- Tùy chọn: thêm slider "Input Sensitivity" trong Settings

---

### 🔴 P1 — Copy / Export Transcript

**Nguồn**:
- Hùng Vũ — yêu cầu "copy text" trong OCR feature
- Nguyễn Thanh Long — "hiện realtime script để copy paste qua app khác"

> **Gom nhóm**: Cả hai đều có cùng nhu cầu cốt lõi: lấy text ra khỏi overlay để dùng nơi khác.

**Value**: Nhiều users yêu cầu, implement đơn giản, tăng utility ngay lập tức.

**Hướng triển khai**:
- Thêm nút **"Copy All"** copy toàn bộ transcript session vào clipboard
- Cho phép select text trực tiếp trong overlay
- Export ra file `.txt` / `.srt` sau session

---

### 🟠 P2 — File Upload Mode (Video/Audio → Sub + TTS)

**Nguồn**: Nguyễn Đức + Lâm Ngọc — comment public
**Vấn đề**: Người dùng có nội dung offline (khoá học, video ghi sẵn) muốn dịch mà không cần real-time.

**Value**: Mở rộng use case đáng kể — từ "real-time meeting tool" → "video subtitle generator". Segment người dùng học ngoại ngữ qua video offline rất lớn.

**Điểm phức tạp**: Cần tích hợp ffmpeg để extract audio, xây dựng chunked pipeline, lazy processing để tiết kiệm token.

**Hướng triển khai**:
- Thêm tab **File Mode** (bên cạnh System Audio / Mic)
- User chọn file → app extract audio → xử lý theo chunks gửi Soniox
- **Lazy processing**: buffer ahead N giây, chỉ tốn token khi cần — không process toàn bộ file upfront
- Output: file `.srt`/`.vtt` + optional TTS narration
- Tách TTS thành module độc lập, dùng được với subtitle có sẵn

---

### 🟠 P2 — OCR Screen Translate

**Nguồn**: Hùng Vũ (@hungvu.net) — Facebook Messenger
**Reference**: [TSnap](https://www.tsnap.tech/) — Instant Screenshot Translation for macOS
**Vấn đề**: Muốn dịch text trên màn hình (subtitle cứng, ảnh, PDF...) mà không cần audio.

**Value**: Khác biệt hoàn toàn với real-time audio — expand sang use case đọc/xem nội dung tĩnh.

**Điểm phức tạp**: Thay đổi paradigm UX đáng kể (chọn vùng capture), cần pipeline OCR riêng.

**Hướng triển khai**:
- Mode mới: **Screen OCR** — user kéo chọn vùng màn hình
- `ScreenCaptureKit` đã có → capture region
- OCR: macOS **Vision framework** (free, 18 ngôn ngữ, không cần thư viện ngoài)
- Dịch qua Gemini/OpenAI (Soniox không nhận text input)
- Overlay hiển thị kết quả + nút Copy

---

### 🟡 P3 — AI Summarize / Q&A

**Nguồn**: Nguyễn Thanh Long — comment public
**Yêu cầu**: Sau session dịch, gọi LLM để tóm tắt nội dung hoặc cho phép user hỏi đáp về những gì vừa nghe.

**Value**: Tăng mạnh giá trị cho use case học tập / meeting — từ "sub thô" → "hiểu sâu nội dung".

**Phụ thuộc**: Cần **Copy/Export Transcript** (P1) làm nền trước.

**Hướng triển khai**:
- Panel "Session Review" xuất hiện khi user Stop
- Thu thập toàn bộ transcript → gửi Gemini/Claude: "Summarize this"
- Q&A mode: user gõ câu hỏi, LLM trả lời dựa trên transcript
- Export `.md` với transcript + summary

---

### 🟢 P4 — Furigana (Hiragana trên Kanji)

**Nguồn**: Nhat Pham — comment public
**Yêu cầu**: Hiển thị phiên âm hiragana (furigana) phía trên kanji trong transcript tiếng Nhật.

**Value**: Hữu ích cho người học tiếng Nhật, nhưng **niche** — chỉ phù hợp app chuyên học Nhật ngữ, không phải general translation tool.

**Khả thi kỹ thuật**: Rất cao — `<ruby>` HTML tag, thư viện `kuroshiro` (JS).

**Hướng triển khai**:
- Toggle on/off trong Settings (mặc định: off)
- Dùng `kuroshiro` để convert text → ruby HTML trước khi render
- Chỉ active khi source language = Japanese

---

## Meeting Setup & Best Practices

### Two-way Translation Guide (e.g., VN - JP Video Call)
**Date**: 2026-03-22
**Use Case**: User (Vietnamese) meets with a Partner (Japanese) via Video Call (Google Meet, Zoom, MS Teams). The app is installed ONLY on the User's machine.

**Setup Instructions**:
1. **Audio Source**: Select `Both` (System + Mic) so the app captures both the User's microphone and the Partner's audio from the speakers.
2. **Translation Type**: Select `Two-way`.
3. **Languages**:
   - `Language A`: Vietnamese
   - `Language B`: Japanese

**How Both Parties Can Receive Translations**:
Because MyJavis is a local desktop application without a central server, there is no direct link to share. To let the partner understand the transcript, the User has two main methods:
- **Method 1 (Recommended) - Share Screen**: The User shares the "Entire Screen" in the meeting app, positioning the MyJavis overlay at the bottom. The partner can read the translations like live subtitles.
- **Method 2 - Text-to-Speech (TTS)**: The User enables TTS with a Japanese voice. When the User speaks Vietnamese, the app translates and reads the Japanese text aloud. This generated audio is picked up by the microphone (or handled via virtual audio routing) and sent to the partner.

**Note on Use Case**: The app acts as a "Personal Translation Assistant", giving the User highly accurate, custom context-aware translations to understand the partner. If screen sharing is not viable, the partner can additionally use the native "Live Captions" feature of Zoom/Meet as a fallback.
