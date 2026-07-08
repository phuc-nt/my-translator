/**
 * App — main application controller
 * Wires together: settings, UI, Soniox client, and audio capture
 */

import { settingsManager } from './settings.js';
import { TranscriptUI } from './ui.js';
import { sonioxClient } from './soniox.js';
import { elevenLabsTTS } from './elevenlabs-tts.js';
import { googleTTS } from './google-tts.js';
import { edgeTTSRust } from './edge-tts.js';
import { microsoftTTS } from './microsoft-tts.js';
import { googleFreeTTS } from './google-free-tts.js';
import { tiktokTTS } from './tiktok-tts.js';
import { localTTS } from './local-tts.js';
import { audioPlayer, readAudioPlayer } from './audio-player.js';
import { Reader } from './reader.js';
import { updater } from './updater.js';
import { sessionStore } from './session-store.js';
import { QWEN_LANGS } from './qwen-langs.js';

const { invoke, Channel } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

// Static fallback for Microsoft v2 voices when the live list endpoint is unreachable.
const MS_VOICE_FALLBACK = [
    { short_name: 'vi-VN-HoaiMyNeural', friendly_name: 'HoaiMy', gender: 'Female', locale: 'vi-VN' },
    { short_name: 'vi-VN-NamMinhNeural', friendly_name: 'NamMinh', gender: 'Male', locale: 'vi-VN' },
    { short_name: 'en-US-JennyNeural', friendly_name: 'Jenny', gender: 'Female', locale: 'en-US' },
    { short_name: 'en-US-GuyNeural', friendly_name: 'Guy', gender: 'Male', locale: 'en-US' },
];

class App {
    constructor() {
        this.isRunning = false;
        this.isStarting = false; // Guard against re-entry
        this.currentSource = 'system'; // 'system' | 'microphone' | 'both'
        this.translationMode = 'soniox'; // 'soniox' | 'local'
        this.transcriptUI = null;
        this.appWindow = getCurrentWindow();
        this.localPipelineChannel = null;
        this.localPipelineReady = false;
        this.recordingStartTime = null;
        this.sessionStartTime = null;  // Session start timestamp (new Date())
        this.sessionSourceLang = 'auto';
        this.sessionTargetLang = 'vi';
        this.sessionMode = 'one_way';
        this.ttsEnabled = false;  // TTS runtime toggle
        this.isPinned = true;     // Always-on-top state
        this.isCompact = false;   // Compact mode (hide control bar)
        this._closing = false;    // Guard so the exit flush runs exactly once
    }

    async init() {
        // Load settings
        await settingsManager.load();

        // Init transcript UI
        const transcriptContainer = document.getElementById('transcript-content');
        this.transcriptUI = new TranscriptUI(transcriptContainer);

        // Init session store — one session file lives across many Start/Pause
        // cycles; it autosaves while recording and finalizes on Stop or app close.
        const initSettings = settingsManager.get();
        sessionStore.init({
            engine: initSettings.translation_mode || 'soniox',
            sourceLang: initSettings.source_language || 'auto',
            targetLang: initSettings.target_language || 'vi',
        });

        // Check platform — hide Local MLX on non-Apple-Silicon
        await this._checkPlatformSupport();

        // Apply saved settings to UI
        this._applySettings(settingsManager.get());

        // Bind event listeners
        this._bindEvents();

        // Flush the session on every close route (window ✕, Cmd+Q, Dock quit).
        await this._bindCloseHooks();

        // Bind keyboard shortcuts
        this._bindKeyboardShortcuts();

        // Subscribe to settings changes
        settingsManager.onChange((settings) => this._applySettings(settings));

        // Init audio player for TTS
        audioPlayer.init();

        // Read mode (in-overlay TTS reader). 'live' = capture→translate→speak; 'read' =
        // paste text → read aloud. Default live. Reader is built lazily on Play.
        this._readMode = 'live';
        this._reader = null;
        this._initReadMode();

        // Wire TTS audio callbacks for every provider (single source of registration
        // so a new provider can never be silently left unwired).
        this._allTTS = [elevenLabsTTS, edgeTTSRust, googleTTS, microsoftTTS, googleFreeTTS, tiktokTTS, localTTS];
        for (const tts of this._allTTS) {
            tts.onAudioChunk = (base64Audio, isFinal) => {
                audioPlayer.enqueue(base64Audio);
            };
            tts.onError = (error) => {
                console.error('[TTS]', error);
                this._showToast(error, 'error');
            };
        }

        // Window position restore disabled — causes issues on Retina displays
        // await this._restoreWindowPosition();

        // Check for updates (non-blocking)
        this._initAboutTab();
        this._checkForUpdates();

        // Show engine picker on first launch
        this._maybeShowEnginePicker();

        console.log('🌐 My Translator v0.7.1 initialized');
    }

    async _checkPlatformSupport() {
        try {
            // Check if we're on macOS Apple Silicon
            const arch = await invoke('get_platform_info');
            const info = JSON.parse(arch);
            this.isAppleSilicon = (info.os === 'macos' && info.arch === 'aarch64');
        } catch {
            // Fallback: check via navigator
            this.isAppleSilicon = navigator.platform === 'MacIntel' &&
                navigator.userAgent.includes('Mac OS X');
        }

        if (!this.isAppleSilicon) {
            // Hide Local MLX option
            const select = document.getElementById('select-translation-mode');
            const localOption = select?.querySelector('option[value="local"]');
            if (localOption) localOption.remove();

            // Force soniox mode if user had local selected
            const settings = settingsManager.get();
            if (settings.translation_mode === 'local') {
                settings.translation_mode = 'soniox';
                settingsManager.save(settings);
            }
        }
    }

    // ─── Event Binding ──────────────────────────────────────

