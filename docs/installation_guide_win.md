# Installation Guide — Windows

Step-by-step guide to install and use **MyJavis** on Windows 10/11.

---

## Requirements

- Windows 10 or later (x64 or ARM64)
- [Soniox](https://soniox.com) API key (pay-per-use, ~$0.12/hour)
- **TTS narration** (optional): Edge TTS (free, no API key) or premium providers. See [TTS Guide](tts_guide.md)

---

## Step 1 — Download

Download the latest `.exe` installer from: [**Releases — Windows**](https://github.com/phuc-nt/my-translator/releases/latest)

Choose the right version:
- **x64** — Most Windows PCs (Intel/AMD)  
- **arm64** — Windows on ARM (Surface Pro X, Snapdragon laptops)

---

## Step 2 — Bypass SmartScreen

> ⚠️ The app is not yet signed with a certificate. Windows SmartScreen will block it on first run.

When you see the **"Windows protected your PC"** screen:

1. Click **"More info"**

![SmartScreen warning — click More info](user_manual_win/mytrans_win_01.png)

2. Click **"Run anyway"**

![Click Run anyway](user_manual_win/mytrans_win_02.png)

---

## Step 3 — Install

The setup wizard will guide you:

1. Click **Next** to start

![Welcome to MyJavis Setup](user_manual_win/mytrans_win_03.png)

2. Choose install location (default is fine) → click **Next**

![Choose Install Location](user_manual_win/mytrans_win_04.png)

3. Wait for installation to complete → click **Next**

![Installation Complete](user_manual_win/mytrans_win_05.png)

4. Check **"Run MyJavis"** → click **Finish**

![Completing Setup — Run MyJavis](user_manual_win/mytrans_win_06.png)

---

## Step 4 — Configure API Key & Languages

The app opens. Click ⚙️ to open **Settings**.

Configure:

1. **SONIOX API KEY** — Paste your API key (Required)
2. **Source** — Choose the source language (or leave as Auto-detect)
3. **Target** — Choose the target language (e.g., Vietnamese, English...)
4. **Audio Source** — Choose System Audio (computer sound) or Microphone

![Settings — API Key and Languages](user_manual/mytrans_setting_1.png)

Scroll down for more options:

- **Font Size** — Adjust text size
- **Max Lines** — How many lines to show
- **Show original text** — Display source text alongside translation
- **Custom Context** — Add domain/terms for better accuracy

![Settings — TTS Narration section](user_manual/mytrans_setting_2.png)

Click **Save & Close** when done.

> 💡 **Where to get a Soniox API key?**
> 1. Go to [console.soniox.com](https://console.soniox.com) → create an account
> 2. Add funds ($10 minimum, lasts a long time at ~$0.12/hour)
> 3. Go to **API Keys** → create and copy your key

![Soniox Console — Billing overview](user_manual/mytrans_key_1.png)

---

## Step 5 — Enable TTS Narration (Optional)

Want translations **read aloud**? Enable TTS narration:

1. In Settings, scroll to **TTS Narration** section
2. Check **"Enable narration (read translations aloud)"**

![Settings — TTS disabled](user_manual/mytrans_setting_2.png)

3. Enter your **ElevenLabs API key**
4. Choose a **voice** (2 female, 2 male — all support Vietnamese)
5. Click **Save & Close**

![Settings — TTS enabled with API key and voice](user_manual/mytrans_setting_3.png)

> 💡 **Where to get an ElevenLabs API key?**
> 1. Go to [elevenlabs.io](https://elevenlabs.io) → create an account
> 2. Subscribe to the **Starter plan** ($5/month, ~60 min of TTS)
> 3. Go to **Developers → API Keys** → create a key with "Text to Speech" access

![ElevenLabs — Subscription plan](user_manual/mytrans_key_2.png)
![ElevenLabs — Create API key](user_manual/mytrans_key_3.png)

> 💡 TTS is optional. If disabled, the app works exactly like before — transcript & translate only.

---

## Step 6 — Start Translating!

Click ▶ to start. The app will show **Listening...**

Now play any audio on your PC (YouTube, Zoom, podcasts...) and translations appear in real-time!

If TTS is enabled, you can toggle it on/off with the **TTS** button or `Ctrl+T`.

![App translating with TTS enabled](user_manual/mytrans_tts_1.png)

---

## Tips

- **System Audio** captures whatever is playing on your PC — no virtual cable needed
- **Microphone** captures live speech from your mic
- **TTS** reads translations aloud — toggle with the TTS button or `Ctrl+T`
- The app works as an **overlay** — drag it anywhere, resize as needed
- Translations are **saved automatically** — click 📋 to view the transcript file

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Start / Stop |
| `Ctrl+,` | Open Settings |
| `Esc` | Close Settings |
| `Ctrl+T` | Toggle TTS narration |

---

## Troubleshooting

### SmartScreen blocks the installer
→ Click **"More info"** → **"Run anyway"** (see Step 2).

### No translation text appears
→ Check that your Soniox API key is correct in Settings (⚙️).

### No system audio captured
→ Make sure audio is playing on your PC. Some apps use exclusive audio mode — try a different source.

### App doesn't start
→ Make sure WebView2 Runtime is installed. It comes with Windows 10/11, but on older versions you may need to install it from [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

---

## Updating

MyJavis includes **auto-update**. When a new version is available:

1. A **green badge** appears on the ⚙️ settings icon
2. Open Settings → **About** tab → click **Download & Install**
3. The app will restart automatically with the new version

No need to download installers manually for future updates!
