/**
 * Deepgram WebSocket Client
 * Real-time speech-to-text streaming with Nova-3 model
 * 
 * Features:
 * - Low latency (~500ms)
 * - 50+ language support
 * - Speaker diarization
 * - Smart formatting
 * - Auto-reconnect
 */

const DEEPGRAM_ENDPOINT = 'wss://api.deepgram.com/v1/listen';
const MAX_RECONNECT = 3;
const RECONNECT_DELAY_MS = 2000;
const KEEPALIVE_INTERVAL_MS = 15000;

export class DeepgramClient {
    constructor() {
        this.ws = null;
        this.apiKey = '';
        this.isConnected = false;
        this._reconnectAttempts = 0;
        this._config = null;
        this._intentionalDisconnect = false;
        this._keepaliveTimer = null;

        // Callbacks (match Soniox interface)
        this.onOriginal = null;       // (text, speaker, language) => {}
        this.onTranslation = null;    // (text) => {} — handled at app level
        this.onProvisional = null;    // (text, speaker) => {}
        this.onStatusChange = null;   // (status) => {}
        this.onError = null;          // (error) => {}
        this.onConfidence = null;     // (score) => {}
    }

    /**
     * Connect to Deepgram WebSocket
     */
    connect(config) {
        const { apiKey } = config;
        this.apiKey = apiKey;
        this._config = config;
        this._intentionalDisconnect = false;
        this._reconnectAttempts = 0;

        if (!apiKey) {
            this._setStatus('error');
            this.onError?.('Deepgram API key is required. Please add it in Settings.');
            return;
        }

        this._doConnect(config);
    }

    _doConnect(config) {
        const { apiKey, sourceLanguage, targetLanguage, model } = config;

        this._setStatus('connecting');
        console.log('[Deepgram] Connecting to', DEEPGRAM_ENDPOINT);

        const params = new URLSearchParams({
            model: model || 'nova-3',
            encoding: 'linear16',
            sample_rate: '16000',
            channels: '1',
            interim_results: 'true',
            smart_format: 'true',
            diarize: 'true',
        });

        // Add language hint if specified and not auto-detect
        if (sourceLanguage && sourceLanguage !== 'auto') {
            const mappedLang = this._mapLanguageCode(sourceLanguage);
            params.append('language', mappedLang);
            console.log('[Deepgram] Language hint:', mappedLang);
        }

        const url = `${DEEPGRAM_ENDPOINT}?${params.toString()}`;

        let newWs;
        try {
            newWs = new WebSocket(url, ['token', apiKey]);
            console.log('[Deepgram] WebSocket created, readyState:', newWs.readyState);
        } catch (err) {
            console.error('[Deepgram] Failed to create WebSocket:', err);
            this._setStatus('error');
            this.onError?.(`Failed to create WebSocket: ${err.message}`);
            return;
        }

        newWs.onopen = () => {
            console.log('[Deepgram] WebSocket OPEN');

            const oldWs = this.ws;
            if (oldWs && oldWs !== newWs) {
                console.log('[Deepgram] Seamless switch: closing old WebSocket');
                try {
                    oldWs._isOld = true;
                    oldWs.close(1000, 'Session reset');
                } catch (e) {
                    // ignore
                }
            }

            this.ws = newWs;
            this.isConnected = true;
            this._reconnectAttempts = 0;
            this._setStatus('connected');
            console.log('[Deepgram] Connected and ready for audio');

            this._startKeepalive();
        };

        newWs.onmessage = (event) => {
            if (newWs._isOld) return;

            try {
                const data = JSON.parse(event.data);
                
                // Check for errors in response
                if (data.error) {
                    console.error('[Deepgram] Server error:', data.error);
                    this._handleApiError(data);
                    return;
                }

                // Handle results
                if (data.type === 'Results' && data.result) {
                    this._handleResponse(data);
                }
            } catch (err) {
                console.error('[Deepgram] Failed to parse response:', err);
            }
        };

        newWs.onerror = (event) => {
            if (newWs._isOld) return;
            console.error('[Deepgram] WebSocket ERROR:', event);
            this.onError?.('WebSocket error occurred');
        };

        newWs.onclose = (event) => {
            if (newWs._isOld) {
                console.log('[Deepgram] Old WebSocket closed (expected)');
                return;
            }

            console.log('[Deepgram] WebSocket CLOSED, code:', event.code, 'reason:', event.reason, 'wasClean:', event.wasClean);
            this.isConnected = false;

            if (this.ws === newWs) {
                this.ws = null;
            }

            if (this._intentionalDisconnect) {
                this._setStatus('disconnected');
                return;
            }

            // Handle close codes
            if (event.code === 1000) {
                this._setStatus('disconnected');
            } else if (event.code === 1006) {
                this._tryReconnect('Connection lost unexpectedly');
            } else if (event.code === 4003 || event.code === 401) {
                this._setStatus('error');
                this.onError?.('❌ Invalid API key. Please check your key in Settings.');
            } else if (event.code === 4029 || event.code === 429) {
                this._setStatus('error');
                this.onError?.('⏳ Rate limit exceeded. Please wait and try again.');
            } else {
                this._tryReconnect(`Connection closed (code: ${event.code})`);
            }
        };
    }