    _bindEvents() {
        // Settings button
        document.getElementById('btn-settings').addEventListener('click', () => {
            this._showView('settings');
        });

        // Sessions button
        document.getElementById('btn-sessions').addEventListener('click', () => {
            this._showView('sessions');
        });

        // Back from settings
        document.getElementById('btn-back').addEventListener('click', () => {
            this._showView('overlay');
        });

        // Back from sessions
        document.getElementById('btn-sessions-back').addEventListener('click', () => {
            this._showView('overlay');
        });

        // Back from session viewer to session list
        document.getElementById('btn-session-back-to-list').addEventListener('click', () => {
            document.getElementById('sessions-list-panel').style.display = '';
            document.getElementById('session-viewer').style.display = 'none';
        });

        // Copy session content
        document.getElementById('btn-session-copy').addEventListener('click', async () => {
            const content = document.getElementById('session-viewer-content')?.textContent || '';
            if (content) {
                await navigator.clipboard.writeText(content);
                this._showToast('Copied to clipboard', 'success');
            }
        });

        // Session search box (debounced)
        const searchInput = document.getElementById('input-session-search');
        if (searchInput) {
            let t;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(t);
                const q = e.target.value;
                t = setTimeout(() => this._showSessions(q), 200);
            });
        }

        // Edit session title (inline prompt)
        document.getElementById('btn-session-edit-title')?.addEventListener('click', async () => {
            const cur = this._currentViewedSession;
            if (!cur || cur.isLegacy) {
                this._showToast('Cannot rename legacy sessions', 'error');
                return;
            }
            const titleEl = document.getElementById('session-viewer-title');
            const oldTitle = titleEl?.textContent || '';
            const newTitle = prompt('Rename session:', oldTitle);
            if (newTitle == null || newTitle === oldTitle) return;
            try {
                await invoke('update_session_title', { id: cur.id, title: newTitle });
                if (titleEl) titleEl.textContent = newTitle;
                this._showToast('Renamed', 'success');
            } catch (err) {
                this._showToast(`Rename failed: ${err}`, 'error');
            }
        });

        // Export session
        document.getElementById('btn-session-export-srt')?.addEventListener('click', () => this._exportCurrentSession('srt'));
        document.getElementById('btn-session-export-txt')?.addEventListener('click', () => this._exportCurrentSession('txt'));

        // Close button (overlay) — flows through the onCloseRequested hook,
        // which flushes the session before the app exits.
        document.getElementById('btn-close').addEventListener('click', async () => {
            await this._saveWindowPosition();
            await this.appWindow.close();
        });

        // Minimize button
        document.getElementById('btn-minimize').addEventListener('click', async () => {
            await this._saveWindowPosition();
            await this.appWindow.minimize();
        });

        // Pin/Unpin button
        document.getElementById('btn-pin').addEventListener('click', () => {
            this._togglePin();
        });

        // Compact mode button
        document.getElementById('btn-compact').addEventListener('click', () => {
            this._toggleCompact();
        });

        // View mode toggle (dual panel)
        document.getElementById('btn-view-mode').addEventListener('click', () => {
            this._toggleViewMode();
        });

        // Font size quick controls
        document.getElementById('btn-font-up').addEventListener('click', () => this._adjustFontSize(4));
        document.getElementById('btn-font-down').addEventListener('click', () => this._adjustFontSize(-4));

        // Color dot controls
        document.querySelectorAll('.color-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
                const color = dot.dataset.color;
                this.transcriptUI.configure({ fontColor: color });
            });
        });

        // Start/Stop button
        document.getElementById('btn-start').addEventListener('click', async () => {
            if (this.isStarting) return; // Prevent re-entry
            try {
                if (this.isRunning) {
                    await this.stopSession();
                } else {
                    this.isStarting = true;
                    await this.start();
                }
            } catch (err) {
                console.error('[App] Start/Stop error:', err);
                this._showToast(`Error: ${err}`, 'error');
                this.isRunning = false;
                this._updateStartButton();
                this._updateStatus('error');
                this.transcriptUI.clear();
                this.transcriptUI.showPlaceholder();
            } finally {
                this.isStarting = false;
            }
        });

        // Pause button — stop capture + persist, but keep the same session file.
        // Only reachable while running (disabled otherwise); next Start appends a
        // new chunk to the same file rather than starting a fresh one.
        document.getElementById('btn-pause')?.addEventListener('click', async () => {
            if (this.isStarting || !this.isRunning) return;
            try {
                await this.pause();
            } catch (err) {
                console.error('[App] Pause error:', err);
                this._showToast(`Error: ${err}`, 'error');
            }
        });

        // Source buttons
        document.getElementById('btn-source-system').addEventListener('click', () => {
            this._setSource('system');
        });

        document.getElementById('btn-source-mic').addEventListener('click', () => {
            this._setSource('microphone');
        });
        document.getElementById('btn-source-both').addEventListener('click', () => {
            this._setSource('both');
        });

        // Clear button — clears display only (auto-save happens on stop)
        document.getElementById('btn-clear').addEventListener('click', async () => {
            this.transcriptUI.clear();
            this.transcriptUI.showPlaceholder();
            this.recordingStartTime = null;
        });

        // Copy transcript button
        document.getElementById('btn-copy').addEventListener('click', async () => {
            const text = this.transcriptUI.getPlainText();
            if (text) {
                await navigator.clipboard.writeText(text);
                this._showToast('Copied to clipboard', 'success');
            } else {
                this._showToast('Nothing to copy', 'info');
            }
        });

        // Open saved transcripts folder (kept for Finder access)
        document.getElementById('btn-open-transcripts').addEventListener('click', async () => {
            try {
                await invoke('open_transcript_dir');
            } catch (err) {
                this._showToast('Failed to open folder: ' + err, 'error');
            }
        });

        // Settings form elements
        this._bindSettingsForm();

        // Manual drag for settings view
        // data-tauri-drag-region doesn't work well when parent contains buttons
        // Using Tauri's recommended appWindow.startDragging() approach instead
        document.getElementById('settings-view')?.addEventListener('mousedown', (e) => {
            const interactive = e.target.closest('button, input, select, label, a, textarea, .settings-section, .settings-actions');
            if (!interactive && e.buttons === 1) {
                e.preventDefault();
                this.appWindow.startDragging();
            }
        });

        // Toggle API key visibility
        document.getElementById('btn-toggle-key').addEventListener('click', () => {
            const input = document.getElementById('input-api-key');
            input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('btn-toggle-openai-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-openai-key');
            if (input) input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('link-openai')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__.opener.openUrl('https://platform.openai.com/api-keys');
        });

        // Inline key format validation + engine-option enable/disable
        const sonioxInput = document.getElementById('input-api-key');
        const openaiInput = document.getElementById('input-openai-key');
        sonioxInput?.addEventListener('input', () => this._refreshKeyStatus());
        openaiInput?.addEventListener('input', () => this._refreshKeyStatus());

        // Test-connection buttons
        document.getElementById('btn-test-soniox')?.addEventListener('click', () => this._testConnection('soniox'));
        document.getElementById('btn-test-openai')?.addEventListener('click', () => this._testConnection('openai'));

        // Translation mode toggle
        document.getElementById('select-translation-mode').addEventListener('change', (e) => {
            this._updateModeUI(e.target.value);
        });

        // Welcome-screen engine cards: pick a class (standard / openai),
        // remember it, hide the picker, sync the rest of the UI.
        document.querySelectorAll('#engine-picker .engine-card').forEach(card => {
            card.addEventListener('click', () => {
                this._selectEngineClass(card.dataset.engineClass);
                this._hideEnginePicker();
            });
        });

        // Toolbar engine pill: same switch, available any time the session isn't
        // running. While running, the pill is locked (visual feedback only).
        document.querySelectorAll('#engine-pill .engine-pill-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (this.isRunning || this.isStarting) {
                    this._showToast('Pause the session before switching engine', 'error');
                    return;
                }
                this._selectEngineClass(btn.dataset.engineClass);
            });
        });

        // Translation type toggle (one-way / two-way)
        document.getElementById('select-translation-type')?.addEventListener('change', (e) => {
            this._updateTranslationTypeUI(e.target.value);
        });

        // Soniox link
        document.getElementById('link-soniox').addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__.opener.openUrl('https://console.soniox.com/signup/');
        });

        // ElevenLabs link
        document.getElementById('link-elevenlabs')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__.opener.openUrl('https://elevenlabs.io/app/sign-up');
        });

        // Save settings — both top and bottom buttons
        document.getElementById('btn-save-settings').addEventListener('click', () => {
            this._saveSettingsFromForm();
        });
        document.getElementById('btn-save-settings-top')?.addEventListener('click', () => {
            this._saveSettingsFromForm();
        });

        // Slider live updates
        document.getElementById('range-opacity').addEventListener('input', (e) => {
            document.getElementById('opacity-value').textContent = `${e.target.value}%`;
        });

        document.getElementById('range-font-size').addEventListener('input', (e) => {
            document.getElementById('font-size-value').textContent = `${e.target.value}px`;
        });

        document.getElementById('range-max-lines').addEventListener('input', (e) => {
            document.getElementById('max-lines-value').textContent = e.target.value;
        });

        document.getElementById('range-endpoint-delay')?.addEventListener('input', (e) => {
            document.getElementById('endpoint-delay-value').textContent = `${(e.target.value / 1000).toFixed(1)}s`;
        });

        // Toggle ElevenLabs API key visibility
        document.getElementById('btn-toggle-elevenlabs-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-elevenlabs-key');
            input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('btn-toggle-google-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-google-tts-key');
            input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('btn-toggle-google-free-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-google-free-key');
            input.type = input.type === 'password' ? 'text' : 'password';
        });

        // Settings tab switching
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(tab.dataset.tab)?.classList.add('active');
            });
        });

        // TTS enable/disable toggle in settings — show/hide detail
        document.getElementById('check-tts-enabled')?.addEventListener('change', (e) => {
            const detail = document.getElementById('tts-settings-detail');
            if (detail) detail.style.display = e.target.checked ? '' : 'none';
        });

        // TTS provider toggle — show/hide relevant settings panels
        document.getElementById('select-tts-provider')?.addEventListener('change', (e) => {
            this._updateTTSProviderUI(e.target.value);
        });

        // TTS speed slider — show value
        document.getElementById('range-tts-speed')?.addEventListener('input', (e) => {
            const label = document.getElementById('tts-speed-value');
            if (label) label.textContent = e.target.value + 'x';
        });

        // Edge TTS speed slider
        document.getElementById('range-edge-speed')?.addEventListener('input', (e) => {
            const label = document.getElementById('edge-speed-value');
            const v = parseInt(e.target.value);
            if (label) label.textContent = (v >= 0 ? '+' : '') + v + '%';
        });

        document.getElementById('range-google-speed')?.addEventListener('input', (e) => {
            const label = document.getElementById('google-speed-value');
            if (label) label.textContent = parseFloat(e.target.value).toFixed(1) + 'x';
        });

        // Microsoft v2 speed slider
        document.getElementById('range-microsoft-speed')?.addEventListener('input', (e) => {
            const label = document.getElementById('microsoft-speed-value');
            const v = parseInt(e.target.value);
            if (label) label.textContent = (v >= 0 ? '+' : '') + v + '%';
        });

        // Microsoft v2 language filter — re-fill the voice dropdown for the chosen language
        document.getElementById('select-microsoft-lang')?.addEventListener('change', (e) => {
            this._fillMicrosoftVoices(e.target.value);
        });

        // Local offline: language filter re-renders the voice list
        document.getElementById('select-local-lang')?.addEventListener('change', (e) => {
            this._fillLocalVoices(e.target.value);
        });

        // Local offline: speed slider (0.5x–2.0x)
        document.getElementById('range-local-speed')?.addEventListener('input', (e) => {
            const label = document.getElementById('local-speed-value');
            if (label) label.textContent = parseFloat(e.target.value).toFixed(1) + 'x';
        });

        // Google-free / TikTok: client-side speed sliders (0.5x–2.0x)
        document.getElementById('range-google-free-speed')?.addEventListener('input', (e) => {
            const label = document.getElementById('google-free-speed-value');
            if (label) label.textContent = parseFloat(e.target.value).toFixed(1) + 'x';
        });
        document.getElementById('range-tiktok-speed')?.addEventListener('input', (e) => {
            const label = document.getElementById('tiktok-speed-value');
            if (label) label.textContent = parseFloat(e.target.value).toFixed(1) + 'x';
        });

        // Local offline: change model storage folder
        document.getElementById('btn-local-change-dir')?.addEventListener('click', () => {
            this._maybePickModelsDir();
        });

        // Local offline: reset model folder back to the default app location
        document.getElementById('btn-local-reset-dir')?.addEventListener('click', () => {
            this._resetModelsDir();
        });

        // TikTok: paste a "Copy as cURL" and auto-extract the sessionid cookie into the field
        document.getElementById('input-tiktok-curl')?.addEventListener('input', (e) => {
            const m = e.target.value.match(/sessionid=([^;"'\s\\]+)/i);
            const sidInput = document.getElementById('input-tiktok-session');
            if (m && m[1] && sidInput && sidInput.value !== m[1]) {
                sidInput.value = m[1];
                this._showToast('sessionid extracted from cURL ✓', 'success');
            }
        });

        // Add translation term row
        document.getElementById('btn-add-term')?.addEventListener('click', () => {
            this._addTermRow('', '');
        });

        // Add general context row
        document.getElementById('btn-add-general')?.addEventListener('click', () => {
            this._addGeneralRow('', '');
        });

        // TTS toggle button in overlay
        document.getElementById('btn-tts').addEventListener('click', () => {
            this._toggleTTS();
        });

        // Wire Soniox callbacks. Soniox emits original + translation as
        // separate finals; we FIFO-pair them into the session store so each
        // saved segment has both source and target text.
        this._sonioxOriginalQueue = [];
        sonioxClient.onOriginal = (text, speaker, language) => {
            this.transcriptUI.addOriginal(text, speaker, language);
            this._sonioxOriginalQueue.push(text);
        };

        sonioxClient.onTranslation = (text) => {
            this.transcriptUI.addTranslation(text);
            const src = this._sonioxOriginalQueue.shift() || '';
            sessionStore.addSegment(src, text);
            this._speakIfEnabled(text);
        };

        sonioxClient.onProvisional = (text, speaker, language) => {
            if (text) {
                this.transcriptUI.setProvisional(text, speaker, language);
            } else {
                this.transcriptUI.clearProvisional();
            }
        };

        sonioxClient.onStatusChange = (status) => {
            this._updateStatus(status);
        };

        sonioxClient.onError = (error) => {
            this._showToast(error, 'error');
        };

        sonioxClient.onConfidence = (avgConfidence) => {
            this.transcriptUI.setConfidence(avgConfidence);
        };
    }

    _bindSettingsForm() {
        // These are handled in _populateSettingsForm and _saveSettingsFromForm
    }

    // ─── Keyboard Shortcuts ─────────────────────────────────

    _bindKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ignore when typing in input fields
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            // Cmd/Ctrl + Enter: Start/Stop
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                if (this.isStarting) return;
                (async () => {
                    try {
                        if (this.isRunning) {
                            await this.stopSession();
                        } else {
                            this.isStarting = true;
                            await this.start();
                        }
                    } catch (err) {
                        console.error('[App] Keyboard start/stop error:', err);
                        this._showToast(`Error: ${err}`, 'error');
                        this.isRunning = false;
                        this._updateStartButton();
                        this._updateStatus('error');
                    } finally {
                        this.isStarting = false;
                    }
                })();
            }

            // Escape: Go back to overlay / close settings
            if (e.key === 'Escape') {
                e.preventDefault();
                const settingsVisible = document.getElementById('settings-view').classList.contains('active');
                if (settingsVisible) {
                    this._showView('overlay');
                }
            }

            // Cmd/Ctrl + ,: Open settings
            if ((e.metaKey || e.ctrlKey) && e.key === ',') {
                e.preventDefault();
                this._showView('settings');
            }

            // Cmd/Ctrl + 1: Switch to System Audio
            if ((e.metaKey || e.ctrlKey) && e.key === '1') {
                e.preventDefault();
                this._setSource('system');
            }

            // Cmd/Ctrl + 2: Switch to Microphone
            if ((e.metaKey || e.ctrlKey) && e.key === '2') {
                e.preventDefault();
                this._setSource('microphone');
            }

            // Cmd/Ctrl + 3: Switch to Both
            if ((e.metaKey || e.ctrlKey) && e.key === '3') {
                e.preventDefault();
                this._setSource('both');
            }

            // Cmd/Ctrl + T: Toggle TTS
            if ((e.metaKey || e.ctrlKey) && e.key === 't') {
                e.preventDefault();
                this._toggleTTS();
            }

            // Cmd/Ctrl + M: Minimize
            if ((e.metaKey || e.ctrlKey) && e.key === 'm') {
                e.preventDefault();
                this._saveWindowPosition();
                this.appWindow.minimize();
            }

            // Cmd/Ctrl + P: Toggle Pin
            if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
                e.preventDefault();
                this._togglePin();
            }

            // Cmd/Ctrl + D: Toggle Compact
            if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
                e.preventDefault();
                this._toggleCompact();
            }
        });
    }

    // ─── Views ──────────────────────────────────────────────

    _showView(view) {
        document.getElementById('overlay-view').classList.toggle('active', view === 'overlay');
        document.getElementById('settings-view').classList.toggle('active', view === 'settings');
        document.getElementById('sessions-view').classList.toggle('active', view === 'sessions');

        if (view === 'settings') {
            this._populateSettingsForm();
        }
        if (view === 'sessions') {
            this._showSessions();
        }
    }

    // ─── Settings Form ─────────────────────────────────────

    _populateSettingsForm() {
        const s = settingsManager.get();

        document.getElementById('input-api-key').value = s.soniox_api_key || '';
        const openaiKeyInput = document.getElementById('input-openai-key');
        if (openaiKeyInput) openaiKeyInput.value = s.openai_api_key || '';
        const qwenKeyInput = document.getElementById('input-qwen-key');
        if (qwenKeyInput) qwenKeyInput.value = s.qwen_api_key || '';
        document.getElementById('select-source-lang').value = s.source_language || 'auto';
        document.getElementById('select-target-lang').value = s.target_language || 'vi';
        document.getElementById('select-translation-mode').value = s.translation_mode || 'soniox';
        this._updateModeUI(s.translation_mode || 'soniox');
        this._refreshKeyStatus();

        // Translation type (one-way / two-way)
        const translationType = s.translation_type || 'one_way';
        document.getElementById('select-translation-type').value = translationType;
        this._updateTranslationTypeUI(translationType);

        // Two-way language selects
        document.getElementById('select-lang-a').value = s.language_a || 'ja';
        document.getElementById('select-lang-b').value = s.language_b || 'vi';

        // Strict language detection
        document.getElementById('check-strict-lang').checked = s.language_hints_strict || false;

        // Endpoint delay
        const endpointDelay = s.endpoint_delay || 3000;
        const delaySlider = document.getElementById('range-endpoint-delay');
        if (delaySlider) delaySlider.value = endpointDelay;
        const delayValue = document.getElementById('endpoint-delay-value');
        if (delayValue) delayValue.textContent = `${(endpointDelay / 1000).toFixed(1)}s`;

        // Audio source radio
        const radioValue = s.audio_source || 'system';
        const radio = document.querySelector(`input[name="audio-source"][value="${radioValue}"]`);
        if (radio) radio.checked = true;

        // Display
        const opacityPercent = Math.round((s.overlay_opacity || 0.85) * 100);
        document.getElementById('range-opacity').value = opacityPercent;
        document.getElementById('opacity-value').textContent = `${opacityPercent}%`;

        document.getElementById('range-font-size').value = s.font_size || 16;
        document.getElementById('font-size-value').textContent = `${s.font_size || 16}px`;

        document.getElementById('range-max-lines').value = s.max_lines || 5;
        document.getElementById('max-lines-value').textContent = s.max_lines || 5;

        document.getElementById('check-show-original').checked = s.show_original !== false;

        // Custom context (rich format)
        const ctx = s.custom_context;
        // General context rows
        const generalList = document.getElementById('context-general-list');
        if (generalList) {
            generalList.innerHTML = '';
            const generalPairs = ctx?.general || [];
            generalPairs.forEach(g => this._addGeneralRow(g.key, g.value));
        }
        // Transcription terms
        const termsInput = document.getElementById('input-context-terms');
        if (termsInput) {
            termsInput.value = (ctx?.terms || []).join('\n');
        }
        // Background text
        const textInput = document.getElementById('input-context-text');
        if (textInput) {
            textInput.value = ctx?.text || '';
        }
        // Load translation terms as rows
        const termsList = document.getElementById('translation-terms-list');
        if (termsList) {
            termsList.innerHTML = '';
            const terms = ctx?.translation_terms || [];
            terms.forEach(t => this._addTermRow(t.source, t.target));
        }

        // TTS settings
        document.getElementById('input-elevenlabs-key').value = s.elevenlabs_api_key || '';
        document.getElementById('select-tts-voice').value = s.tts_voice_id || '21m00Tcm4TlvDq8ikWAM';
        // Edge TTS settings
        const edgeVoiceSelect = document.getElementById('select-edge-voice');
        if (edgeVoiceSelect) edgeVoiceSelect.value = s.edge_tts_voice || 'vi-VN-HoaiMyNeural';
        const edgeSpeedSlider = document.getElementById('range-edge-speed');
        const edgeSpeedLabel = document.getElementById('edge-speed-value');
        const edgeSpeed = s.edge_tts_speed !== undefined ? s.edge_tts_speed : 20;
        if (edgeSpeedSlider) edgeSpeedSlider.value = edgeSpeed;
        if (edgeSpeedLabel) edgeSpeedLabel.textContent = (edgeSpeed >= 0 ? '+' : '') + edgeSpeed + '%';

        // Google TTS settings
        const googleKeyInput = document.getElementById('input-google-tts-key');
        if (googleKeyInput) googleKeyInput.value = s.google_tts_api_key || '';
        const googleVoiceSelect = document.getElementById('select-google-voice');
        if (googleVoiceSelect) googleVoiceSelect.value = s.google_tts_voice || 'vi-VN-Chirp3-HD-Aoede';
        const googleSpeedSlider = document.getElementById('range-google-speed');
        const googleSpeedLabel = document.getElementById('google-speed-value');
        const googleSpeed = s.google_tts_speed || 1.0;
        if (googleSpeedSlider) googleSpeedSlider.value = googleSpeed;
        if (googleSpeedLabel) googleSpeedLabel.textContent = googleSpeed + 'x';

        // Microsoft v2 settings (voice populated dynamically in _updateTTSProviderUI)
        const msVoiceSelect = document.getElementById('select-microsoft-voice');
        if (msVoiceSelect) msVoiceSelect.value = s.microsoft_v2_voice || 'vi-VN-HoaiMyNeural';
        const msSpeedSlider = document.getElementById('range-microsoft-speed');
        const msSpeedLabel = document.getElementById('microsoft-speed-value');
        const msSpeed = s.microsoft_v2_speed !== undefined ? s.microsoft_v2_speed : 20;
        if (msSpeedSlider) msSpeedSlider.value = msSpeed;
        if (msSpeedLabel) msSpeedLabel.textContent = (msSpeed >= 0 ? '+' : '') + msSpeed + '%';

        // Google Free settings
        const gfKeyInput = document.getElementById('input-google-free-key');
        if (gfKeyInput) gfKeyInput.value = s.google_free_api_key || '';
        const gfVoiceSelect = document.getElementById('select-google-free-voice');
        if (gfVoiceSelect) gfVoiceSelect.value = s.google_free_voice || 'vi-VN';
        const gfSpeed = s.google_free_speed || 1.0;
        const gfSpeedSlider = document.getElementById('range-google-free-speed');
        const gfSpeedLabel = document.getElementById('google-free-speed-value');
        if (gfSpeedSlider) gfSpeedSlider.value = gfSpeed;
        if (gfSpeedLabel) gfSpeedLabel.textContent = parseFloat(gfSpeed).toFixed(1) + 'x';

        // TikTok settings
        const ttVoiceSelect = document.getElementById('select-tiktok-voice');
        if (ttVoiceSelect) ttVoiceSelect.value = s.tiktok_voice || 'BV074_streaming';
        const ttSession = document.getElementById('input-tiktok-session');
        if (ttSession) ttSession.value = s.tiktok_session_id || '';
        const ttSpeed = s.tiktok_speed || 1.0;
        const ttSpeedSlider = document.getElementById('range-tiktok-speed');
        const ttSpeedLabel = document.getElementById('tiktok-speed-value');
        if (ttSpeedSlider) ttSpeedSlider.value = ttSpeed;
        if (ttSpeedLabel) ttSpeedLabel.textContent = parseFloat(ttSpeed).toFixed(1) + 'x';

        // TTS provider
        const providerSelect = document.getElementById('select-tts-provider');
        if (providerSelect) {
            providerSelect.value = s.tts_provider || 'edge';
            this._updateTTSProviderUI(providerSelect.value);
        }
    }

    async _saveSettingsFromForm() {
        const settings = {
            soniox_api_key: document.getElementById('input-api-key').value.trim(),
            openai_api_key: document.getElementById('input-openai-key')?.value.trim() || '',
            qwen_api_key: document.getElementById('input-qwen-key')?.value.trim() || '',
            source_language: document.getElementById('select-source-lang').value,
            target_language: document.getElementById('select-target-lang').value,
            translation_mode: document.getElementById('select-translation-mode').value,
            translation_type: document.getElementById('select-translation-type')?.value || 'one_way',
            language_a: document.getElementById('select-lang-a')?.value || 'ja',
            language_b: document.getElementById('select-lang-b')?.value || 'vi',
            language_hints_strict: document.getElementById('check-strict-lang')?.checked || false,
            endpoint_delay: parseInt(document.getElementById('range-endpoint-delay')?.value || 3000),
            audio_source: document.querySelector('input[name="audio-source"]:checked')?.value || 'system',
            overlay_opacity: parseInt(document.getElementById('range-opacity').value) / 100,
            font_size: parseInt(document.getElementById('range-font-size').value),
            max_lines: parseInt(document.getElementById('range-max-lines').value),
            show_original: document.getElementById('check-show-original').checked,
            custom_context: null,
        };

        // Parse custom context (rich format)
        // General key-value pairs
        const generalPairs = [];
        document.querySelectorAll('#context-general-list .general-row').forEach(row => {
            const key = row.querySelector('.general-key')?.value.trim();
            const value = row.querySelector('.general-value')?.value.trim();
            if (key && value) generalPairs.push({ key, value });
        });

        // Transcription terms
        const termsRaw = document.getElementById('input-context-terms')?.value.trim() || '';
        const terms = termsRaw ? termsRaw.split('\n').map(t => t.trim()).filter(t => t) : [];

        // Background text
        const contextText = document.getElementById('input-context-text')?.value.trim() || '';

        // Translation terms
        const translationTerms = [];
        document.querySelectorAll('#translation-terms-list .term-row').forEach(row => {
            const source = row.querySelector('.term-source')?.value.trim();
            const target = row.querySelector('.term-target')?.value.trim();
            if (source && target) translationTerms.push({ source, target });
        });

        if (generalPairs.length > 0 || terms.length > 0 || contextText || translationTerms.length > 0) {
            settings.custom_context = {
                general: generalPairs,
                terms: terms,
                text: contextText || null,
                translation_terms: translationTerms,
            };
        }

        // TTS settings
        settings.tts_provider = document.getElementById('select-tts-provider')?.value || 'edge';
        settings.elevenlabs_api_key = document.getElementById('input-elevenlabs-key').value.trim();
        settings.tts_voice_id = document.getElementById('select-tts-voice').value;
        settings.edge_tts_voice = document.getElementById('select-edge-voice')?.value || 'vi-VN-HoaiMyNeural';
        settings.edge_tts_speed = parseInt(document.getElementById('range-edge-speed')?.value || 20);
        settings.tts_speed = parseFloat(document.getElementById('range-tts-speed')?.value || 1.2);
        settings.google_tts_api_key = document.getElementById('input-google-tts-key')?.value.trim() || '';
        settings.google_tts_voice = document.getElementById('select-google-voice')?.value || 'vi-VN-Chirp3-HD-Aoede';
        settings.google_tts_speed = parseFloat(document.getElementById('range-google-speed')?.value || 1.0);
        settings.microsoft_v2_voice = document.getElementById('select-microsoft-voice')?.value || 'vi-VN-HoaiMyNeural';
        settings.microsoft_v2_speed = parseInt(document.getElementById('range-microsoft-speed')?.value || 20);
        settings.google_free_api_key = document.getElementById('input-google-free-key')?.value.trim() || '';
        settings.google_free_voice = document.getElementById('select-google-free-voice')?.value || 'vi-VN';
        settings.google_free_speed = parseFloat(document.getElementById('range-google-free-speed')?.value || 1.0);
        settings.tiktok_voice = document.getElementById('select-tiktok-voice')?.value || 'BV074_streaming';
        settings.tiktok_speed = parseFloat(document.getElementById('range-tiktok-speed')?.value || 1.0);
        settings.tiktok_session_id = document.getElementById('input-tiktok-session')?.value.trim() || '';
        settings.local_tts_speed = parseFloat(document.getElementById('range-local-speed')?.value || 1.0);
        settings.tts_enabled = false;

        try {
            await settingsManager.save(settings);
            this._showToast('Settings saved', 'success');
            this._showView('overlay');
        } catch (err) {
            this._showToast(`Failed to save: ${err}`, 'error');
        }
    }

    // ─── Apply Settings ────────────────────────────────────

    _applySettings(settings) {
        // Update overlay opacity
        const overlayView = document.getElementById('overlay-view');
        overlayView.style.opacity = settings.overlay_opacity || 0.85;

        // Note: saving settings turns TTS narration off (see end of this method), so the
        // active provider is re-configured on the next TTS toggle — no mid-session re-sync
        // needed here. Disconnect any non-active provider to drop stale queued audio.
        if (this._allTTS) {
            const active = this._getActiveTTS();
            for (const tts of this._allTTS) {
                if (tts !== active && tts.isConnected) tts.disconnect();
            }
        }

        // Update transcript UI
        if (this.transcriptUI) {
            this.transcriptUI.configure({
                maxLines: settings.max_lines || 5,
                showOriginal: settings.show_original !== false,
                fontSize: settings.font_size || 16,
            });
        }

        // Update current source button states
        this.currentSource = settings.audio_source || 'system';
        this._updateSourceButtons();

        // TTS is always OFF on app start — user must toggle on each session
        this.ttsEnabled = false;
        this._updateTTSButton();
    }

    // ─── TTS Control ──────────────────────────────────────

    async _toggleTTS() {
        const settings = settingsManager.get();
        const provider = settings.tts_provider || 'edge';

        // Block TTS in two-way mode to prevent audio feedback loop
        const translationType = document.getElementById('select-translation-type')?.value;
        if (translationType === 'two_way') {
            this._showToast('TTS is disabled in two-way mode to prevent audio loop', 'error');
            return;
        }

        // Local provider: the selected voice must actually be downloaded (async check).
        // Only gate when turning ON (turning off never needs a model).
        if (provider === 'local' && !this.ttsEnabled) {
            const installed = await this._isLocalVoiceInstalled(settings.local_tts_voice);
            if (!installed) {
                this._showToast('Download a voice in Settings → TTS → Local', 'error');
                this._showView('settings');
                return;
            }
        }

        // Check credentials for providers that require them (free providers need none)
        if (provider === 'elevenlabs' && !settings.elevenlabs_api_key) {
            this._showToast('Add ElevenLabs API key in Settings → TTS', 'error');
            this._showView('settings');
            return;
        }
        if (provider === 'google' && !settings.google_tts_api_key) {
            this._showToast('Add Google TTS API key in Settings → TTS', 'error');
            this._showView('settings');
            return;
        }
        if (provider === 'tiktok' && !settings.tiktok_session_id) {
            this._showToast('Add a TikTok sessionid in Settings → TTS', 'error');
            this._showView('settings');
            return;
        }

        this.ttsEnabled = !this.ttsEnabled;
        this._updateTTSButton();

        const tts = this._getActiveTTS();

        if (this.ttsEnabled) {
            this._configureTTS(tts, settings);
            if (this.isRunning) {
                tts.connect();
                audioPlayer.resume();
            }
            const label = {
                edge: 'Edge TTS (Free)',
                microsoft: 'Microsoft v2 (Free)',
                'google-free': 'Google TTS (Free)',
                tiktok: 'TikTok TTS (Free)',
                local: 'Local Offline',
                google: 'Google Chirp 3 HD',
                elevenlabs: 'ElevenLabs',
            }[provider] || provider;
            this._showToast(`TTS narration ON 🔊 (${label})`, 'success');
        } else {
            tts.disconnect();
            audioPlayer.stop();
            this._showToast('TTS narration OFF 🔇', 'success');
        }
    }

    _getActiveTTS() {
        const provider = settingsManager.get().tts_provider || 'edge';
        const map = {
            edge: edgeTTSRust,
            microsoft: microsoftTTS,
            'google-free': googleFreeTTS,
            tiktok: tiktokTTS,
            local: localTTS,
            google: googleTTS,
            elevenlabs: elevenLabsTTS,
        };
        const tts = map[provider];
        if (!tts) {
            console.warn(`[TTS] Unknown provider "${provider}", falling back to Edge`);
            return edgeTTSRust;
        }
        return tts;
    }

    _configureTTS(tts, settings) {
        const provider = settings.tts_provider || 'edge';
        // Client-side playback speed ONLY for providers whose endpoint has no rate param
        // (Google-free, TikTok). Others apply speed server-side / in the engine → keep 1.0.
        const clientRate =
            provider === 'google-free' ? (settings.google_free_speed || 1.0) :
            provider === 'tiktok' ? (settings.tiktok_speed || 1.0) : 1.0;
        audioPlayer.setPlaybackRate(clientRate);
        if (provider === 'elevenlabs') {
            tts.configure({
                apiKey: settings.elevenlabs_api_key,
                voiceId: settings.tts_voice_id || '21m00Tcm4TlvDq8ikWAM',
            });
        } else if (provider === 'google') {
            const voice = settings.google_tts_voice || 'vi-VN-Chirp3-HD-Aoede';
            const langCode = voice.replace(/-Chirp3.*/, '');
            tts.configure({
                apiKey: settings.google_tts_api_key,
                voice: voice,
                languageCode: langCode,
                speakingRate: settings.google_tts_speed || 1.0,
            });
        } else if (provider === 'microsoft') {
            tts.configure({
                voice: settings.microsoft_v2_voice || 'vi-VN-HoaiMyNeural',
                speed: settings.microsoft_v2_speed !== undefined ? settings.microsoft_v2_speed : 20,
            });
        } else if (provider === 'google-free') {
            tts.configure({
                voice: settings.google_free_voice || 'vi-VN',
                apiKey: settings.google_free_api_key || '',
            });
        } else if (provider === 'tiktok') {
            tts.configure({
                voice: settings.tiktok_voice || 'BV074_streaming',
                sessionId: settings.tiktok_session_id || '',
            });
        } else if (provider === 'local') {
            tts.configure({
                voice: settings.local_tts_voice || 'vi_VN-vais1000-medium',
                speed: settings.local_tts_speed || 1.0,
            });
        } else {
            tts.configure({
                voice: settings.edge_tts_voice || 'vi-VN-HoaiMyNeural',
                speed: settings.edge_tts_speed !== undefined ? settings.edge_tts_speed : 20,
            });
        }
    }

    _addTermRow(source = '', target = '') {
        const list = document.getElementById('translation-terms-list');
        if (!list) return;
        const row = document.createElement('div');
        row.className = 'term-row';
        row.innerHTML = `<input type="text" class="term-source" value="${source}" placeholder="Source" />` +
            `<input type="text" class="term-target" value="${target}" placeholder="Target" />` +
            `<button type="button" class="btn-remove-term" title="Remove">×</button>`;
        row.querySelector('.btn-remove-term').addEventListener('click', () => row.remove());
        list.appendChild(row);
    }

    _addGeneralRow(key = '', value = '') {
        const list = document.getElementById('context-general-list');
        if (!list) return;
        const row = document.createElement('div');
        row.className = 'general-row';
        row.innerHTML = `<input type="text" class="general-key" value="${this._escAttr(key)}" placeholder="Key (e.g. domain)" />` +
            `<input type="text" class="general-value" value="${this._escAttr(value)}" placeholder="Value (e.g. Medical)" />` +
            `<button type="button" class="btn-remove-general" title="Remove">×</button>`;
        row.querySelector('.btn-remove-general').addEventListener('click', () => row.remove());
        list.appendChild(row);
    }

    _escAttr(str) {
        return String(str ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    _esc(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    _updateTTSProviderUI(provider) {
        // Show only the active provider's settings panel.
        const panels = {
            edge: 'tts-edge-settings',
            microsoft: 'tts-microsoft-settings',
            'google-free': 'tts-google-free-settings',
            tiktok: 'tts-tiktok-settings',
            local: 'tts-local-settings',
            google: 'tts-google-settings',
            elevenlabs: 'tts-elevenlabs-settings',
        };
        for (const [id, elId] of Object.entries(panels)) {
            const el = document.getElementById(elId);
            if (el) el.style.display = provider === id ? '' : 'none';
        }
        // Update hint text
        const hint = document.getElementById('tts-provider-hint');
        if (hint) {
            const hints = {
                edge: 'Free, natural voices — no API key needed',
                microsoft: 'Free — full Microsoft voice list (vi + en), sent to Microsoft',
                'google-free': 'Free — experimental, may stop working anytime. Text sent to Google',
                tiktok: 'Free — needs a TikTok sessionid. Text sent to TikTok',
                local: 'Free & 100% offline — download a voice below; nothing is sent anywhere',
                google: 'Near-human quality — requires Google Cloud API key (1M chars/month free)',
                elevenlabs: 'Premium quality — requires ElevenLabs API key',
            };
            hint.textContent = hints[provider] || '';
        }
        // Microsoft v2: populate the full voice list dynamically (fallback stays in HTML).
        if (provider === 'microsoft') this._populateMicrosoftVoices();
        // Local: fetch catalog + install state and render the downloadable voice list.
        if (provider === 'local') this._populateLocalVoices();
    }

    /**
     * Fetch Microsoft's vi+en voice list once (cached), then fill the voice dropdown
     * filtered by the selected Language. The Language dropdown keeps the voice list short
     * (Microsoft has ~50 English voices). Default language follows the saved voice's locale.
     */
    async _populateMicrosoftVoices() {
        const langSel = document.getElementById('select-microsoft-lang');
        const saved = settingsManager.get().microsoft_v2_voice || 'vi-VN-HoaiMyNeural';
        // Initialize the Language dropdown from the saved voice's locale (once).
        if (langSel && !langSel.dataset.init) {
            langSel.value = saved.startsWith('en') ? 'en' : 'vi';
            langSel.dataset.init = 'true';
        }
        if (!this._msVoices) {
            try {
                const voices = await microsoftTTS.listVoices();
                this._msVoices = (Array.isArray(voices) && voices.length) ? voices : MS_VOICE_FALLBACK;
            } catch (err) {
                console.warn('[Microsoft v2] voice list fetch failed, using static fallback:', err);
                this._msVoices = MS_VOICE_FALLBACK;
            }
        }
        this._fillMicrosoftVoices(langSel ? langSel.value : 'vi');
    }

    /** Fill #select-microsoft-voice with cached voices for `lang` ("vi"|"en"), restoring saved. */
    _fillMicrosoftVoices(lang) {
        const select = document.getElementById('select-microsoft-voice');
        if (!select) return;
        const saved = settingsManager.get().microsoft_v2_voice;
        const list = (this._msVoices || MS_VOICE_FALLBACK).filter(v => (v.locale || '').startsWith(lang));
        select.innerHTML = '';
        for (const v of list) {
            const opt = document.createElement('option');
            opt.value = v.short_name;
            opt.textContent = `${v.friendly_name} (${v.gender})`;
            select.appendChild(opt);
        }
        // Keep the saved voice if it belongs to this language, else pick the first.
        if (saved && list.some(v => v.short_name === saved)) select.value = saved;
        else if (select.options.length) select.selectedIndex = 0;
    }

    // ─── Local offline (Piper) voice manager ──────────────

    /** Fetch the catalog + install state once per open, then render the list. */
    async _populateLocalVoices() {
        const langSel = document.getElementById('select-local-lang');
        const saved = settingsManager.get().local_tts_voice || 'vi_VN-vais1000-medium';
        if (langSel && !langSel.dataset.init) {
            langSel.value = saved.startsWith('en') ? 'en' : 'vi';
            langSel.dataset.init = 'true';
        }
        // Show the real resolved models folder (per-OS absolute path) so the user can
        // find the files themselves. Falls back to the raw setting if the query fails.
        const dirInput = document.getElementById('input-local-models-dir');
        if (dirInput) {
            try {
                dirInput.value = await invoke('local_tts_models_dir_path');
            } catch {
                dirInput.value = settingsManager.get().local_tts_models_dir || 'Default app location';
            }
        }
        // Speed slider from saved setting.
        const speedSlider = document.getElementById('range-local-speed');
        const speedLabel = document.getElementById('local-speed-value');
        const speed = settingsManager.get().local_tts_speed || 1.0;
        if (speedSlider) speedSlider.value = speed;
        if (speedLabel) speedLabel.textContent = parseFloat(speed).toFixed(1) + 'x';
        await this._refreshLocalVoices();
        this._fillLocalVoices(langSel ? langSel.value : 'vi');
    }

    /** (Re)load the catalog + install state from the backend into a cache. */
    async _refreshLocalVoices() {
        try {
            const list = await invoke('local_tts_list_models');
            this._localVoices = Array.isArray(list) ? list : [];
        } catch (err) {
            console.warn('[Local TTS] list failed:', err);
            this._localVoices = [];
        }
        this._localInstalled = new Set(
            (this._localVoices || []).filter(v => v.installed).map(v => v.id)
        );
    }

    /** True if `id` is currently installed (fresh backend check). */
    async _isLocalVoiceInstalled(id) {
        if (!id) return false;
        await this._refreshLocalVoices();
        return this._localInstalled.has(id);
    }

    /** Render the voice rows for `lang` ("vi"|"en") with download/delete controls. */
    _fillLocalVoices(lang) {
        const container = document.getElementById('local-voice-list');
        if (!container) return;
        const saved = settingsManager.get().local_tts_voice;
        const all = this._localVoices || [];
        // Catalog voices filter by the selected language; imported (local) voices are shown
        // regardless of language (their language is unknown).
        const catalogList = all.filter(v => !v.imported && v.lang === lang);
        const importedList = all.filter(v => v.imported);
        container.innerHTML = '';
        if (!catalogList.length && !importedList.length) {
            container.innerHTML = '<p class="hint">No voices for this language.</p>';
            return;
        }

        const addRow = (v) => {
            const row = document.createElement('div');
            row.className = 'local-voice-row';
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;';
            const sizeMb = (v.approxSizeBytes / 1e6).toFixed(0);
            if (v.installed) {
                const checked = saved === v.id ? 'checked' : '';
                row.innerHTML =
                    `<label style="flex:1;display:flex;align-items:center;gap:6px;cursor:pointer;">` +
                    `<input type="radio" name="local-voice" value="${v.id}" ${checked} />` +
                    `<span>${this._esc(v.display)}</span></label>` +
                    `<button type="button" class="icon-btn small btn-local-delete" data-id="${v.id}" title="Delete">🗑️</button>`;
            } else {
                row.innerHTML =
                    `<span style="flex:1;color:var(--text-muted,#888);">${this._esc(v.display)} · ${sizeMb} MB</span>` +
                    `<span class="local-progress" data-id="${v.id}" style="min-width:64px;text-align:right;"></span>` +
                    `<button type="button" class="icon-btn small btn-local-download" data-id="${v.id}" title="Download">⬇️</button>`;
            }
            container.appendChild(row);
        };

        catalogList.forEach(addRow);
        if (importedList.length) {
            const hdr = document.createElement('p');
            hdr.className = 'hint';
            hdr.style.cssText = 'margin:8px 0 2px;font-weight:600;';
            hdr.textContent = `Imported (local) — ${importedList.length}`;
            container.appendChild(hdr);
            importedList.forEach(addRow);
        }

        container.querySelectorAll('.btn-local-download').forEach(btn =>
            btn.addEventListener('click', () => this._downloadLocalVoice(btn.dataset.id))
        );
        container.querySelectorAll('.btn-local-delete').forEach(btn =>
            btn.addEventListener('click', () => this._deleteLocalVoice(btn.dataset.id))
        );
        container.querySelectorAll('input[name="local-voice"]').forEach(radio =>
            radio.addEventListener('change', () => {
                if (radio.checked) settingsManager.save({ local_tts_voice: radio.value });
            })
        );
    }

    /** Download a voice model with live progress, then re-render as installed. */
    async _downloadLocalVoice(id) {
        // Prompt for a save location on the first ever download if none chosen.
        if (!settingsManager.get().local_tts_models_dir && !this._localDirPrompted) {
            this._localDirPrompted = true;
            const custom = await this._maybePickModelsDir();
            if (custom === null) return; // user cancelled
        }
        const progressEl = document.querySelector(`.local-progress[data-id="${id}"]`);
        const btn = document.querySelector(`.btn-local-download[data-id="${id}"]`);
        if (btn) btn.disabled = true;
        const onProgress = new Channel();
        onProgress.onmessage = (msg) => {
            if (!progressEl) return;
            if (msg.phase === 'downloading' && msg.total > 0) {
                progressEl.textContent = `${Math.floor((msg.received / msg.total) * 100)}%`;
            } else if (msg.phase === 'extracting') {
                progressEl.textContent = '…';
            }
        };
        try {
            await invoke('local_tts_download_model', { id, onProgress });
            this._showToast('Voice downloaded ✓', 'success');
            await this._refreshLocalVoices();
            this._fillLocalVoices(document.getElementById('select-local-lang')?.value || 'vi');
        } catch (err) {
            this._showToast(`Download failed: ${err}`, 'error');
            if (btn) btn.disabled = false;
            if (progressEl) progressEl.textContent = '';
        }
    }

    /** Delete an installed voice (real on-device removal), then re-render. */
    async _deleteLocalVoice(id) {
        try {
            await invoke('local_tts_delete_model', { id });
            this._showToast('Voice deleted', 'success');
            await this._refreshLocalVoices();
            this._fillLocalVoices(document.getElementById('select-local-lang')?.value || 'vi');
        } catch (err) {
            this._showToast(`Delete failed: ${err}`, 'error');
        }
    }

    /**
     * Open the folder picker; on pick, persist as models dir and refresh.
     * Returns the chosen path, or null if the user cancelled (so callers can abort),
     * or '' if the picker itself failed.
     */
    async _maybePickModelsDir() {
        try {
            const { open } = window.__TAURI__.dialog;
            const picked = await open({ directory: true, multiple: false, title: 'Choose model folder' });
            if (picked === null || picked === undefined) return null; // cancelled
            const dir = Array.isArray(picked) ? picked[0] : picked;
            await settingsManager.save({ local_tts_models_dir: dir });
            const dirInput = document.getElementById('input-local-models-dir');
            if (dirInput) dirInput.value = dir;
            await this._refreshLocalVoices();
            this._fillLocalVoices(document.getElementById('select-local-lang')?.value || 'vi');
            return dir;
        } catch (err) {
            console.warn('[Local TTS] folder pick failed:', err);
            return '';
        }
    }

    /** Reset the model folder back to the default app location and refresh the list. */
    async _resetModelsDir() {
        await settingsManager.save({ local_tts_models_dir: '' });
        const dirInput = document.getElementById('input-local-models-dir');
        if (dirInput) {
            try {
                dirInput.value = await invoke('local_tts_models_dir_path');
            } catch {
                dirInput.value = 'Default app location';
            }
        }
        await this._refreshLocalVoices();
        this._fillLocalVoices(document.getElementById('select-local-lang')?.value || 'vi');
        this._showToast('Model folder reset to default', 'success');
    }

    _updateTranslationTypeUI(type) {
        const oneway = document.getElementById('section-oneway-langs');
        const twoway = document.getElementById('section-twoway-langs');
        const hintTwoway = document.getElementById('hint-twoway');
        const strictLang = document.getElementById('section-strict-lang');

        if (type === 'two_way') {
            if (oneway) oneway.style.display = 'none';
            if (twoway) twoway.style.display = 'flex';
            if (hintTwoway) hintTwoway.style.display = 'block';
            // Hide strict lang in two-way mode (both languages are specified)
            if (strictLang) strictLang.style.display = 'none';
            // Force-disable TTS in two-way mode to prevent audio feedback loop
            if (this.ttsEnabled) {
                this.ttsEnabled = false;
                this._getActiveTTS().disconnect();
                audioPlayer.stop();
            }
            this._updateTTSButton();
        } else {
            if (oneway) oneway.style.display = 'flex';
            if (twoway) twoway.style.display = 'none';
            if (hintTwoway) hintTwoway.style.display = 'none';
            if (strictLang) strictLang.style.display = 'flex';
            this._updateTTSButton();
        }
    }

    _updateTTSButton() {
        const btn = document.getElementById('btn-tts');
        const iconOff = document.getElementById('icon-tts-off');
        const iconOn = document.getElementById('icon-tts-on');
        const isTwoWay = document.getElementById('select-translation-type')?.value === 'two_way';

        if (btn) {
            btn.classList.toggle('active', this.ttsEnabled);
            btn.classList.toggle('disabled', isTwoWay);
            btn.title = isTwoWay ? 'TTS disabled in two-way mode' : 'Toggle TTS (Ctrl+T)';
        }
        if (iconOff) iconOff.style.display = this.ttsEnabled ? 'none' : 'block';
        if (iconOn) iconOn.style.display = this.ttsEnabled ? 'block' : 'none';
    }

    _speakIfEnabled(text) {
        if (this.ttsEnabled && text?.trim()) {
            this._getActiveTTS().speak(text);
        }
    }

    // ─── Read Mode (in-overlay TTS reader) ─────────────────

    // Conservative per-provider chunk caps (chars). Local is offline (no endpoint cap);
    // cloud providers use safe values; google-free/tiktok stay well under their real caps
    // (TikTok's Rust command hard-caps at 280). Raise only after measuring a live call.
    static get READ_MAX_LEN() {
        return { local: 400, edge: 200, microsoft: 200, google: 200, 'google-free': 120, tiktok: 120 };
    }

    _initReadMode() {
        const toggle = document.getElementById('mode-toggle');
        toggle?.addEventListener('click', () => this._toggleMode());
        document.getElementById('btn-read-play')?.addEventListener('click', () => {
            // Play doubles as Resume when paused — do NOT rebuild the reader.
            if (this._reader && this._reader.state === 'paused') this._reader.play();
            else this._startRead();
        });
        document.getElementById('btn-read-pause')?.addEventListener('click', () => {
            this._reader?.pause();
        });
        document.getElementById('btn-read-stop')?.addEventListener('click', () => this._stopRead());
    }

    _toggleMode() {
        if (this._readMode === 'live') this._enterReadMode();
        else this._exitReadMode();
    }

    async _enterReadMode() {
        // Stop any running Live session AND drain the shared provider's queue so an in-flight
        // Live synth cannot fire onAudioChunk into the Live context after the switch.
        if (this.isRunning) await this.pause();
        try { this._getActiveTTS().disconnect(); } catch { /* provider may be idle */ }

        this._readMode = 'read';
        document.getElementById('mode-toggle')?.classList.add('read-active');
        // Hide live controls, show read panel.
        this._setSel('.source-controls', 'none');
        this._setEl('btn-start', 'none');
        this._setEl('btn-pause', 'none');
        this._setEl('engine-pill', 'none');
        this._setEl('btn-tts', 'none');
        this._setEl('transcript-content', 'none');
        this._setEl('read-panel', '');
        this._resetReadUI();
        this._showReadCapabilityHint();
    }

    _exitReadMode() {
        this._stopRead();
        this._readMode = 'live';
        document.getElementById('mode-toggle')?.classList.remove('read-active');
        this._setSel('.source-controls', '');
        this._setEl('btn-start', '');
        this._setEl('btn-pause', '');
        this._setEl('engine-pill', '');
        this._setEl('btn-tts', '');
        this._setEl('read-panel', 'none');
        this._setEl('transcript-content', '');
    }

    _setEl(id, display) {
        const el = document.getElementById(id);
        if (el) el.style.display = display;
    }

    _setSel(selector, display) {
        const el = document.querySelector(selector);
        if (el) el.style.display = display;
    }

    /** Capability = usability, not method existence. Returns {ok, reason, provider}. */
    async _readCapability() {
        const settings = settingsManager.get();
        const provider = settings.tts_provider || 'edge';
        const tts = this._getActiveTTS();
        if (typeof tts.synthesize !== 'function') {
            return { ok: false, reason: 'Nhà cung cấp TTS này không hỗ trợ chế độ Đọc. Hãy chọn Edge, Local, Microsoft, Google hoặc TikTok.' };
        }
        if (provider === 'google' && !settings.google_tts_api_key) {
            return { ok: false, reason: 'Thiếu Google Cloud API key (Cài đặt → TTS → Google).' };
        }
        if (provider === 'tiktok' && !settings.tiktok_session_id) {
            return { ok: false, reason: 'Thiếu TikTok sessionid (Cài đặt → TTS → TikTok).' };
        }
        if (provider === 'local') {
            const installed = await this._isLocalVoiceInstalled(settings.local_tts_voice);
            if (!installed) return { ok: false, reason: 'Chưa tải model giọng Local (Cài đặt → TTS → Local).' };
        }
        return { ok: true, provider };
    }

    async _showReadCapabilityHint() {
        const hintEl = document.getElementById('read-hint');
        const cap = await this._readCapability();
        const playBtn = document.getElementById('btn-read-play');
        if (this._readMode !== 'read') return;
        if (hintEl) hintEl.textContent = cap.ok ? '' : cap.reason;
        if (playBtn) playBtn.disabled = !cap.ok;
    }

    async _startRead() {
        const cap = await this._readCapability();
        if (!cap.ok) { this._showReadCapabilityHint(); return; }

        const text = (document.getElementById('read-input')?.value || '').trim();
        if (!text) { this._showToast('Nhập văn bản để đọc', 'error'); return; }

        const settings = settingsManager.get();
        const provider = cap.provider;
        const tts = this._getActiveTTS();
        this._configureTTS(tts, settings); // set voice/key/session + client rate

        // Client-side rate: only providers without a server rate param.
        const clientRate = provider === 'google-free' ? (settings.google_free_speed || 1.0)
            : provider === 'tiktok' ? (settings.tiktok_speed || 1.0) : 1.0;
        readAudioPlayer.setReadRate(clientRate);

        const lookahead = provider === 'local' ? 2 : 1;
        const interChunkDelayMs = (provider === 'google-free' || provider === 'tiktok') ? 250 : 0;
        const maxLen = App.READ_MAX_LEN[provider] || 120;

        this._reader?.stop(); // never leak a previous (e.g. paused) reader — it could race audio
        readAudioPlayer.stop();
        this._reader = new Reader({
            synthesize: (t) => tts.synthesize(t),
            player: readAudioPlayer,
            lookahead,
            interChunkDelayMs,
        });
        this._reader.onProgress = (n, total) => this._updateReadProgress(n, total);
        this._reader.onSentence = (i) => this._highlightReadChunk(i);
        this._reader.onChunkError = (i) => this._markReadChunkError(i);
        this._reader.onError = (msg) => this._showToast(msg, 'error');
        this._reader.onState = (state) => this._onReadState(state);

        this._reader.load(text, maxLen);
        if (this._reader.total === 0) { this._showToast('Không có nội dung để đọc', 'error'); return; }
        this._renderReadChunks(this._reader.chunks);
        this._reader.play();
    }

    _stopRead() {
        this._reader?.stop();
        this._reader = null;
        this._resetReadUI();
    }

    _onReadState(state) {
        if (state === 'playing') this._updateReadControls('playing');
        else if (state === 'paused') this._updateReadControls('paused');
        else if (state === 'done' || state === 'stopped') {
            this._updateReadControls('idle');
        }
    }

    _updateReadControls(mode) {
        // mode: 'idle' | 'playing' | 'paused'
        if (mode === 'idle') {
            this._setEl('btn-read-play', '');
            this._setEl('btn-read-pause', 'none');
            this._setEl('btn-read-stop', 'none');
            this._setEl('read-input', '');
            this._setEl('read-output', 'none');
        } else if (mode === 'playing') {
            this._setEl('btn-read-play', 'none');
            this._setEl('btn-read-pause', '');
            this._setEl('btn-read-stop', '');
            this._setEl('read-input', 'none');
            this._setEl('read-output', '');
        } else if (mode === 'paused') {
            this._setEl('btn-read-play', ''); // play acts as resume
            this._setEl('btn-read-pause', 'none');
            this._setEl('btn-read-stop', '');
        }
    }

    _resetReadUI() {
        this._updateReadControls('idle');
        const out = document.getElementById('read-output');
        if (out) out.innerHTML = '';
        const prog = document.getElementById('read-progress');
        if (prog) prog.textContent = '';
        const fill = document.getElementById('read-progress-fill');
        if (fill) fill.style.width = '0%';
    }

    /** Build chunk spans with textContent (never innerHTML) — pasted text is untrusted. */
    _renderReadChunks(chunks) {
        const out = document.getElementById('read-output');
        if (!out) return;
        out.innerHTML = '';
        chunks.forEach((c, i) => {
            const span = document.createElement('span');
            span.className = 'read-chunk';
            span.dataset.index = String(i);
            span.textContent = c + ' ';
            out.appendChild(span);
        });
    }

    _highlightReadChunk(index) {
        const out = document.getElementById('read-output');
        if (!out) return;
        out.querySelectorAll('.read-chunk.active').forEach((el) => el.classList.remove('active'));
        const span = out.querySelector(`.read-chunk[data-index="${index}"]`);
        if (span) {
            span.classList.add('active');
            span.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }

    _markReadChunkError(index) {
        const span = document.getElementById('read-output')
            ?.querySelector(`.read-chunk[data-index="${index}"]`);
        if (span) span.classList.add('error');
    }

    _updateReadProgress(n, total) {
        const prog = document.getElementById('read-progress');
        if (prog) prog.textContent = `đoạn ${n}/${total}`;
        const fill = document.getElementById('read-progress-fill');
        if (fill) fill.style.width = total ? `${Math.round((n / total) * 100)}%` : '0%';
    }

    // ─── Source Control ────────────────────────────────────

    _setSource(source) {
        const wasRunning = this.isRunning;
        const labels = { system: 'System Audio', microphone: 'Microphone', both: 'System + Mic' };
        const label = labels[source] || source;
        // Persist so subsequent settings notifications don't reset us back.
        settingsManager.save({ audio_source: source });

        if (wasRunning) {
            this.pause().then(() => {
                this.currentSource = source;
                this._updateSourceButtons();
                this._showToast(`Switched to ${label}`, 'success');
                this.start();
            });
        } else {
            this.currentSource = source;
            this._updateSourceButtons();
            this._showToast(`Source: ${label}`, 'success');
        }
    }

    _updateSourceButtons() {
        document.getElementById('btn-source-system').classList.toggle('active',
            this.currentSource === 'system');
        document.getElementById('btn-source-mic').classList.toggle('active',
            this.currentSource === 'microphone');
        document.getElementById('btn-source-both').classList.toggle('active',
            this.currentSource === 'both');
    }

    // ─── Engine picker (Standard vs OpenAI) ──────────────────
    // OpenAI Realtime is structurally different (text+voice fused, no two-way,
    // no custom TTS), so we surface the choice as a top-level decision rather
    // than burying it in Settings. "Standard" represents the Soniox/Local pair
    // — they share the same UX shape (text-only, optional TTS, two-way, etc.).

    _engineClassFromMode(mode) {
        if (mode === 'openai') return 'openai';
        if (mode === 'qwen') return 'qwen';
        return 'standard';
    }

    _selectEngineClass(klass) {
        const settings = settingsManager.get();
        const currentMode = settings.translation_mode || 'soniox';
        let nextMode = currentMode;
        if (klass === 'openai') {
            nextMode = 'openai';
        } else if (klass === 'qwen') {
            nextMode = 'qwen';
        } else if (klass === 'standard') {
            // Stay on whatever standard sub-engine was configured before, or
            // default to soniox if previously a cloud realtime engine.
            nextMode = (currentMode === 'soniox' || currentMode === 'local')
                ? currentMode : 'soniox';
        }

        settingsManager.save({ translation_mode: nextMode });
        const select = document.getElementById('select-translation-mode');
        if (select) select.value = nextMode;
        this._updateModeUI(nextMode);
    }

    _updatePillState(mode) {
        const klass = this._engineClassFromMode(mode);
        document.querySelectorAll('#engine-pill .engine-pill-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.engineClass === klass);
        });
    }

    _setEnginePillLocked(locked) {
        const pill = document.getElementById('engine-pill');
        if (!pill) return;
        pill.dataset.locked = locked ? 'true' : 'false';
        pill.querySelectorAll('.engine-pill-btn').forEach(btn => { btn.disabled = locked; });
    }

    _showEnginePicker() {
        const picker = document.getElementById('engine-picker');
        if (picker) picker.style.display = '';
    }

    _hideEnginePicker() {
        const picker = document.getElementById('engine-picker');
        if (picker) picker.style.display = 'none';
        this._enginePickerDismissed = true;
    }

    _maybeShowEnginePicker() {
        // Show on each fresh launch until first dismissal (click on a card or
        // first Start). Once dismissed, the toolbar pill is the only switcher.
        if (this._enginePickerDismissed) return;
        if (this.isRunning || this.isStarting) return;
        if (this.transcriptUI && this.transcriptUI.hasContent()) return;
        this._showEnginePicker();
    }

    _updateModeUI(mode) {
        const isSoniox = mode === 'soniox';
        const isLocal = mode === 'local';
        const isOpenAi = mode === 'openai';
        const isQwen = mode === 'qwen';
        // Cloud-realtime engines that share the OpenAI-style audio toggle,
        // mic-only capture, and dual-panel routing. Used in place of bare
        // `isOpenAi` checks below so Qwen inherits the same UI shape.
        const isCloudRealtime = isOpenAi || isQwen;
        this._updatePillState(mode);

        // Single dynamic hint line per engine (mobile parity). Only #hint-mode-soniox
        // stays visible as the live container; the other hint nodes are kept hidden
        // so existing IDs remain wired but don't clutter the panel.
        const hintSoniox = document.getElementById('hint-mode-soniox');
        const hintLocal = document.getElementById('hint-mode-local');
        const hintOpenAi = document.getElementById('hint-mode-openai');
        const hintQwen = document.getElementById('hint-mode-qwen');
        const ENGINE_HINTS = {
            soniox: 'Cloud · 70+ languages · ~$0.12/hr',
            local: 'Offline · free · ~3–4s delay',
            openai: 'Cloud · 13 languages · text-only captions',
            qwen: 'Cloud · 60+ languages · text-only · free preview · pick a source language',
        };
        if (hintSoniox) {
            hintSoniox.textContent = ENGINE_HINTS[mode] || '';
            hintSoniox.style.display = '';
        }
        if (hintLocal) hintLocal.style.display = 'none';
        if (hintOpenAi) hintOpenAi.style.display = 'none';
        if (hintQwen) hintQwen.style.display = 'none';

        const costWarning = document.getElementById('openai-cost-warning');
        if (costWarning) costWarning.style.display = isOpenAi ? '' : 'none';

        // Mobile-parity: show only the key section for the active engine.
        // Local hides them all (no key needed).
        const sectionApiKey = document.getElementById('section-api-key');
        const sectionOpenAiKey = document.getElementById('section-openai-key');
        const sectionQwenKey = document.getElementById('section-qwen-key');
        if (sectionApiKey) sectionApiKey.style.display = isSoniox ? '' : 'none';
        if (sectionOpenAiKey) sectionOpenAiKey.style.display = isOpenAi ? '' : 'none';
        if (sectionQwenKey) sectionQwenKey.style.display = isQwen ? '' : 'none';

        // Soniox-only features: Custom context, Strict language detection,
        // Endpoint delay. The realtime engines manage these internally.
        const sectionContext = document.getElementById('section-soniox-context');
        if (sectionContext) sectionContext.style.display = isSoniox ? '' : 'none';
        const sectionStrictLang = document.getElementById('section-strict-lang');
        if (sectionStrictLang) sectionStrictLang.style.display = isSoniox ? '' : 'none';
        const sectionEndpointDelay = document.getElementById('section-endpoint-delay');
        if (sectionEndpointDelay) sectionEndpointDelay.style.display = isSoniox ? '' : 'none';

        // Two-way mode incompatible with realtime translation engines — force
        // one-way + disable the option for any cloud-realtime mode.
        const typeSelect = document.getElementById('select-translation-type');
        if (typeSelect) {
            const twoWayOpt = typeSelect.querySelector('option[value="two_way"]');
            if (twoWayOpt) twoWayOpt.disabled = isCloudRealtime;
            if (isCloudRealtime && typeSelect.value === 'two_way') {
                typeSelect.value = 'one_way';
                this._updateTranslationTypeUI('one_way');
            }
        }

        // Custom TTS toggle: cloud realtime engines run text-only to prevent
        // the speaker → mic feedback loop on shared devices.
        const ttsCheck = document.getElementById('check-tts-enabled');
        if (ttsCheck) {
            ttsCheck.disabled = isCloudRealtime;
            if (isCloudRealtime) ttsCheck.checked = false;
            const ttsDetail = document.getElementById('tts-settings-detail');
            if (ttsDetail) ttsDetail.style.display = (isCloudRealtime || !ttsCheck.checked) ? 'none' : '';
        }
        const btnTts = document.getElementById('btn-tts');
        if (btnTts) btnTts.style.display = isCloudRealtime ? 'none' : '';

        // Mobile-parity: hide the entire TTS tab when engine is cloud-realtime.
        // If the user is currently viewing TTS, snap them back to Translation.
        const ttsTabBtn = document.querySelector('.settings-tab[data-tab="tab-tts"]');
        const ttsTabContent = document.getElementById('tab-tts');
        if (ttsTabBtn) ttsTabBtn.style.display = isCloudRealtime ? 'none' : '';
        if (isCloudRealtime && ttsTabBtn?.classList.contains('active')) {
            ttsTabBtn.classList.remove('active');
            if (ttsTabContent) ttsTabContent.classList.remove('active');
            const translationTabBtn = document.querySelector('.settings-tab[data-tab="tab-translation"]');
            const translationTabContent = document.getElementById('tab-translation');
            translationTabBtn?.classList.add('active');
            translationTabContent?.classList.add('active');
        }
        const btnOpenAiAudio = document.getElementById('btn-openai-audio');
        if (btnOpenAiAudio) btnOpenAiAudio.style.display = 'none';

        // All engines now support any audio source (system / mic / both).
        const btnSourceMic = document.getElementById('btn-source-mic');
        if (btnSourceMic) {
            btnSourceMic.disabled = false;
            btnSourceMic.classList.remove('locked');
            btnSourceMic.title = 'Microphone (⌘2)';
        }

        // Restrict target language list to 13 OpenAI-supported in openai mode.
        // Qwen LiveTranslate Flash has its own 60-language list (mirrors mobile
        // v0.4.3); Qwen also hides Auto on the source picker because the model
        // rejects "auto" on real mic input.
        this._refreshTargetLangList(mode);
        this._refreshSourceLangList(mode);
    }

    _refreshTargetLangList(mode) {
        const select = document.getElementById('select-target-lang');
        if (!select) return;
        const OPENAI_LANGS = [
            ['en','English'], ['es','Spanish'], ['pt','Portuguese'], ['fr','French'],
            ['de','German'], ['it','Italian'], ['ru','Russian'], ['hi','Hindi'],
            ['id','Indonesian'], ['vi','Vietnamese'], ['ja','Japanese'],
            ['ko','Korean'], ['zh','Chinese'],
        ];
        const current = select.value;
        if (mode === 'openai') {
            if (!this._fullTargetLangHTML) this._fullTargetLangHTML = select.innerHTML;
            select.innerHTML = OPENAI_LANGS
                .map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
            select.value = OPENAI_LANGS.some(([c]) => c === current) ? current : 'vi';
        } else if (mode === 'qwen') {
            if (!this._fullTargetLangHTML) this._fullTargetLangHTML = select.innerHTML;
            const langs = QWEN_LANGS;
            select.innerHTML = langs
                .map((l) => `<option value="${l.code}">${l.name}</option>`).join('');
            select.value = langs.some((l) => l.code === current) ? current : 'vi';
        } else if (this._fullTargetLangHTML) {
            select.innerHTML = this._fullTargetLangHTML;
            select.value = current || 'vi';
        }
    }

    _refreshSourceLangList(mode) {
        const select = document.getElementById('select-source-lang');
        if (!select) return;
        const current = select.value;
        if (mode === 'qwen') {
            if (!this._fullSourceLangHTML) this._fullSourceLangHTML = select.innerHTML;
            const langs = QWEN_LANGS;
            // No "Auto" — Live Flash stalls after one segment on real mic when
            // source isn't explicit (verified iPhone v0.4.2, 2026-05-25).
            select.innerHTML = langs
                .map((l) => `<option value="${l.code}">${l.name}</option>`).join('');
            const validCurrent = langs.some((l) => l.code === current) && current !== 'auto';
            select.value = validCurrent ? current : 'en';
        } else if (this._fullSourceLangHTML) {
            select.innerHTML = this._fullSourceLangHTML;
            select.value = current || 'auto';
        }
    }

    // ─── API key validation & connection test ─────────────

    // Inline format check — runs on every keystroke. Cheap, no network.
    // Updates: per-field status badge + engine dropdown option enable/disable.
    _refreshKeyStatus() {
        const sonioxKey = document.getElementById('input-api-key')?.value.trim() || '';
        const openaiKey = document.getElementById('input-openai-key')?.value.trim() || '';

        // Soniox keys are opaque hex-like strings, ~32+ chars. Be lenient.
        const sonioxOk = sonioxKey.length >= 20;
        // OpenAI keys start with sk- and are ~50+ chars.
        const openaiOk = /^sk-[A-Za-z0-9_\-]{20,}$/.test(openaiKey);

        const sonioxStatus = document.getElementById('key-status-soniox');
        if (sonioxStatus) {
            sonioxStatus.className = 'key-status ' + (sonioxKey === '' ? '' : sonioxOk ? 'ok' : 'bad');
            sonioxStatus.textContent = sonioxKey === '' ? '' : sonioxOk ? '✓ format ok' : '✗ check format';
        }
        const openaiStatus = document.getElementById('key-status-openai');
        if (openaiStatus) {
            openaiStatus.className = 'key-status ' + (openaiKey === '' ? '' : openaiOk ? 'ok' : 'bad');
            openaiStatus.textContent = openaiKey === '' ? '' : openaiOk ? '✓ format ok' : '✗ should start with sk-';
        }

        // Disable engine options whose key is missing/invalid.
        const select = document.getElementById('select-translation-mode');
        if (select) {
            const sonioxOpt = select.querySelector('option[value="soniox"]');
            const openaiOpt = select.querySelector('option[value="openai"]');
            if (sonioxOpt) {
                sonioxOpt.disabled = !sonioxOk;
                sonioxOpt.textContent = sonioxOk ? '☁️ Soniox' : '☁️ Soniox — add key first';
            }
            if (openaiOpt) {
                openaiOpt.disabled = !openaiOk;
                openaiOpt.textContent = openaiOk ? '⚡ OpenAI Realtime' : '⚡ OpenAI Realtime — add key first';
            }
        }
    }

    // Live ping the provider to verify key actually works.
    async _testConnection(provider) {
        const statusEl = document.getElementById(`key-status-${provider}`);
        const btn = document.getElementById(`btn-test-${provider}`);
        if (!statusEl || !btn) return;

        const inputId = provider === 'soniox' ? 'input-api-key' : 'input-openai-key';
        const key = document.getElementById(inputId)?.value.trim() || '';
        if (!key) {
            statusEl.className = 'key-status bad';
            statusEl.textContent = '✗ empty';
            return;
        }

        btn.disabled = true;
        statusEl.className = 'key-status checking';
        statusEl.textContent = '… testing';

        try {
            const ok = provider === 'soniox'
                ? await this._pingSoniox(key)
                : await this._pingOpenAi(key);
            statusEl.className = 'key-status ' + (ok ? 'ok' : 'bad');
            statusEl.textContent = ok ? '✓ connected' : '✗ rejected';
        } catch (e) {
            statusEl.className = 'key-status bad';
            statusEl.textContent = '✗ ' + (e?.message || 'failed');
        } finally {
            btn.disabled = false;
        }
    }

    // Soniox: open WS, send config, wait for first response, close.
    _pingSoniox(apiKey) {
        return new Promise((resolve) => {
            const ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
            const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(false); }, 5000);
            ws.onopen = () => {
                ws.send(JSON.stringify({ api_key: apiKey, model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1 }));
            };
            ws.onmessage = (e) => {
                clearTimeout(timer);
                try {
                    const v = JSON.parse(e.data);
                    resolve(!v.error_code);
                } catch { resolve(true); }
                try { ws.close(); } catch {}
            };
            ws.onerror = () => { clearTimeout(timer); resolve(false); };
        });
    }

    // OpenAI: cheap HTTP GET /v1/models with the key.
    async _pingOpenAi(apiKey) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        try {
            const r = await fetch('https://api.openai.com/v1/models', {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: ctrl.signal,
            });
            return r.ok;
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    // ─── Start/Stop ────────────────────────────────────────

    async start() {
        const settings = settingsManager.get();
        this.translationMode = settings.translation_mode || 'soniox';
        console.log('[App] start() called, translation_mode:', this.translationMode, 'settings:', JSON.stringify(settings));

        // Check Soniox API key only for cloud mode
        if (this.translationMode === 'soniox' && !settings.soniox_api_key) {
            this._showToast('Soniox API key is required. Add it in Settings.', 'error');
            this._showView('settings');
            return;
        }

        // Check OpenAI API key for openai mode
        if (this.translationMode === 'openai' && !settings.openai_api_key) {
            this._showToast('OpenAI API key is required. Add it in Settings.', 'error');
            this._showView('settings');
            return;
        }

        // Check Qwen API key for qwen mode
        if (this.translationMode === 'qwen' && !settings.qwen_api_key) {
            this._showToast('Qwen (DashScope) API key is required. Add it in Settings.', 'error');
            this._showView('settings');
            return;
        }

        // Check ElevenLabs key only if TTS is enabled AND provider is elevenlabs
        if (this.ttsEnabled && settings.tts_provider === 'elevenlabs' && !settings.elevenlabs_api_key) {
            this._showToast('TTS is ON but ElevenLabs API key is missing. Add it in Settings or disable TTS.', 'error');
            this._showView('settings');
            return;
        }

        this.isRunning = true;
        this._updateStartButton();
        this._hideEnginePicker();
        this._setEnginePillLocked(true);
        if (!this.recordingStartTime) this.recordingStartTime = Date.now();

        // Record session metadata for auto-save
        if (!this.sessionStartTime) {
            this.sessionStartTime = new Date();
            const translationType = settings.translation_type || 'one_way';
            this.sessionMode = translationType;
            if (translationType === 'two_way') {
                this.sessionSourceLang = settings.language_a || 'ja';
                this.sessionTargetLang = settings.language_b || 'vi';
            } else {
                this.sessionSourceLang = settings.source_language || 'auto';
                this.sessionTargetLang = settings.target_language || 'vi';
            }
        }

        // Begin a session chunk — every Start/Stop cycle becomes one chunk in
        // the persistent SessionStore. Engine/lang may have changed since
        // last chunk, so pass them in.
        sessionStore.beginChunk({
            engine: this.translationMode,
            sourceLang: this.sessionSourceLang,
            targetLang: this.sessionTargetLang,
        });

        // Clear transcript only if nothing is showing
        if (!this.transcriptUI.hasContent()) {
            this.transcriptUI.showListening();
        } else {
            this.transcriptUI.clearProvisional();
        }

        if (this.translationMode === 'local') {
            await this._startLocalMode(settings);
        } else if (this.translationMode === 'openai') {
            await this._startOpenAiMode(settings);
        } else if (this.translationMode === 'qwen') {
            await this._startQwenMode(settings);
        } else {
            await this._startSonioxMode(settings);
        }

        // Start TTS if enabled — skipped in realtime modes (built-in audio)
        if (this.ttsEnabled && this.translationMode !== 'openai' && this.translationMode !== 'qwen') {
            const tts = this._getActiveTTS();
            this._configureTTS(tts, settings);
            tts.connect();
            audioPlayer.resume();
        }
    }

    async _startOpenAiMode(settings) {
        this._updateStatus('connecting');
        const { OpenAiRealtimeClient } = await import('./openai-realtime-client.js');
        const { OpenAiAudioOutputQueue } = await import('./openai-audio-output-queue.js');

        // Tell the UI which provider is active so dual-panel rendering routes
        // provisional text to the correct panel (source vs target).
        this.transcriptUI.provider = 'openai';

        this.openAiOutputQueue = new OpenAiAudioOutputQueue();
        this.openAiClient = new OpenAiRealtimeClient();

        this.openAiClient.onStatusChange = (state) => {
            if (state === 'ready') this._updateStatus('connected');
            else if (state === 'connecting') this._updateStatus('connecting');
        };
        this.openAiClient.onProvisional = (text) => {
            this.transcriptUI.setProvisional(text, null, null);
        };
        this.openAiClient.onSourceProvisional = (text) => {
            // Source-side provisional: keep dual panel responsive while ASR runs.
            this.transcriptUI.setSourceProvisional?.(text);
        };
        this.openAiClient.onSegment = (sourceText, translatedText) => {
            // Pair source + translation atomically so FIFO matching in addTranslation works.
            if (sourceText) this.transcriptUI.addOriginal(sourceText, null, null);
            this.transcriptUI.addTranslation(translatedText);
            // Atomic write to session store — bypass UI's loose FIFO since
            // OpenAI gives us both texts in one event.
            sessionStore.addSegment(sourceText || '', translatedText || '');
            this.transcriptUI.clearSourceProvisional?.();
            this.transcriptUI.clearProvisional();
        };
        this.openAiClient.onError = (code, msg) => {
            console.error('[OpenAI Realtime]', code, msg);
            this._showToast(`${code}: ${msg}`, 'error');
            this._updateStatus('error');
        };
        this.openAiClient.onClosed = (reason) => {
            console.warn('[OpenAI Realtime] closed:', reason);
            if (this.isRunning) {
                this._showToast('OpenAI session closed — reconnecting…', 'success');
                setTimeout(() => {
                    if (this.isRunning) this._startOpenAiMode(settingsManager.get());
                }, 1000);
            }
        };

        try {
            await this.openAiClient.connect({
                apiKey: settings.openai_api_key,
                sourceLanguage: settings.source_language || 'auto',
                targetLanguage: settings.target_language,
                audioOutput: false,
            }, this.openAiOutputQueue);
        } catch (err) {
            this._showToast(`OpenAI connect failed: ${err}`, 'error');
            await this.pause();
            return;
        }

        try {
            let audioBatchCount = 0;
            const channel = new window.__TAURI__.core.Channel();
            channel.onmessage = (pcmData) => {
                audioBatchCount++;
                if (audioBatchCount <= 3 || audioBatchCount % 50 === 0) {
                    console.log(`[OpenAI capture] batch #${audioBatchCount}, size:`, pcmData?.length || 0);
                }
                const bytes = new Uint8Array(pcmData);
                this.openAiClient.sendAudio(bytes.buffer);
            };
            console.log('[OpenAI] Starting audio capture, source:', this.currentSource);
            await invoke('start_capture', {
                source: this.currentSource,
                channel,
            });
            console.log('[OpenAI] start_capture invoked OK');
        } catch (err) {
            console.error('Failed to start audio capture:', err);
            this._showToast(`Audio error: ${err}`, 'error');
            await this.pause();
        }
    }

    async _startQwenMode(settings) {
        this._updateStatus('connecting');
        const { QwenRealtimeClient } = await import('./qwen-realtime-client.js');

        // Live Flash is translation-only (no source transcript). Force the
        // single-panel translation view; dual-panel would render an empty
        // source column.
        this.transcriptUI.provider = 'qwen';

        this.qwenClient = new QwenRealtimeClient();

        this.qwenClient.onStatusChange = (state) => {
            if (state === 'ready') this._updateStatus('connected');
            else if (state === 'connecting') this._updateStatus('connecting');
        };
        this.qwenClient.onProvisional = (text) => {
            this.transcriptUI.setProvisional(text, null, null);
        };
        this.qwenClient.onSegment = (sourceText, translatedText) => {
            this.transcriptUI.addTranslation(translatedText);
            sessionStore.addSegment('', translatedText || '');
            this.transcriptUI.clearProvisional();
        };
        this.qwenClient.onError = (code, msg) => {
            console.error('[Qwen Realtime]', code, msg);
            this._showToast(`${code}: ${msg}`, 'error');
            this._updateStatus('error');
        };
        this.qwenClient.onClosed = (reason) => {
            console.warn('[Qwen Realtime] closed:', reason);
            if (this.isRunning) {
                this._showToast('Qwen session closed — reconnecting…', 'success');
                setTimeout(() => {
                    if (this.isRunning) this._startQwenMode(settingsManager.get());
                }, 1000);
            }
        };

        try {
            // Live Flash rejects "auto" — fall back to English. UI also
            // strips the "auto" option when engine = qwen (see
            // _refreshSourceLangList), so this is belt-and-suspenders.
            const sourceLang =
                settings.source_language && settings.source_language !== 'auto'
                    ? settings.source_language
                    : 'en';
            await this.qwenClient.connect({
                apiKey: settings.qwen_api_key,
                sourceLanguage: sourceLang,
                targetLanguage: settings.target_language,
            });
        } catch (err) {
            this._showToast(`Qwen connect failed: ${err}`, 'error');
            await this.pause();
            return;
        }

        try {
            let audioBatchCount = 0;
            const channel = new window.__TAURI__.core.Channel();
            channel.onmessage = (pcmData) => {
                audioBatchCount++;
                if (audioBatchCount <= 3 || audioBatchCount % 50 === 0) {
                    console.log(`[Qwen capture] batch #${audioBatchCount}, size:`, pcmData?.length || 0);
                }
                const bytes = new Uint8Array(pcmData);
                this.qwenClient.sendAudio(bytes.buffer);
            };
            console.log('[Qwen] Starting audio capture, source:', this.currentSource);
            await invoke('start_capture', {
                source: this.currentSource,
                channel,
            });
            console.log('[Qwen] start_capture invoked OK');
        } catch (err) {
            console.error('Failed to start audio capture:', err);
            this._showToast(`Audio error: ${err}`, 'error');
            await this.pause();
        }
    }

    async _startSonioxMode(settings) {
        // Connect to Soniox
        console.log('[App] Connecting to Soniox...');
        this.transcriptUI.provider = 'soniox';
        this._updateStatus('connecting');
        sonioxClient.connect({
            apiKey: settings.soniox_api_key,
            sourceLanguage: settings.source_language,
            targetLanguage: settings.target_language,
            customContext: settings.custom_context,
            translationType: settings.translation_type || 'one_way',
            languageA: settings.language_a,
            languageB: settings.language_b,
            languageHintsStrict: settings.language_hints_strict || false,
            endpointDelay: settings.endpoint_delay || 3000,
        });

        // Start audio capture — Rust batches audio every 200ms, JS just forwards
        try {
            let audioChunkCount = 0;

            const channel = new window.__TAURI__.core.Channel();
            channel.onmessage = (pcmData) => {
                audioChunkCount++;
                if (audioChunkCount <= 3 || audioChunkCount % 50 === 0) {
                    console.log(`[Audio] Batch #${audioChunkCount}, size:`, pcmData?.length || 0);
                }
                // Forward batched audio to Soniox
                const bytes = new Uint8Array(pcmData);
                sonioxClient.sendAudio(bytes.buffer);
            };

            console.log('[App] Starting audio capture, source:', this.currentSource);
            await invoke('start_capture', {
                source: this.currentSource,
                channel: channel,
            });
            console.log('[App] Audio capture started successfully');
        } catch (err) {
            console.error('Failed to start audio capture:', err);
            this._showToast(`Audio error: ${err}`, 'error');
            await this.pause();
        }
    }

    async _startLocalMode(settings) {
        console.log('[App] Starting Local mode (MLX models)...');
        this.transcriptUI.provider = 'soniox';
        this._updateStatus('connecting');

        // Step 0: Check audio permission FIRST (before loading models)
        try {
            await invoke('start_capture', {
                source: this.currentSource,
                channel: new window.__TAURI__.core.Channel(), // dummy channel for permission check
            });
            await invoke('stop_capture');
        } catch (err) {
            console.error('[App] Audio permission check failed:', err);
            this._showToast(`Audio permission required: ${err}`, 'error');
            this.isRunning = false;
            this._updateStartButton();
            this._updateStatus('error');
            this.transcriptUI.clear();
            this.transcriptUI.showPlaceholder();
            return;
        }

        // Step 1: Check if MLX setup is complete
        try {
            const checkResult = await invoke('check_mlx_setup');
            const status = JSON.parse(checkResult);
            if (!status.ready) {
                this._showToast('Setting up MLX models (one-time, ~5GB)...', 'success');
                this.transcriptUI.showStatusMessage('Downloading MLX models (one-time setup)...');
                await this._runMlxSetup();
            }
        } catch (err) {
            console.warn('[App] MLX check failed (proceeding anyway):', err);
        }

        console.log('[App] MLX check passed, starting pipeline...');

        // Step 1: Start pipeline FIRST (independent of audio)
        try {
            this._showToast('Starting local pipeline...', 'success');

            this.localPipelineChannel = new window.__TAURI__.core.Channel();
            this.localPipelineReady = false;

            this.localPipelineChannel.onmessage = (msg) => {
                let data;
                try {
                    data = (typeof msg === 'string') ? JSON.parse(msg) : msg;
                } catch (e) {
                    console.warn('[Local] JSON parse failed:', typeof msg, msg);
                    return;
                }
                try {
                    this._handleLocalPipelineResult(data);
                } catch (e) {
                    console.error('[Local] Handler error for type:', data?.type, e);
                }
            };

            const sourceLangMap = {
                'auto': 'auto', 'ja': 'Japanese', 'en': 'English',
                'zh': 'Chinese', 'ko': 'Korean', 'vi': 'Vietnamese',
            };
            const sourceLang = sourceLangMap[settings.source_language] || 'Japanese';

            await invoke('start_local_pipeline', {
                sourceLang: sourceLang,
                targetLang: settings.target_language || 'vi',
                channel: this.localPipelineChannel,
            });
            console.log('[App] Local pipeline spawned');
        } catch (err) {
            console.error('Failed to start pipeline:', err);
            this._showToast(`Pipeline error: ${err}`, 'error');
            await this.pause();
            return;
        }

        // Step 2: Start audio capture
        try {
            const audioChannel = new window.__TAURI__.core.Channel();
            let audioChunkCount = 0;

            audioChannel.onmessage = async (pcmData) => {
                audioChunkCount++;
                if (audioChunkCount <= 3 || audioChunkCount % 50 === 0) {
                    console.log(`[Local] Audio batch #${audioChunkCount}, size:`, pcmData?.length || 0);
                }
                try {
                    await invoke('send_audio_to_pipeline', { data: Array.from(new Uint8Array(pcmData)) });
                } catch (e) {
                    // Pipeline may not be ready yet
                }
            };

            await invoke('start_capture', {
                source: this.currentSource,
                channel: audioChannel,
            });
            console.log('[App] Audio capture started');
        } catch (err) {
            console.error('Audio capture failed (pipeline still running):', err);
            this._showToast(`Audio: ${err}. Pipeline still loading...`, 'error');
        }
    }

    _handleLocalPipelineResult(data) {
        switch (data.type) {
            case 'ready':
                this.localPipelineReady = true;
                this._updateStatus('connected');
                this.transcriptUI.removeStatusMessage();
                this.transcriptUI.showListening();
                this._showToast('Local models ready!', 'success');
                break;
            case 'result':
                // Chase effect: show original first (gray), then translation (white)
                if (data.original) {
                    this.transcriptUI.addOriginal(data.original);
                }
                // Small delay for visual "chase" effect
                setTimeout(() => {
                if (data.translated) {
                    this.transcriptUI.addTranslation(data.translated);
                    this._speakIfEnabled(data.translated);
                }
                }, 80);
                // Persist atomically — Local pipeline gives both texts in
                // one event so we don't need FIFO pairing.
                sessionStore.addSegment(data.original || '', data.translated || '');
                break;
            case 'status':
                const msg = data.message || 'Loading...';
                // Status bar: show compact message (strip [pipeline] prefix)
                const statusText = document.getElementById('status-text');
                if (statusText) {
                    const compact = msg.replace(/^\[pipeline\]\s*/, '');
                    statusText.textContent = compact;
                }
                // Transcript area: only show loading/starting messages, not debug logs
                if (!msg.startsWith('[pipeline]')) {
                    this.transcriptUI.showStatusMessage(msg);
                }
                break;
            case 'done':
                this._updateStatus('disconnected');
                break;
        }
    }

    async _runMlxSetup() {
        const modal = document.getElementById('setup-modal');
        const progressFill = document.getElementById('setup-progress-fill');
        const progressPct = document.getElementById('setup-progress-pct');
        const statusText = document.getElementById('setup-status-text');
        const cancelBtn = document.getElementById('btn-cancel-setup');

        // Step mapping: step name → total progress weight
        const stepWeights = { check: 5, venv: 10, packages: 35, models: 50 };
        let totalProgress = 0;

        const updateStep = (stepName, icon, isActive) => {
            const stepEl = document.getElementById(`step-${stepName}`);
            if (!stepEl) return;
            stepEl.querySelector('.step-icon').textContent = icon;
            stepEl.classList.toggle('active', isActive);
            stepEl.classList.toggle('done', icon === '✅');
        };

        const updateProgress = (pct) => {
            totalProgress = Math.min(100, pct);
            progressFill.style.width = totalProgress + '%';
            progressPct.textContent = Math.round(totalProgress) + '%';
        };

        // Show modal
        modal.style.display = 'flex';

        return new Promise((resolve, reject) => {
            const channel = new window.__TAURI__.core.Channel();

            // Cancel handler
            const onCancel = () => {
                modal.style.display = 'none';
                reject(new Error('Setup cancelled'));
            };
            cancelBtn.addEventListener('click', onCancel, { once: true });

            channel.onmessage = (msg) => {
                let data;
                try {
                    data = (typeof msg === 'string') ? JSON.parse(msg) : msg;
                } catch (e) {
                    return;
                }

                switch (data.type) {
                    case 'progress':
                        statusText.textContent = data.message || 'Working...';

                        // Update step indicators
                        if (data.step) {
                            // Mark previous steps as done
                            const steps = ['check', 'venv', 'packages', 'models'];
                            const currentIdx = steps.indexOf(data.step);
                            steps.forEach((s, i) => {
                                if (i < currentIdx) updateStep(s, '✅', false);
                                else if (i === currentIdx) updateStep(s, '🔄', true);
                            });

                            if (data.done) {
                                updateStep(data.step, '✅', false);
                            }

                            // Calculate overall progress
                            let pct = 0;
                            steps.forEach((s, i) => {
                                if (i < currentIdx) pct += stepWeights[s];
                                else if (i === currentIdx) {
                                    pct += (data.progress || 0) / 100 * stepWeights[s];
                                }
                            });
                            updateProgress(pct);
                        }
                        break;

                    case 'complete':
                        updateProgress(100);
                        statusText.textContent = '✅ ' + (data.message || 'Setup complete!');
                        ['check', 'venv', 'packages', 'models'].forEach(s => updateStep(s, '✅', false));

                        // Close modal after brief delay
                        setTimeout(() => {
                            modal.style.display = 'none';
                            resolve();
                        }, 1000);
                        break;

                    case 'error':
                        statusText.textContent = '❌ ' + (data.message || 'Setup failed');
                        cancelBtn.textContent = 'Close';
                        cancelBtn.removeEventListener('click', onCancel);
                        cancelBtn.addEventListener('click', () => {
                            modal.style.display = 'none';
                            reject(new Error(data.message));
                        }, { once: true });
                        break;

                    case 'log':
                        console.log('[MLX Setup]', data.message);
                        break;
                }
            };

            invoke('run_mlx_setup', { channel })
                .catch(err => {
                    statusText.textContent = '❌ ' + err;
                    modal.style.display = 'none';
                    reject(err);
                });
        });
    }

    // Pause: stop capture and persist the current chunk, but keep the session
    // file open. The next Start appends a new chunk to the same file. Finalizing
    // into a new file is stopSession()'s job.
    async pause() {
        this.isRunning = false;
        this._updateStartButton();
        this._setEnginePillLocked(false);

        // Stop audio capture
        try {
            await invoke('stop_capture');
        } catch (err) {
            console.error('Failed to stop audio capture:', err);
        }

        if (this.translationMode === 'local') {
            // Stop local pipeline
            try {
                await invoke('stop_local_pipeline');
            } catch (err) {
                console.error('Failed to stop local pipeline:', err);
            }
            this.localPipelineReady = false;
            this.transcriptUI.removeStatusMessage();
            this._updateStatus('disconnected');
        } else if (this.translationMode === 'openai') {
            if (this.openAiClient) {
                try { await this.openAiClient.disconnect(); } catch {}
                this.openAiClient = null;
            }
            if (this.openAiOutputQueue) {
                this.openAiOutputQueue.close();
                this.openAiOutputQueue = null;
            }
            this._updateStatus('disconnected');
        } else if (this.translationMode === 'qwen') {
            if (this.qwenClient) {
                try { await this.qwenClient.disconnect(); } catch {}
                this.qwenClient = null;
            }
            try { await invoke('stop_capture'); } catch {}
            this._updateStatus('disconnected');
        } else {
            // Disconnect Soniox
            sonioxClient.disconnect();
        }

        // Keep transcript visible — don't clear
        this.transcriptUI.clearProvisional();

        // Stop TTS
        elevenLabsTTS.disconnect();
        edgeTTSRust.disconnect();

        audioPlayer.stop();

        // Drain any leftover Soniox originals that didn't get paired
        if (this._sonioxOriginalQueue) this._sonioxOriginalQueue.length = 0;

        // Close the chunk and persist the whole session (md + json sidecar).
        // Transcript stays on screen — clearSession is no longer called here
        // so user can review & continue in next chunk.
        sessionStore.endChunk();
        const result = await sessionStore.persist();
        if (result === 'saved') {
            const n = sessionStore.totalSegmentCount();
            this._showToast(`Saved ${n} segment${n === 1 ? '' : 's'}`, 'success');
        } else if (result === 'failed') {
            this._showToast('Save failed — session kept in memory', 'error');
        }
        // 'skipped' → data already on disk or nothing to save; no toast.

        // sessionStartTime stays — pausing keeps the same session file, which
        // lives across many Start/Pause cycles. stopSession() resets it.
    }

    // Stop: pause (if running), finalize the current session file, then start a
    // fresh session so the next Start writes a new file pair. Keeps the
    // transcript on screen. Never wipes in-memory data on a failed save.
    async stopSession() {
        if (this.isRunning) await this.pause();

        if (sessionStore.isEmpty()) {
            this._showToast('Nothing to save', 'success');
        } else {
            const result = await sessionStore.endSession();
            if (result === 'failed') {
                // Keep the in-memory session intact so the user can retry Stop.
                this._showToast('Save failed — session kept in memory', 'error');
                return;
            }
            this._showToast('Session saved — next start creates a new one', 'success');
        }

        // Reset session identity: fresh ID + current settings so the next Start
        // writes a new file. Resetting sessionStartTime forces start() to
        // re-stamp the metadata block with the current language pair.
        this.sessionStartTime = null;
        const settings = settingsManager.get();
        sessionStore.init({
            engine: settings.translation_mode || 'soniox',
            sourceLang: settings.source_language || 'auto',
            targetLang: settings.target_language || 'vi',
        });
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Persist the session on the way out. endSession() first (cheap local write
    // that finalizes the file), then best-effort engine teardown via pause().
    // Both are idempotent, so running this more than once is harmless.
    async _flushOnExit() {
        try { await sessionStore.endSession(); } catch (e) { console.error('[App] exit flush (endSession) failed:', e); }
        try { await this.pause(); } catch (e) { console.error('[App] exit flush (pause) failed:', e); }
    }

    // Two close routes, one flush:
    //  • window ✕ / appWindow.close() → onCloseRequested (frontend)
    //  • Cmd+Q / Dock quit → Rust RunEvent::ExitRequested emits 'app-exit-requested'
    // Both flush (raced against a 3s deadline so a hung engine can't wedge the
    // app) then exit_app, which force-exits the process cleanly in Rust.
    async _bindCloseHooks() {
        await this.appWindow.onCloseRequested(async (event) => {
            if (this._closing) return;
            this._closing = true;
            event.preventDefault();
            await Promise.race([this._flushOnExit(), this._sleep(3000)]);
            try {
                await invoke('exit_app');
            } catch {
                try { await this.appWindow.destroy(); } catch {}
            }
        });

        await this.appWindow.listen('app-exit-requested', async () => {
            if (this._closing) return;
            this._closing = true;
            await Promise.race([this._flushOnExit(), this._sleep(3000)]);
            try { await invoke('exit_app'); } catch {}
        });
    }

    _updateStartButton() {
        const btn = document.getElementById('btn-start');
        const iconPlay = document.getElementById('icon-play');
        const iconStop = document.getElementById('icon-stop');

        btn.classList.toggle('recording', this.isRunning);
        iconPlay.style.display = this.isRunning ? 'none' : 'block';
        iconStop.style.display = this.isRunning ? 'block' : 'none';

        // Pause is only actionable while running. (Don't also gate on isStarting:
        // start() calls this while isStarting is still true, and the click handler
        // already guards the starting window.)
        const btnPause = document.getElementById('btn-pause');
        if (btnPause) btnPause.disabled = !this.isRunning;
    }

    // ─── Transcript Persistence ───────────────────────────────

    _formatDuration(ms) {
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}m ${sec}s`;
    }

    async _saveTranscriptFile() {
        const startMs = this.recordingStartTime || Date.now();
        const durationMs = Date.now() - startMs;
        const duration = this._formatDuration(durationMs);

        // Use session metadata captured at start()
        const sourceLang = this.sessionSourceLang || document.getElementById('select-source-lang')?.value || 'auto';
        const targetLang = this.sessionTargetLang || document.getElementById('select-target-lang')?.value || 'vi';
        const mode = this.sessionMode || 'one_way';

        const content = this.transcriptUI.getFullSessionText({
            model: this.translationMode === 'soniox' ? 'Soniox Cloud API' : 'Local MLX Whisper',
            sourceLang,
            targetLang,
            duration,
            mode,
            audioSource: this.currentSource,
        });

        if (!content) return;

        try {
            const path = await invoke('save_transcript', { content });
            const filename = path.split('/').pop();
            this._showToast(`Saved: ${filename}`, 'success');
        } catch (err) {
            console.error('Failed to save transcript:', err);
            this._showToast('Failed to save transcript', 'error');
        }
    }

    // ─── Status ────────────────────────────────────────────

    _updateStatus(status) {
        const dot = document.getElementById('status-indicator');
        const text = document.getElementById('status-text');

        dot.className = 'status-dot';

        switch (status) {
            case 'connecting':
                dot.classList.add('connecting');
                text.textContent = 'Connecting...';
                break;
            case 'connected':
                dot.classList.add('connected');
                text.textContent = 'Listening';
                break;
            case 'disconnected':
                dot.classList.add('disconnected');
                text.textContent = 'Ready';
                break;
            case 'error':
                dot.classList.add('error');
                text.textContent = 'Error';
                break;
        }
    }

    // ─── Window Position ───────────────────────────────────

    async _saveWindowPosition() {
        try {
            const factor = await this.appWindow.scaleFactor();
            const pos = await this.appWindow.outerPosition();
            const size = await this.appWindow.innerSize();
            // Save logical coordinates (physical / scaleFactor)
            localStorage.setItem('window_state', JSON.stringify({
                x: Math.round(pos.x / factor),
                y: Math.round(pos.y / factor),
                width: Math.round(size.width / factor),
                height: Math.round(size.height / factor),
            }));
        } catch (err) {
            console.error('Failed to save window position:', err);
        }
    }

    async _restoreWindowPosition() {
        try {
            const saved = localStorage.getItem('window_state');
            if (!saved) return;

            const state = JSON.parse(saved);
            const { LogicalPosition, LogicalSize } = window.__TAURI__.window;

            // Validate — don't restore if position seems off-screen
            if (state.x < -100 || state.y < -100 || state.x > 5000 || state.y > 3000) {
                console.warn('Saved window position looks off-screen, skipping restore');
                localStorage.removeItem('window_state');
                return;
            }

            if (state.width && state.height && state.width >= 300 && state.height >= 100) {
                await this.appWindow.setSize(new LogicalSize(state.width, state.height));
            }
            if (state.x !== undefined && state.y !== undefined) {
                await this.appWindow.setPosition(new LogicalPosition(state.x, state.y));
            }
        } catch (err) {
            console.error('Failed to restore window position:', err);
            localStorage.removeItem('window_state');
        }
    }

    // ─── Pin / Unpin (Always on Top) ────────────────────

    async _togglePin() {
        this.isPinned = !this.isPinned;
        await this.appWindow.setAlwaysOnTop(this.isPinned);
        const btn = document.getElementById('btn-pin');
        if (btn) btn.classList.toggle('active', this.isPinned);
        this._showToast(this.isPinned ? 'Pinned on top' : 'Unpinned — window can go behind other apps', 'success');
    }

    // ─── Compact Mode ───────────────────────────────

    _toggleCompact() {
        this.isCompact = !this.isCompact;
        const dragRegion = document.getElementById('drag-region');
        const overlay = document.getElementById('overlay-view');

        if (this.isCompact) {
            dragRegion.classList.add('compact-hidden');
            overlay.classList.add('compact-mode');
        } else {
            dragRegion.classList.remove('compact-hidden');
            overlay.classList.remove('compact-mode');
        }
    }

    _toggleViewMode() {
        const isDual = this.transcriptUI.viewMode === 'dual';
        const newMode = isDual ? 'single' : 'dual';
        this.transcriptUI.configure({ viewMode: newMode });
        const btn = document.getElementById('btn-view-mode');
        if (btn) btn.classList.toggle('active', newMode === 'dual');
    }

    _adjustFontSize(delta) {
        const current = this.transcriptUI.fontSize || 16;
        const newSize = Math.max(12, Math.min(140, current + delta));
        this.transcriptUI.configure({ fontSize: newSize });

        // Update display
        const display = document.getElementById('font-size-display');
        if (display) display.textContent = newSize;

        // Sync with settings slider
        const slider = document.getElementById('range-font-size');
        if (slider) slider.value = newSize;
        const sliderVal = document.getElementById('font-size-value');
        if (sliderVal) sliderVal.textContent = `${newSize}px`;
    }

    // ─── Toast ─────────────────────────────────────────────

    // ─── Session History ───────────────────────────────────

    async _showSessions(query) {
        const listEl = document.getElementById('sessions-list');
        const listPanel = document.getElementById('sessions-list-panel');
        const viewer = document.getElementById('session-viewer');

        if (listPanel) listPanel.style.display = '';
        if (viewer) viewer.style.display = 'none';
        if (!listEl) return;

        listEl.innerHTML = '<div class="sessions-loading">Loading...</div>';

        try {
            const cmd = query && query.trim() ? 'search_sessions' : 'list_sessions';
            const args = query && query.trim() ? { query: query.trim() } : {};
            const sessions = await invoke(cmd, args);
            if (sessions.length === 0) {
                listEl.innerHTML = '<div class="sessions-empty">No saved sessions yet.</div>';
                return;
            }

            listEl.innerHTML = sessions.map(s => this._renderSessionItem(s)).join('');

            listEl.querySelectorAll('.session-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.session-delete-btn')) return;
                    const id = item.dataset.id;
                    const legacy = item.dataset.legacy === '1';
                    this._openSession(id, legacy);
                });
            });
            listEl.querySelectorAll('.session-delete-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    // Block deleting the active session — the next autosave would
                    // just resurrect the file the user deleted.
                    if (id === sessionStore.id) {
                        this._showToast('Cannot delete the active session — Stop it first', 'error');
                        return;
                    }
                    if (!confirm('Delete this session permanently?')) return;
                    try {
                        await invoke('delete_session', { id });
                        await this._showSessions();
                    } catch (err) {
                        this._showToast(`Delete failed: ${err}`, 'error');
                    }
                });
            });
        } catch (err) {
            listEl.innerHTML = `<div class="sessions-empty">Error: ${err}</div>`;
        }
    }

    _renderSessionItem(s) {
        const title = this._esc(s.title || 'Untitled session');
        const created = this._esc(s.created_at || '').slice(0, 16);
        const duration = this._formatSeconds(s.duration_sec || 0);
        const engine = s.engine || 'unknown';
        const engineBadge = s.has_legacy_only
            ? `<span class="session-badge badge-legacy">legacy</span>`
            : `<span class="session-badge badge-engine">${this._esc(engine)}</span>`;
        const langPair = s.source_lang && s.target_lang
            ? `<span class="session-badge">${this._esc(s.source_lang)} → ${this._esc(s.target_lang)}</span>`
            : '';
        const segCount = s.segment_count > 0 ? `<span class="session-meta-dim">${s.segment_count} segments</span>` : '';
        const chunks = s.chunk_count > 1 ? `<span class="session-meta-dim">${s.chunk_count} chunks</span>` : '';
        const delBtn = `<button class="session-delete-btn" title="Delete" data-id="${this._escAttr(s.id)}">×</button>`;
        return `<div class="session-item" data-id="${this._escAttr(s.id)}" data-legacy="${s.has_legacy_only ? '1' : '0'}">
            <div class="session-item-row1">
                <span class="session-item-title">${title}</span>
                ${delBtn}
            </div>
            <div class="session-item-row2">
                ${engineBadge}
                ${langPair}
                <span class="session-meta-dim">${created}</span>
                ${duration ? `<span class="session-meta-dim">${duration}</span>` : ''}
                ${segCount}
                ${chunks}
            </div>
        </div>`;
    }

    async _openSession(id, isLegacy = false) {
        const listPanel = document.getElementById('sessions-list-panel');
        const viewer = document.getElementById('session-viewer');
        const title = document.getElementById('session-viewer-title');
        const content = document.getElementById('session-viewer-content');

        if (listPanel) listPanel.style.display = 'none';
        if (viewer) viewer.style.display = '';
        if (title) title.textContent = id;
        if (content) content.textContent = 'Loading...';
        this._currentViewedSession = { id, isLegacy };

        try {
            if (isLegacy) {
                const text = await invoke('read_legacy_session', { id });
                if (content) content.textContent = text;
                if (title) title.textContent = id;
            } else {
                const result = await invoke('read_session', { id });
                if (content) content.textContent = result.md;
                if (title) title.textContent = result.json.title || id;
            }
        } catch (err) {
            if (content) content.textContent = `Error loading session: ${err}`;
        }
    }

    _formatSeconds(sec) {
        if (!sec) return '';
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m`;
        return `${sec}s`;
    }

    async _exportCurrentSession(format) {
        const cur = this._currentViewedSession;
        if (!cur || cur.isLegacy) {
            this._showToast('Cannot export legacy sessions', 'error');
            return;
        }
        try {
            const cmd = format === 'srt' ? 'export_session_srt' : 'export_session_txt';
            const text = await invoke(cmd, { id: cur.id });
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${cur.id}.${format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this._showToast(`Exported .${format}`, 'success');
        } catch (err) {
            this._showToast(`Export failed: ${err}`, 'error');
        }
    }

    async _checkForUpdates() {
        updater.onUpdateFound = (version, notes) => {
            this._onUpdateAvailable(version, notes);
        };
        updater.onError = (err) => {
            const statusText = document.getElementById('update-status-text');
            if (statusText) statusText.textContent = `⚠️ Check failed: ${err.message || err}`;
        };
        updater.onCheckComplete = (hasUpdate) => {
            const checkBtn = document.getElementById('btn-check-update');
            if (checkBtn) checkBtn.classList.remove('spinning');
            if (!hasUpdate && !this._pendingUpdateVersion) {
                const statusText = document.getElementById('update-status-text');
                if (statusText) statusText.textContent = '✅ App is up to date';
            }
        };
        // Delay check slightly so app finishes loading first
        setTimeout(() => {
            const statusText = document.getElementById('update-status-text');
            const checkBtn = document.getElementById('btn-check-update');
            if (statusText) statusText.textContent = 'Checking for updates...';
            if (checkBtn) checkBtn.classList.add('spinning');
            updater.checkForUpdates();
        }, 3000);
    }

    _triggerUpdateCheck() {
        const statusText = document.getElementById('update-status-text');
        const checkBtn = document.getElementById('btn-check-update');
        if (statusText) statusText.textContent = 'Checking for updates...';
        if (checkBtn) checkBtn.classList.add('spinning');
        updater.checkForUpdates();
    }

    _onUpdateAvailable(version, notes) {
        this._pendingUpdateVersion = version;

        // 1. Show badge on settings gear
        const badge = document.getElementById('settings-badge');
        if (badge) badge.style.display = '';

        // 2. Update About tab status
        const statusEl = document.getElementById('update-status');
        const statusText = document.getElementById('update-status-text');
        const actions = document.getElementById('update-actions');
        if (statusEl) statusEl.classList.add('has-update');
        if (statusText) statusText.textContent = `🆕 Update v${version} available`;
        if (actions) actions.style.display = '';

        // 3. Show subtle hint on main screen
        const existing = document.querySelector('.update-hint');
        if (existing) existing.remove();
        const hint = document.createElement('div');
        hint.className = 'update-hint';
        hint.textContent = `Update v${version} available — go to Settings → About`;
        hint.addEventListener('click', () => {
            this._showView('settings');
            // Switch to About tab
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.settings-tab-content').forEach(t => t.classList.remove('active'));
            const aboutTab = document.querySelector('[data-tab="tab-about"]');
            const aboutContent = document.getElementById('tab-about');
            if (aboutTab) aboutTab.classList.add('active');
            if (aboutContent) aboutContent.classList.add('active');
            hint.remove();
        });
        document.body.appendChild(hint);

        // Auto-hide hint after 8 seconds
        setTimeout(() => { if (hint.parentNode) hint.remove(); }, 8000);
    }

    _initAboutTab() {
        // GitHub links
        document.getElementById('link-github')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__?.opener?.openUrl('https://github.com/phuc-nt/my-translator');
        });
        document.getElementById('link-issues')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__?.opener?.openUrl('https://github.com/phuc-nt/my-translator/issues');
        });

        // Check for Updates button
        document.getElementById('btn-check-update')?.addEventListener('click', () => {
            this._triggerUpdateCheck();
        });

        // Download & Install button
        document.getElementById('btn-do-update')?.addEventListener('click', async () => {
            const btnText = document.getElementById('update-btn-text');
            const btn = document.getElementById('btn-do-update');
            const progressDiv = document.getElementById('update-progress');
            const progressFill = document.getElementById('update-progress-fill');
            const progressPct = document.getElementById('update-progress-pct');

            if (btn) btn.disabled = true;
            if (btnText) btnText.textContent = 'Downloading...';
            if (progressDiv) progressDiv.style.display = '';

            try {
                await updater.downloadAndInstall((downloaded, total) => {
                    if (total > 0) {
                        const pct = Math.round((downloaded / total) * 100);
                        if (progressFill) progressFill.style.width = `${pct}%`;
                        if (progressPct) progressPct.textContent = `${pct}%`;
                        if (btnText) btnText.textContent = `Downloading ${pct}%...`;
                    }
                });
                // Install succeeded! Try to restart
                if (btnText) btnText.textContent = 'Restarting...';
                try {
                    const relaunch = window.__TAURI__?.process?.relaunch;
                    if (relaunch) {
                        await relaunch();
                    } else {
                        const invoke = window.__TAURI__?.core?.invoke;
                        if (invoke) await invoke('plugin:process|restart');
                    }
                } catch (restartErr) {
                    // Restart failed (e.g. process plugin not available) but update IS installed
                    console.warn('[Update] Restart failed, update is installed:', restartErr);
                    if (btnText) btnText.textContent = '✅ Updated! Restart app';
                    const statusText = document.getElementById('update-status-text');
                    if (statusText) statusText.textContent = '✅ Update installed — close and reopen the app';
                    if (btn) btn.disabled = true;
                }
            } catch (err) {
                const errMsg = err?.message || String(err);
                if (btnText) btnText.textContent = 'Failed — try again';
                const statusText = document.getElementById('update-status-text');
                if (statusText) statusText.textContent = `⚠️ Install error: ${errMsg}`;
                if (btn) btn.disabled = false;
                console.error('[Update]', err);
            }
        });
    }

    _showToast(message, type = 'success') {
        // Remove existing toast
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Auto-remove (longer for errors)
        const duration = type === 'error' ? 5000 : 3000;
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});
