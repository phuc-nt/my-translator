/**
 * 60db.ai TTS — WebSocket streaming client
 * Uses OGG_OPUS at 24kHz for low-latency text-to-speech
 * Specializes in Indic languages (Hindi, Tamil, Bengali, etc.) + English
 *
 * Protocol: connect → create_context → send_text + flush_context per synthesis → close_context
 * Context is reused across multiple speak() calls within one session.
 */

const API_BASE = 'https://api.60db.ai';
const WS_URL = 'wss://api.60db.ai/ws/tts';
const DEFAULT_VOICE_ID = 'fbb75ed2-975a-40c7-9e06-38e30524a9a1';

class SixtyDbTTS {
    constructor() {
        this.ws = null;
        this.apiKey = null;
        this.voiceId = DEFAULT_VOICE_ID;
        this.speed = 1.0;
        this.stability = 50;
        this.similarity = 50;
        this.isConnected = false;

        // Context management
        this.contextId = null;
        this.contextReady = false;

        // Callbacks (same interface as all TTS providers)
        this.onAudioChunk = null;   // (base64Audio, isFinal) => void
        this.onError = null;        // (errorMsg) => void
        this.onStatusChange = null; // (status) => void — 'connecting'|'connected'|'disconnected'|'error'

        // Queue text while WS/context is not ready
        this._textQueue = [];
        this._intentionalClose = false;
        this._reconnectAttempts = 0;
        this._maxReconnectAttempts = 3;

        // Instrumentation (same as ElevenLabs)
        this._sendTimestamps = {};
        this._stats = { requests: 0, totalTTFB: 0, minTTFB: Infinity, maxTTFB: 0, chunks: 0, totalAudioBytes: 0 };
    }

    /**
     * Configure TTS client (call before connect)
     */
    configure({ apiKey, voiceId, speed, stability, similarity }) {
        if (apiKey) this.apiKey = apiKey;
        if (voiceId) this.voiceId = voiceId;
        if (speed !== undefined) this.speed = speed;
        if (stability !== undefined) this.stability = stability;
        if (similarity !== undefined) this.similarity = similarity;
    }

