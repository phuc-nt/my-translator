# Installation Guide

Step-by-step guide to install and use **MyJavis** on macOS.

---

## Requirements

- macOS 13 or later (Apple Silicon — M1/M2/M3/M4)
- **Cloud mode**: [Soniox](https://soniox.com) API key (pay-per-use, ~$0.12/hour)
- **Local mode**: ~5 GB free disk space (for AI models, one-time download)
- **TTS narration** (optional): See [TTS Guide](tts_guide.md) for provider options

---

## Step 1 — Download

Download the latest `.dmg` from: [**Releases — macOS**](https://github.com/phuc-nt/my-translator/releases/latest)

Choose the right file:
- `MyJavis_x.x.x_aarch64.dmg` — Apple Silicon (M1/M2/M3/M4)
- `MyJavis_x.x.x_x64.dmg` — Intel Mac

---

## Step 2 — Install

1. Open the `.dmg` file
2. Drag **MyJavis** into the **Applications** folder
3. Eject the DMG

---

## Step 3 — First Launch

Open MyJavis from Applications.

> ✅ The app is signed and notarized — macOS should allow it without any security warnings.

---

## Step 4 — Grant Screen Recording Permission

On first launch, macOS will ask for **Screen & System Audio Recording** permission:

1. Click **Open System Settings** when prompted
2. Find **MyJavis** in the list
3. **Toggle the switch ON**
4. macOS will ask to **Quit & Reopen** — click that button

> This permission is required for the app to capture system audio (YouTube, Zoom, podcasts, etc.)

---

## Step 5 — Get a Soniox API Key

Soniox provides real-time speech recognition and translation.

1. Go to [console.soniox.com](https://console.soniox.com) → create an account
2. Add billing:
   - Click **Billing** in the left sidebar
   - Add a payment method
   - Add funds ($10 minimum — lasts ~80+ hours at $0.12/hour)
3. Create API key:
   - Click **API Keys** in the left sidebar
   - Click **Create API Key**
   - Copy the key (format: `soniox_...`)

> 💡 Soniox charges ~$0.12/hour of audio processed. $10 ≈ 80+ hours of translation.

---

## Step 6 — Configure the App

1. Click ⚙️ (or press `⌘ ,`) to open **Settings**
2. Go to the **General** tab
3. Paste your **Soniox API key**
4. Choose translation type:
   - **One-way**: Select Source language and Target language
   - **Two-way**: Select Language A and Language B (for bilingual meetings — the app auto-detects and translates both directions)
5. Choose Translation Engine:

| Mode | Speed | Quality | Cost | Internet |
|------|-------|---------|------|----------|
| ☁️ **Soniox API (Cloud)** | Real-time (~2s) | 9/10 | ~$0.12/hr | Required |
| 🖥️ **Local MLX (Offline)** | ~10s delay | 7/10 | Free | Not needed |

6. Click **Save & Close**

> **Local MLX** requires Apple Silicon (M1+) and ~5 GB disk. Models are downloaded automatically on first use.

---

## Step 7 — Enable TTS Narration (Optional)

Want translations **read aloud**? Three TTS providers are available:

| Provider | Cost | Quality | Setup |
|----------|------|---------|-------|
| 🎙️ **Edge TTS** | Free | Natural | None |
| 🌐 **Google Chirp 3 HD** | Free 1M chars/mo | Near-human | Google Cloud API key |
| ✨ **ElevenLabs** | ~$5/mo+ | Premium | ElevenLabs API key |

### Quick setup (Edge TTS — free):

1. Settings → **TTS** tab → Provider: **Edge TTS**
2. Choose a voice → **Save & Close**
3. On main screen, click the **TTS** button (or `⌘ T`) to enable

### For Google or ElevenLabs:

See [TTS Guide](tts_guide.md) for step-by-step API key instructions.

---

## Step 8 — Start Translating!

1. Go back to the main screen
2. Click ▶ (or press `⌘ Enter`) to start
3. Play any audio on your Mac (YouTube, Zoom, podcasts...)
4. Translations appear in real-time!

**View modes:**
- **Single** (default): Translation text only
- **Dual**: Source | Translation side-by-side (toggle with panel button, bottom-right)

**Font size:** Use A-/A+ buttons (bottom-right on hover) to adjust

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘ Enter` | Start / Stop |
| `⌘ ,` | Open Settings |
| `Esc` | Close Settings |
| `⌘ 1` | Switch to System Audio |
| `⌘ 2` | Switch to Microphone |
| `⌘ T` | Toggle TTS narration |

---

## Troubleshooting

### No translation text appears
→ Check **Screen & System Audio Recording** is enabled in System Settings (see Step 4)

### "No API key" error
→ Open Settings (⚙️) and paste your Soniox API key (see Step 5)

### "No microphone found" error
→ Mac Mini has no built-in microphone. Connect an external mic (USB, headset, AirPods)

### TTS not working
→ See [TTS Guide — Troubleshooting](tts_guide.md#troubleshooting)

---

## Updating

MyJavis includes **auto-update**. When a new version is available:

1. A **green badge** appears on the ⚙️ settings icon
2. Open Settings → **About** tab → click **Download & Install**
3. The app will restart automatically with the new version

No need to download DMG files manually for future updates!
