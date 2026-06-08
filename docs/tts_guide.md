# TTS (Text-to-Speech) Guide

My Translator can **read translations aloud** as they appear — like having a personal interpreter. Four providers available:

## Provider Comparison

| | Edge TTS ⭐ | Google Chirp 3 HD | ElevenLabs | 60db.ai |
|-|-------------|-------------------|------------|---------|
| **Cost** | Free | Free 1M chars/mo, then $30/1M | ~$5–$22/month | $0.00002/char |
| **Quality** | Natural, clear | Near-human, expressive | Very natural, expressive | Natural, clear |
| **Vietnamese** | ✅ HoaiMy, NamMinh | ✅ 6 voices (Aoede, Kore, Charon...) | ✅ Yes | ❌ |
| **Indian Languages** | ❌ | ❌ | ❌ | ✅ Hindi, Tamil, Bengali + 7 more |
| **Setup** | None — works instantly | Google Cloud API key | ElevenLabs API key | 60db.ai API key |
| **Speed control** | ✅ -50% to +100% | ✅ 0.5x to 2.0x | ❌ | ✅ 0.5x to 2.0x |
| **Latency** | ~300-500ms | ~200-500ms | ~500-800ms | ~200-500ms |
| **Best for** | Most users | Best Vietnamese quality | Voice cloning | Indian language specialist |

**Bottom line**: Edge TTS is great for most users. Google Chirp 3 HD offers significantly better Vietnamese quality with a generous free tier. ElevenLabs is for advanced use cases like voice cloning. **60db.ai** is the go-to for Indian languages (Hindi, Tamil, Bengali, Telugu, etc.) with dynamic voice selection.

---

## Edge TTS (Default — Free)

### What is it?

Edge TTS uses the same neural speech engine behind Microsoft Edge's **"Read Aloud"** feature. My Translator connects to the same service to read translations.

- **No API key needed** — works out of the box
- **No explicit limits** — free for personal use
- Microsoft may change policies anytime, but it has been stable

### Available Voices

| Voice | Language | Gender |
|-------|----------|--------|
| HoaiMy | Vietnamese 🇻🇳 | Female |
| NamMinh | Vietnamese 🇻🇳 | Male |
| Jenny | English 🇺🇸 | Female |
| Guy | English 🇺🇸 | Male |
| Nanami | Japanese 🇯🇵 | Female |
| SunHi | Korean 🇰🇷 | Female |
| Xiaoxiao | Chinese 🇨🇳 | Female |

### Speed

Adjust in Settings → TTS → Speed. Default **+20%**.

---

## Google Cloud TTS — Chirp 3 HD (Premium)

### What is it?

Google's latest text-to-speech model with **near-human quality**. Chirp 3 HD captures nuances in human intonation, making speech sound remarkably natural — especially for Vietnamese.

### Pricing

- **Free**: 1 million characters/month (~250K words — plenty for personal use)
- **After free tier**: $30 per 1 million characters

### How to Get API Key

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use existing) — click dropdown at top-left → **New Project** → name it `my-translator` → **Create**
3. Enable the Text-to-Speech API:
   - Visit [console.cloud.google.com/apis/library/texttospeech.googleapis.com](https://console.cloud.google.com/apis/library/texttospeech.googleapis.com)
   - Click **Enable**
4. Create API Key:
   - Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
   - Click **+ Create Credentials** → **API Key**
   - Copy the key (format: `AIzaSy...`)
5. *(Recommended)* Restrict the key:
   - Click on the key → **Restrict key**
   - Under **API restrictions** → select **Cloud Text-to-Speech API** only
   - **Save**

### Setup in App

1. In app: Settings → TTS → select **🌐 Google Chirp 3 HD**
2. Paste your API key
3. Choose a voice and speed
4. Click **Save & Close**

### Available Voices

Vietnamese (6 voices), English (4 voices), Japanese (2), Korean (2), Chinese (2) — all Chirp 3 HD quality.

---

## ElevenLabs (Premium)

### What is it?

ElevenLabs specializes in **AI voice technology**, known for extremely natural voices with rich emotion. Paid service with API key.

### How to Get API Key

1. Go to [elevenlabs.io](https://elevenlabs.io) → create an account
2. Subscribe to **Starter plan** ($5/month, includes ~30 min TTS) or higher
3. Go to profile icon (top-right) → **API Keys**
4. Click **Create API Key** → copy the key

### Setup in App

1. In app: Settings → TTS → select **✨ ElevenLabs**
2. Paste your API key
3. Choose a voice
4. Click **Save & Close**

---

## 60db.ai (Indian Languages)

### What is it?

60db.ai specializes in **Indian language text-to-speech**, supporting Hindi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Marathi, Punjabi, and English. Language is auto-detected from the input text.

### Key Features

- **Dynamic voice selection** — voices are fetched from your account, including any custom cloned voices
- **10 Indian languages** + English
- **WebSocket streaming** for low-latency real-time playback
- **Speed, stability, and similarity controls** for fine-tuning voice output

### Pricing

- **$0.00002 per character** (~$0.02 per 1K characters)
- **$0.01 minimum per context**

### How to Get API Key

1. Go to [60db.ai](https://60db.ai) → create an account
2. Go to Dashboard → **API Keys**
3. Create a new API key (format: `sk_live_...`)

### Setup in App

1. In app: Settings → TTS → select **🇮🇳 60db.ai**
2. Paste your API key — voices will load automatically
3. Choose a voice, adjust speed/stability/similarity if needed
4. Click **Save & Close**

### Supported Languages

| Language | Code |
|----------|------|
| English | en |
| Hindi | hi |
| Bengali | bn |
| Tamil | ta |
| Telugu | te |
| Gujarati | gu |
| Kannada | kn |
| Malayalam | ml |
| Marathi | mr |
| Punjabi | pa |

---

## How to Use TTS

1. **Toggle TTS**: Click the **TTS** button on the toolbar or press `⌘ T`
2. TTS is **OFF by default** on each app launch — you must enable it each session
3. When enabled, translations are read aloud as they appear
4. Switch providers anytime in Settings → TTS

> **Two-way mode**: TTS is automatically disabled when using two-way translation. This prevents audio feedback loops where TTS output gets recaptured by the microphone and re-translated. The TTS button will appear grayed out in two-way mode.

---

## Troubleshooting

- **No sound?** Check the TTS button (🔊) is active and system volume is up
- **Edge TTS not working?** Check your internet connection
- **Google TTS error?** Verify your API key is correct and Text-to-Speech API is enabled
- **TTS voice getting re-transcribed?** Lower TTS volume or pause transcription while TTS is speaking