    /**
     * Open WebSocket connection to 60db.ai and create TTS context
     */
    connect() {
        if (!this.apiKey) {
            console.warn('[60db] Missing API key');
            this.onError?.('60db.ai API key is missing');
            return;
        }

        if (this.ws && this.ws.readyState <= WebSocket.OPEN && this.contextReady) {
            return; // Already connected and context ready
        }

        this._intentionalClose = false;
        this._setStatus('connecting');

        const url = `${WS_URL}?apiKey=${this.apiKey}`;
        console.log('[60db] Connecting to WebSocket...');

        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log('[60db] WebSocket opened, waiting for authentication...');
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this._handleMessage(msg);
            } catch (e) {
                console.warn('[60db] Failed to parse message:', e);
            }
        };

        this.ws.onerror = (err) => {
            console.error('[60db] WebSocket error:', err);
            this.onError?.('60db.ai connection error');
            this._setStatus('error');
        };

        this.ws.onclose = (event) => {
            console.log(`[60db] WebSocket closed: code=${event.code} reason="${event.reason}"`);
            this.isConnected = false;
            this.contextReady = false;

            if (this._intentionalClose) {
                this._setStatus('disconnected');
                return;
            }

            // Auto-reconnect on unexpected close
            if (this._reconnectAttempts < this._maxReconnectAttempts) {
                this._reconnectAttempts++;
                const delay = this._reconnectAttempts * 2000;
                console.log(`[60db] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts}/${this._maxReconnectAttempts})`);
                setTimeout(() => this.connect(), delay);
            } else {
                this._setStatus('disconnected');
                this.onError?.('60db.ai disconnected after max retries');
            }
        };
    }

    /**
     * Handle incoming WebSocket messages from 60db.ai
     */
    _handleMessage(msg) {
        // Authentication confirmed — create context
        if (msg.connection_established) {
            console.log('[60db] Authenticated, creating context...');
            this._sendCreateContext();
            return;
        }

        // Context is ready — we can start sending text
        if (msg.context_created) {
            console.log('[60db] Context created:', this.contextId);
            this.contextReady = true;
            this.isConnected = true;
            this._reconnectAttempts = 0;
            this._setStatus('connected');
            this._flushQueue();
            return;
        }

        // Audio chunk received
        if (msg.audio_chunk && msg.audio_chunk.audioContent) {
            // Measure TTFB for first chunk of each request
            const pendingKey = Object.keys(this._sendTimestamps)[0];
            if (pendingKey && this._sendTimestamps[pendingKey]) {
                const ttfb = performance.now() - this._sendTimestamps[pendingKey];
                this._stats.requests++;
                this._stats.totalTTFB += ttfb;
                this._stats.minTTFB = Math.min(this._stats.minTTFB, ttfb);
                this._stats.maxTTFB = Math.max(this._stats.maxTTFB, ttfb);
                console.log(`[60db] TTFB: ${ttfb.toFixed(0)}ms for "${pendingKey.substring(0, 40)}..."`);
                delete this._sendTimestamps[pendingKey];
            }

            // Track audio data
            const audioContent = msg.audio_chunk.audioContent;
            this._stats.chunks++;
            this._stats.totalAudioBytes += audioContent.length * 0.75; // base64 → bytes approx

            if (this.onAudioChunk) {
                this.onAudioChunk(audioContent, false);
            }
            return;
        }

        // Flush completed — all audio for this synthesis has been sent
        if (msg.flush_completed) {
            // Send a final empty signal so AudioPlayer knows this synthesis is done
            // (AudioPlayer ignores empty base64 gracefully)
            if (this.onAudioChunk) {
                this.onAudioChunk('', true);
            }
            return;
        }

        // Context closed
        if (msg.context_closed) {
            console.log('[60db] Context closed');
            return;
        }

        // Error from server
        if (msg.error) {
            console.error('[60db] Server error:', msg.error);
            this.onError?.(`60db.ai: ${msg.error}`);
            return;
        }
    }

    /**
     * Send create_context message to initialize TTS session
     */
    _sendCreateContext() {
        this.contextId = this._generateContextId();

        const message = {
            create_context: {
                context_id: this.contextId,
                voice_id: this.voiceId,
                audio_config: {
                    audio_encoding: 'OGG_OPUS',
                    sample_rate_hertz: 24000,
                },
            },
        };

        // Include speed/stability/similarity if non-default
        const settings = {};
        if (this.speed !== 1.0) settings.speed = this.speed;
        if (this.stability !== 50) settings.stability = this.stability;
        if (this.similarity !== 50) settings.similarity = this.similarity;
        if (Object.keys(settings).length > 0) {
            Object.assign(message.create_context, settings);
        }

        console.log('[60db] Creating context with voice:', this.voiceId);
        this.ws.send(JSON.stringify(message));
    }

    /**
     * Send text to be spoken. Handles queueing if context not ready.
     * @param {string} text - Text to speak
     */
    speak(text) {
        if (!text?.trim()) return;

        if (this.isConnected && this.contextReady && this.ws?.readyState === WebSocket.OPEN) {
            this._sendText(text);
        } else {
            // Queue and connect if needed
            this._textQueue.push(text);
            if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
                this.connect();
            }
        }
    }

    /**
     * Send text chunk to 60db.ai and flush immediately
     */
    _sendText(text) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.contextReady) return;

        // Record send timestamp for TTFB measurement
        this._sendTimestamps[text] = performance.now();

        // Send text
        this.ws.send(JSON.stringify({
            send_text: {
                context_id: this.contextId,
                text: text,
            },
        }));

        // Flush to trigger synthesis
        this.ws.send(JSON.stringify({
            flush_context: {
                context_id: this.contextId,
            },
        }));
    }

    /**
     * Flush queued text
     */
    _flushQueue() {
        while (this._textQueue.length > 0) {
            const text = this._textQueue.shift();
            this._sendText(text);
        }
    }

    /**
     * Generate a unique context ID
     */
    _generateContextId() {
        return 'ctx-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
    }

    /**
     * Gracefully disconnect
     */
    disconnect() {
        this._intentionalClose = true;
        this._textQueue = [];

        // Log stats before disconnect
        if (this._stats.requests > 0) {
            const avgTTFB = this._stats.totalTTFB / this._stats.requests;
            console.log('[60db] Session stats:');
            console.log(`  Requests: ${this._stats.requests}`);
            console.log(`  TTFB avg: ${avgTTFB.toFixed(0)}ms, min: ${this._stats.minTTFB.toFixed(0)}ms, max: ${this._stats.maxTTFB.toFixed(0)}ms`);
            console.log(`  Audio chunks: ${this._stats.chunks}`);
            console.log(`  Audio data: ${(this._stats.totalAudioBytes / 1024).toFixed(1)}KB`);
        }

        if (this.ws) {
            // Send close_context if we have one
            if (this.contextId && this.ws.readyState === WebSocket.OPEN) {
                try {
                    this.ws.send(JSON.stringify({
                        close_context: { context_id: this.contextId },
                    }));
                } catch (e) {
                    // Ignore send errors during close
                }
            }
            this.ws.close();
            this.ws = null;
        }

        this.isConnected = false;
        this.contextReady = false;
        this.contextId = null;
        this._reconnectAttempts = 0;
        this._setStatus('disconnected');
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }

    // ─── Voice Fetching (Static Methods) ──────────────────────

    /**
     * Fetch user's custom voices from 60db.ai
     * @param {string} apiKey - 60db.ai API key
     * @returns {Promise<Array>} Array of voice objects
     */
    static async fetchVoices(apiKey) {
        if (!apiKey) return [];

        const response = await fetch(`${API_BASE}/voices`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Failed to fetch voices');
        }

        return data.data || [];
    }

    /**
     * Fetch platform default voices from 60db.ai
     * @returns {Promise<Array>} Array of default voice objects
     */
    static async fetchDefaultVoices() {
        const response = await fetch(`${API_BASE}/default-voices`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Failed to fetch default voices');
        }

        return data.data || [];
    }
}

export const sixtyDbTTS = new SixtyDbTTS();
export { SixtyDbTTS };
