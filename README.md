<p align="center">
  <img src="banner.png?v=2" alt="My Translator — Real-time Speech Translation">
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/phuc-nt/my-translator?color=green&label=release" alt="Latest Release">
  <img src="https://img.shields.io/badge/built_with-Tauri-orange?logo=tauri" alt="Built with Tauri">
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-black?logo=apple" alt="macOS">
  <img src="https://img.shields.io/badge/Windows-10%2F11-blue?logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/github/stars/phuc-nt/my-translator?style=flat&color=yellow" alt="Stars">
</p>

**My Translator** is a real-time speech translation desktop app built with Tauri. It captures audio directly from your system or microphone, transcribes it, and displays translations in a minimal overlay — with no intermediary server involved.

> 📖 Installation guides: [macOS (EN)](docs/installation_guide.md) · [macOS (VI)](docs/installation_guide_vi.md) · [Windows (EN)](docs/installation_guide_win.md) · [Windows (VI)](docs/installation_guide_win_vi.md)

---

## How It Works

```
                                    ┌── ☁️  Soniox  (text)              ──┐
System Audio / Mic → 16kHz PCM ─────┼── ⚡ OpenAI Realtime (text+🔊)      ─┼─→ Overlay UI
                                    ├── 🌏 Qwen LiveTranslate Flash (text only) │
                                    └── 🖥️  Local MLX  (text, offline)   ─┘
                                                                            ↓ (optional, text engines)
                                                  TTS (Edge / Google / ElevenLabs / 60db.ai) → 🔊
```

Four translation engines, pick what fits your call:

| Feature | Detail |
|---------|--------|
| **Engines** | ☁️ Soniox · ⚡ OpenAI Realtime · 🌏 Qwen LiveTranslate Flash · 🖥️ Local MLX |
| **Latency** | ~2 s (Soniox / OpenAI) · ~4 s (Qwen) · ~10 s (Local) |
| **Languages** | 70+ source → any target (Soniox), 13 targets (OpenAI), 60+ source+target (Qwen), JA/EN/ZH/KO → VI/EN (Local) |
| **Cost** | ~$0.12/hr (Soniox) · ~$4/hr (OpenAI, includes voice) · Free preview (Qwen, text-only) · Free (Local) |
| **TTS** | 4 providers for Soniox / Local (Edge free, Google, ElevenLabs, 60db.ai) — OpenAI streams its own voice (off by default), Qwen text-only |
| **Platform** | macOS (ARM + Intel) · Windows · Local mode = Apple Silicon only |
| **Signed** | ✅ macOS signed & notarized |
| **Auto-Update** | ✅ Built-in, check & install from Settings |

> 📊 Detailed head-to-head: [**OpenAI Realtime vs Soniox benchmark**](docs/benchmark_openai_vs_soniox.md) — speed, quality, cost, and translation-mechanism comparison from a 5-min real-world test.

---

## Features

### 📖 Dual Panel View

Two display modes:
- **Single** (default) — Translation text only, clean and focused
- **Dual** — Source | Translation side-by-side, each panel scrolls independently

Toggle with the panel button (bottom-right on hover).

### 🔄 Smart Scroll

Auto-scroll only when you're at the bottom. Scroll up to read old content without being yanked back down.

### 🔤 Quick Font Size

A- / A+ floating controls (bottom-right on hover). Font size adjustable up to 140px — great for presentations.

### 🔄 Two-Way Translation

Translate conversations between two languages simultaneously — ideal for bilingual meetings.

- **One-way**: Source language → Target language (e.g., Japanese → Vietnamese)
- **Two-way**: Language A ↔ Language B (e.g., Vietnamese ↔ Japanese) — the app detects who is speaking and translates to the other language automatically

**Setup for video calls** (Zoom, Google Meet, MS Teams):
1. Audio Source: **Both** (System + Mic)
2. Translation Type: **Two-way**
3. Set Language A and Language B

> **Note**: TTS narration is automatically disabled in two-way mode to prevent audio feedback loops (TTS output → mic recapture → re-translation).

### 🎙️ TTS Narration

Read translations aloud in one-way mode — 4 providers:

