# Deepgram Integration Guide

## Overview

This document describes the Deepgram STT integration for Video Translator.

## Architecture

### Frontend (JavaScript)

```
audio capture (PCM)
    ↓
[deepgram-client.js] (WebSocket)
    ↓
Transcription results
    ↓
[app.js] callbacks
    ↓
UI updates + session store
```

### Files Added

- **`src/js/deepgram-client.js`**: WebSocket client (singleton)
- **`docs/deepgram-setup.md`**: User-facing setup guide
- **`.env.example`**: Template for environment variables

### Settings Extended

**In `src-tauri/src/settings.rs`** (if you implement persistence):

```rust
pub struct Settings {
    pub deepgram_api_key: String,
    pub deepgram_model: String,  // "nova-3", "nova-2", etc.
    // ... existing fields ...
}
```

## Usage in app.js

### 1. Import

```javascript
import { deepgramClient } from './deepgram-client.js';
```

### 2. Start Deepgram Mode

Add this method to the `App` class:

```javascript
async _startDeepgramMode(settings) {
    const apiKey = settings.deepgram_api_key;
    if (!apiKey) {
        this._showToast('Deepgram API key required', 'error');
        return;
    }

    this._updateStatus('connecting');
    
    deepgramClient.connect({
        apiKey,
        sourceLanguage: settings.source_language || 'auto',
        targetLanguage: settings.target_language || 'vi',
        model: settings.deepgram_model || 'nova-3',
    });

    // Wire callbacks
    deepgramClient.onStatusChange = (status) => {
        this._updateStatus(status);
    };

    deepgramClient.onOriginal = (text, speaker) => {
        this.transcriptUI.addOriginal(text, speaker);
        this._speakIfEnabled(text);
    };

    deepgramClient.onProvisional = (text, speaker) => {
        this.transcriptUI.setProvisional(text, speaker);
    };

    deepgramClient.onError = (error) => {
        this._showToast(error, 'error');
    };

    // Start audio capture and send to Deepgram
    try {
        const channel = new window.__TAURI__.core.Channel();
        channel.onmessage = (pcmData) => {
            deepgramClient.sendAudio(pcmData);
        };
        
        await invoke('start_capture', {
            source: this.currentSource,
            channel,
        });
    } catch (err) {
        this._showToast(`Audio error: ${err}`, 'error');
        await this.pause();
    }
}
```

### 3. Update Engine Selection

In the `start()` method, add:

```javascript
if (this.translationMode === 'deepgram') {
    await this._startDeepgramMode(settings);
}
```

### 4. Update Disconnect Logic

In the `pause()` method, add:

```javascript
else if (this.translationMode === 'deepgram') {
    deepgramClient.disconnect();
}
```

## Callback Interface

Deepgram client implements the same callback pattern as Soniox:

```javascript
client.onOriginal = (text, speaker, language) => {
    // Final transcribed text
    // speaker: "Speaker 0", "Speaker 1", or null
    // language: ISO 639-1 code or null
};

client.onProvisional = (text, speaker) => {
    // Interim transcribed text (before finalization)
};

client.onStatusChange = (status) => {
    // "connecting" | "connected" | "disconnected" | "error"
};

client.onError = (error) => {
    // Error message to display
};

client.onConfidence = (score) => {
    // Confidence 0-1
};
```

## Language Mapping

Deepgram uses ISO 639-1 codes directly. The client includes a mapping function for any non-standard codes:

```javascript
_mapLanguageCode(code) {
    // Maps 'en' → 'en', 'zh' → 'zh', etc.
    // Fallback: return the code unchanged
}
```

## Error Handling

### Connection Errors

- **Invalid API Key**: WebSocket close code 4003 or auth error
- **Rate Limit**: WebSocket close code 4029 or 429
- **Network Failure**: Close code 1006 (triggers auto-reconnect)

### Auto-Reconnect

The client automatically reconnects up to 3 times with exponential backoff:

```
1st attempt: 2s wait
2nd attempt: 4s wait
3rd attempt: 6s wait
Give up: Error message
```

## Testing

### Manual Test

```javascript
const deepgramClient = new DeepgramClient();

deepgramClient.onOriginal = (text) => console.log('Transcribed:', text);
deepgramClient.onError = (err) => console.error('Error:', err);

deepgramClient.connect({
    apiKey: 'dg_xxx',
    sourceLanguage: 'en',
    model: 'nova-3',
});

// Send 16kHz PCM audio...
```

### Integration Test

1. Open app Settings
2. Add Deepgram API key
3. Select "Deepgram Nova-3" engine
4. Click **Start**
5. Speak into microphone
6. Verify transcription appears in real-time
7. Click **Stop**

## Performance Notes

- **Latency**: ~500ms from speech end to final transcription
- **Bandwidth**: ~12 KB/sec (16 kHz mono PCM)
- **Connections**: 1 WebSocket per session
- **Reconnects**: Automatic up to 3 attempts

## Comparison to Other Engines

### vs. Soniox

| Feature | Deepgram | Soniox |
|---------|----------|--------|
| Latency | 500ms | 2000ms |
| Cost | $0.0043/min | $0.002/min |
| Translation | Client-side | Built-in |
| Language Support | 50+ | 70+ |
| Diarization | ✅ | ✅ |

**Choose Deepgram** if you need the fastest transcription and don't mind using a separate translation service.

### vs. OpenAI Realtime

| Feature | Deepgram | OpenAI |
|---------|----------|--------|
| Latency | 500ms | 1500ms |
| Cost | $0.0043/min | $0.067/min |
| Translation | Client-side | Built-in (audio) |
| Language Support | 50+ | 13 |

**Choose Deepgram** for cheaper, faster transcription with more language support.

## Future Enhancements

### Batch API

For non-real-time transcription of pre-recorded audio:

```javascript
// deepgram-batch.js (future)
const transcription = await deepgram.transcribeFile('audio.wav');
```

### Custom Vocabulary

Add domain-specific terms for better accuracy:

```javascript
deepgramClient.connect({
    vocabulary: ['Kubernetes', 'microservice', 'DevOps'],
    // ...
});
```

### Sentiment Analysis

Enable sentiment detection on transcribed text (Deepgram API supports this).

## Resources

- [Deepgram Documentation](https://docs.deepgram.com)
- [Nova-3 Benchmarks](https://deepgram.com/product/nova)
- [Pricing Calculator](https://deepgram.com/pricing)
- [Community Slack](https://slack.deepgram.com)

---

**Last updated**: 2026-01-XX
**Deepgram API version**: v1
**Nova model**: nova-3