    /**
     * Send raw PCM audio data
     */
    sendAudio(pcmData) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(pcmData);
        }
    }

    /**
     * Gracefully disconnect
     */
    disconnect() {
        this._intentionalDisconnect = true;
        this._stopKeepalive();

        if (this.ws) {
            try {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.close(1000, 'User disconnected');
                }
            } catch (err) {
                console.error('Error during disconnect:', err);
            }
            this.ws = null;
        }
        this.isConnected = false;
        this._setStatus('disconnected');
    }

    /**
     * Process Deepgram response
     */
    _handleResponse(data) {
        if (!data.result || !data.result.results) return;

        const results = data.result.results;
        if (!results || results.length === 0) return;

        const result = results[0];
        if (!result.alternatives || result.alternatives.length === 0) return;

        const alternative = result.alternatives[0];
        const transcription = alternative.transcript || '';

        if (!transcription.trim()) return;

        // Extract confidence
        const confidence = alternative.confidence || 0;
        this.onConfidence?.(confidence);

        // Extract speaker (if diarization enabled and available)
        let speaker = null;
        if (alternative.words && alternative.words.length > 0) {
            const firstWord = alternative.words[0];
            if (firstWord.speaker !== undefined) {
                speaker = `Speaker ${firstWord.speaker}`;
            }
        }

        // Extract language (if language detection enabled)
        const language = data.result.language_detected || null;

        // Handle interim vs final results
        if (result.is_final) {
            // Final result — emit as original text
            this.onOriginal?.(transcription, speaker, language);
        } else {
            // Interim result — emit as provisional
            this.onProvisional?.(transcription, speaker);
        }
    }

    /**
     * Map ISO 639-1 language codes to Deepgram language codes
     */
    _mapLanguageCode(code) {
        const map = {
            'en': 'en',
            'es': 'es',
            'fr': 'fr',
            'de': 'de',
            'it': 'it',
            'pt': 'pt',
            'ru': 'ru',
            'ja': 'ja',
            'zh': 'zh',
            'ko': 'ko',
            'vi': 'vi',
            'th': 'th',
            'ar': 'ar',
            'hi': 'hi',
            'nl': 'nl',
            'pl': 'pl',
            'tr': 'tr',
            'uk': 'uk',
            'id': 'id',
            'fil': 'fil',
            'ro': 'ro',
            'sv': 'sv',
            'no': 'no',
            'da': 'da',
            'fi': 'fi',
            'el': 'el',
            'bg': 'bg',
            'cs': 'cs',
            'et': 'et',
            'hu': 'hu',
            'lt': 'lt',
            'lv': 'lv',
            'sk': 'sk',
            'sl': 'sl',
            'he': 'he',
            'fa': 'fa',
            'ur': 'ur',
            'bn': 'bn',
            'ta': 'ta',
            'te': 'te',
            'ml': 'ml',
            'kn': 'kn',
            'my': 'my',
            'km': 'km',
            'lo': 'lo',
        };
        return map[code] || code;
    }

    // ─── Keepalive ────────────────────────────────────────────

    _startKeepalive() {
        this._stopKeepalive();
        this._keepaliveTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                try {
                    this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
                } catch (e) {
                    // ignore
                }
            }
        }, KEEPALIVE_INTERVAL_MS);
    }

    _stopKeepalive() {
        if (this._keepaliveTimer) {
            clearInterval(this._keepaliveTimer);
            this._keepaliveTimer = null;
        }
    }

    // ─── Error Handling ──────────────────────────────────────

    _handleApiError(data) {
        const error = data.error || 'Unknown error';
        console.error('[Deepgram] API error:', error);

        const message = error.message || error;

        if (message.includes('authentication') || message.includes('API key')) {
            this._setStatus('error');
            this.onError?.('❌ Authentication failed. Check your Deepgram API key in Settings.');
        } else if (message.includes('rate limit') || message.includes('quota')) {
            this._setStatus('error');
            this.onError?.('⏳ Rate limit exceeded. Please wait before retrying.');
        } else {
            this._setStatus('error');
            this.onError?.(`⚙️ Error: ${message}`);
        }
    }

    _tryReconnect(reason) {
        if (this._reconnectAttempts >= MAX_RECONNECT) {
            this._setStatus('error');
            this.onError?.(`${reason}. Reconnect failed after ${MAX_RECONNECT} attempts.`);
            return;
        }

        this._reconnectAttempts++;
        const delay = RECONNECT_DELAY_MS * this._reconnectAttempts;

        console.log(`[Deepgram] Reconnecting (${this._reconnectAttempts}/${MAX_RECONNECT}) in ${delay}ms...`);
        this._setStatus('connecting');
        this.onError?.(`${reason}. Reconnecting (${this._reconnectAttempts}/${MAX_RECONNECT})...`);

        setTimeout(() => {
            if (!this._intentionalDisconnect && this._config) {
                this._doConnect(this._config);
            }
        }, delay);
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }
}

// Singleton
export const deepgramClient = new DeepgramClient();