| | Edge TTS ⭐ | Google Chirp 3 HD | ElevenLabs | 60db.ai |
|-|-------------|-------------------|------------|---------|
| **Cost** | Free | Free 1M chars/mo | ~$5/mo+ | $0.00002/char |
| **Quality** | ★★★★☆ Neural | ★★★★★ Near-human | ★★★★★ Premium | ★★★★☆ Natural |
| **Vietnamese** | ✅ 2 voices | ✅ 6 voices | ✅ Yes | ❌ |
| **Indian Languages** | ❌ | ❌ | ❌ | ✅ Hindi, Tamil, Bengali + 7 more |
| **Setup** | None | Google Cloud API key | API key | API key |
| **Speed control** | ✅ | ✅ 0.5x–2.0x | ❌ | ✅ 0.5x–2.0x |

TTS is **OFF by default** — toggle with the TTS button or `⌘ T`.

> 📖 TTS guide: [English](docs/tts_guide.md) · [Tiếng Việt](docs/tts_guide_vi.md)

### 📖 Custom Translation Terms

Define how domain-specific words should be translated:

```
Original sin = Tội nguyên tổ
Christ = Kitô
Pneumonia = Viêm phổi
```

Add terms in Settings → Translation → Translation terms. Great for religious, medical, or technical content.

### ⚡ OpenAI Realtime Mode

Single-call streaming translation via OpenAI's `gpt-realtime-translate` (May 2026 GA). Returns **translated text *and* translated speech audio** over one WebSocket — no separate TTS step, lower end-to-end latency, more idiomatic output. Trade-off: **~$4/hr**, charged to your own OpenAI account. 13 target languages: en, es, pt, fr, de, it, ru, hi, id, vi, ja, ko, zh.

Two-way mode and the custom TTS toggle are unavailable while OpenAI Realtime is selected (audio is native).

### 🌏 Qwen LiveTranslate Flash Mode

Alibaba DashScope `qwen3-livetranslate-flash-realtime` — streams **translated text** (no native voice) on Qwen's **free preview tier**, with a **60-language picker** matching the mobile app. Server-side VAD handles turn detection, so it works with mic / system audio / both. Translation-only display (no source-transcript panel; the model doesn't expose ASR). Get a key from [Alibaba Cloud Bailian](https://bailian.console.alibabacloud.com) (Singapore region only — other regions hit a different endpoint and fail).

Source language must be picked explicitly (auto-detect is disabled on this engine — Live Flash stalls on real mic input when source is "auto"). Two-way mode and the custom TTS toggle are also disabled while Qwen is selected.

### 🖥️ Local Mode (Apple Silicon only)

Experimental offline mode using MLX + Whisper + Gemma — runs 100% on-device. JA/EN/ZH/KO → VI/EN.

---

## Privacy

**Your audio never touches our servers — because there are none.**

- App connects **directly** to APIs you configure — no relay, no middleman
- **You own your API keys** — stored locally, never transmitted elsewhere
- **No account, no telemetry, no analytics** — zero tracking
- Transcripts saved as `.md` files locally, per session

---

## Tech Stack

- **[Tauri 2](https://tauri.app/)** — Rust backend + WebView frontend
- **[ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit)** — macOS system audio
- **[WASAPI](https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi)** — Windows system audio
- **[cpal](https://github.com/RustAudio/cpal)** — Cross-platform microphone
- **[Soniox](https://soniox.com)** — Real-time STT + translation
- **[OpenAI Realtime Translate](https://platform.openai.com/docs/guides/realtime)** — `gpt-realtime-translate` (text + native voice)
- **[MLX](https://github.com/ml-explore/mlx)** — On-device Whisper + Gemma for offline mode
- **[Edge TTS](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/index-text-to-speech)** — Free neural TTS (default)
- **[Google Cloud TTS](https://cloud.google.com/text-to-speech)** — Chirp 3 HD (near-human quality)
- **[ElevenLabs](https://elevenlabs.io)** — Premium TTS
- **[60db.ai](https://60db.ai)** — Indian language TTS specialist

---

## Build from Source

```bash
git clone https://github.com/phuc-nt/my-translator.git
cd my-translator
npm install
npm run tauri build
```

Requires: Rust (stable), Node.js 18+, macOS 13+ or Windows 10+.

---

## Star History

<a href="https://www.star-history.com/?repos=phuc-nt%2Fmy-translator&type=date&legend=top-left">
 <picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=phuc-nt/my-translator&type=date&theme=dark&legend=top-left" />
  <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=phuc-nt/my-translator&type=date&legend=top-left" />
  <img alt="Star History Chart" src="https://api.star-history.com/image?repos=phuc-nt/my-translator&type=date&legend=top-left" />
 </picture>
</a>

---

## License

MIT
