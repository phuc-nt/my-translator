# Deepgram STT Setup Guide

## Why Deepgram?

**Deepgram Nova-3** is the fastest, most affordable speech-to-text engine available:

- **⚡ Fastest**: ~500ms latency (best-in-class real-time STT)
- **💰 Cheapest**: $0.0043/min (~$0.26/hour) — 10x cheaper than competitors
- **🌍 Global**: 50+ languages with detection and speaker diarization
- **📊 Smart**: Automatic formatting, punctuation, and number detection
- **🔐 Secure**: Your audio never leaves your machine (direct API connection)

## Getting Started

### 1. Create a Deepgram Account

1. Go to [console.deepgram.com](https://console.deepgram.com)
2. Sign up with email or GitHub
3. Verify your email (if email signup)

### 2. Get Your API Key

1. In the Deepgram Console, go to **API Keys** (left sidebar)
2. Click **Create New** (or use default key)
3. Copy your API key (starts with `dg_`)
4. **Important**: Keep this key private!

### 3. Add to My Translator

1. Open **Settings** (`⌘,` / `Ctrl+,`)
2. Navigate to **STT Engine** section
3. Select **⚡ Deepgram Nova-3** from the engine picker
4. Paste your API key into the **Deepgram API Key** field
5. Click **Save Settings**

### 4. Start Using

1. Return to the main overlay
2. Press **▶️ Start** to begin transcription
3. Enjoy ~500ms latency real-time speech-to-text!

## Pricing Breakdown

### Free Tier

- **$200/month free credits** (~44 hours of transcription)
- Perfect for testing and light use
- No credit card required
- Great for students and hobbyists

### Pay-as-you-go

- **$0.0043/min** (~$0.26/hour) after free tier exhausted
- No minimum commitment
- Scales automatically
- Invoice-based billing

### Example Costs

| Usage | Cost |
|-------|------|
| 1 hour/day | ~$7.80/month |
| 4 hours/day | ~$31/month |
| 8 hours/day | ~$62/month |
| Compare: Soniox same usage | ~$86/month |
| Compare: OpenAI same usage | ~$480/month |

## Supported Languages

### Directly Supported (50+)

**European**: English, Spanish, French, German, Italian, Portuguese, Russian, Dutch, Polish, Turkish, Ukrainian, Swedish, Norwegian, Danish, Finnish, Greek, Bulgarian, Czech, Estonian, Hungarian, Lithuanian, Latvian, Romanian, Slovak, Slovenian

**Asian**: Japanese, Chinese (Mandarin), Korean, Vietnamese, Thai, Arabic, Hebrew, Persian, Urdu, Bengali, Hindi, Tamil, Telugu, Malayalam, Kannada, Myanmar, Khmer, Lao

**Other**: Indonesian, Filipino, Afrikaans, and more

### Auto-Detection

Leave **Source Language** as **Auto** and Deepgram will automatically detect the language being spoken (works great for multilingual conversations).

## Features

### Speaker Diarization

Automatically identifies and labels different speakers:

```
Speaker 0: Good morning, how can I help?
Speaker 1: I'd like to book an appointment
```

Great for interviews, meetings, and conversations.

### Smart Formatting

Automatically applies:
- Punctuation and capitalization
- Number formatting ("twenty-three" → "23")
- Currency symbols ("five dollars" → "$5")
- Phone numbers and emails

### Confidence Scoring

Each transcription includes a confidence score (0-1). The UI will display this to help you assess accuracy.

## Troubleshooting

### "Invalid API key" Error

**Solution**:
1. Check your key starts with `dg_`
2. Verify no extra spaces at the beginning/end
3. Regenerate a new key in the Deepgram Console
4. Paste the new key and save

### Connection Timeout

**Solution**:
1. Check your internet connection
2. Verify Deepgram status at [status.deepgram.com](https://status.deepgram.com)
3. Try pausing and restarting the session
4. If persistent, check your firewall/proxy settings

### Transcription Cuts Out

**Solution**:
1. Ensure clean audio input (reduce background noise)
2. Check your microphone levels
3. Try a different audio source (system audio vs. microphone)
4. Contact Deepgram support if the issue persists

### Rate Limit Exceeded

**What it means**: You've exceeded your monthly credit allocation

**Solution**:
1. Check your usage in the Deepgram Console
2. Upgrade to a paid plan if needed
3. Wait until the next billing cycle if on free tier
4. Consider using offline **Local MLX** mode for unlimited transcription

## Comparison: STT Engines

| Metric | Deepgram | Soniox | OpenAI | Local MLX |
|--------|----------|--------|--------|----------|
| **Latency** | ~500ms ⚡ | ~2s | ~1.5s | ~10s |
| **Cost** | $0.0043/min💰 | $0.002/min | $0.067/min | Free |
| **Languages** | 50+ | 70+ | 13 | 4 (JA/EN/ZH/KO→VI) |
| **Built-in Translation** | ❌ | ✅ | ✅ | ✅ |
| **Diarization** | ✅ | ✅ | ❌ | ❌ |
| **No Internet** | ❌ | ❌ | ❌ | ✅ |

## Tips & Tricks

### 1. Use Auto-Language Detection

Leave **Source Language** as **Auto** for maximum flexibility. Deepgram will detect the language automatically.

### 2. Monitor Your Usage

Check your Deepgram Console monthly to:
- Track credits/spending
- See which projects use the most
- Optimize your usage patterns

### 3. Combine with Client-Side Translation

Deepgram handles **transcription only** — use the app's built-in translation (Soniox or OpenAI) for **translation**.

Example flow:
1. Deepgram transcribes audio → "Bonjour, comment allez-vous?"
2. App translates → "Hello, how are you?"
3. TTS reads translation aloud → 🔊

### 4. Use for Meetings & Interviews

Deepgram's diarization is perfect for:
- Meeting transcripts with speaker labels
- Interview recordings
- Podcast transcription
- Customer support calls

## API Key Security

✅ **Safe**: Keys are stored locally on your machine, never sent to servers
✅ **Encrypted**: App doesn't transmit keys to third parties
✅ **Revocable**: You can always regenerate a key in the Deepgram Console

❌ **NOT safe**: Sharing your key with others, committing to GitHub, or using on public machines

## Need Help?

- **Deepgram Docs**: [docs.deepgram.com](https://docs.deepgram.com)
- **Deepgram Support**: [support.deepgram.com](https://support.deepgram.com)
- **GitHub Issues**: [Video-translator issues](https://github.com/phuc-nt/my-translator/issues)

---

**Happy transcribing! 🎙️**
