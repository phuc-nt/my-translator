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
import { audioPlayer } from './audio-player.js';
import { updater } from './updater.js';

const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;
const { listen } = window.__TAURI__.event;

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
        this.sidebarOpen = false; // Sidebar toggle state (always starts closed)
        this.sessionActive = false;    // true between _createNewSession() and _endSession()
        this.readOnlyMode = false;     // true when viewing a past conversation
        this.activeConversationFilename = null;

        // Chat UI (UI-only) — input posts into subtitle timeline
        this.currentTemplate = null; // 'Interview' | 'Meeting' | null
        this._interviewCvFile = null;
        this._interviewJdFile = null;
        this._interviewSuggestTimer = null;
        this._interviewSuggestGen = 0;
        this._ingestInterviewDebounce = null;
        this._suggestionsDock = {
            originalParent: null,
            originalNextSibling: null,
            docked: false,
        };
        this._interviewSuggestionsClosed = false;
        this._interviewSuggestionsItems = [];
        this._pickedSuggestion = null;
        this._lastInterviewSuggestArgs = { transcriptContext: null, userDraft: null };
        this._rightPanelCollapsed = false;
        this._interviewSuggestPerf = {
            origin: null, // 'speaker' | 'draft' | null
            t0: 0,
            timer: null,
            hideTimer: null,
        };
        this._interviewSuggestionsStream = {
            timers: [],
        };
        this._brainstormPending = false;
    }

    async init() {
        // Load settings
        await settingsManager.load();

        // Set version from Tauri
        try {
            const ver = await window.__TAURI__.app.getVersion();
            const el = document.getElementById('about-version');
            if (el && ver) el.textContent = `v${ver}`;
        } catch { /* non-fatal */ }

        // Init transcript UI
        const transcriptContainer = document.getElementById('transcript-content');
        this.transcriptUI = new TranscriptUI(transcriptContainer);
        this.transcriptUI.onAfterRender = () => this._injectBrainstormButton();

        // Check platform — hide Local MLX on non-Apple-Silicon
        await this._checkPlatformSupport();

        // Apply saved settings to UI
        this._applySettings(settingsManager.get());

        // Bind event listeners
        this._bindEvents();

        // Bind keyboard shortcuts
        this._bindKeyboardShortcuts();

        // Subscribe to settings changes
        settingsManager.onChange((settings) => this._applySettings(settings));

        // Init audio player for TTS
        audioPlayer.init();

        // Wire TTS audio callbacks for providers that use audioPlayer
        for (const tts of [elevenLabsTTS, edgeTTSRust, googleTTS]) {
            tts.onAudioChunk = (base64Audio, isFinal) => {
                audioPlayer.enqueue(base64Audio);
            };
        }
        for (const tts of [elevenLabsTTS, edgeTTSRust, googleTTS]) {
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

        // Load sidebar conversation list
        this._loadConversationList();

        console.log('🌐 MyJavis v0.5.0 initialized');
    }

    async _checkPlatformSupport() {
        try {
            // Check if we're on macOS Apple Silicon
            const arch = await invoke('get_platform_info');
            const info = JSON.parse(arch);
            this.isAppleSilicon = (info.os === 'macos' && info.arch === 'aarch64');
            this.isMobile = (info.os === 'android' || info.os === 'ios');
            this.isAndroid = (info.os === 'android');
        } catch {
            // Fallback: check via navigator
            this.isAppleSilicon = navigator.platform === 'MacIntel' &&
                navigator.userAgent.includes('Mac OS X');
            const ua = (navigator.userAgent || '').toLowerCase();
            this.isAndroid = ua.includes('android');
            this.isMobile = this.isAndroid || /iphone|ipad|ipod/.test(ua);
        }

        if (this.isMobile) {
            document.body.classList.add('mobile');
        }

        // Platform adaptations (Android)
        if (this.isAndroid) {
            await this._applyMobileDefaults();
            this._filterTtsProviders();
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

    async _applyMobileDefaults() {
        // Android: system audio requires MediaProjection; default to mic for a smoother first-run.
        const s = settingsManager.get();
        const src = s.audio_source || 'system';
        if (src === 'system') {
            try {
                await settingsManager.save({ audio_source: 'microphone' });
            } catch {
                // Non-fatal: we'll still continue with runtime defaults.
            }
        }
    }

    _filterTtsProviders() {
        // Android: only keep Edge + Google (hide ElevenLabs + any future desktop-only providers).
        const select = document.getElementById('select-tts-provider');
        if (!select) return;

        const allowed = new Set(['edge', 'google']);
        Array.from(select.querySelectorAll('option')).forEach((opt) => {
            const val = opt.getAttribute('value') || '';
            if (!allowed.has(val)) opt.remove();
        });

        const s = settingsManager.get();
        const provider = s.tts_provider || 'edge';
        if (!allowed.has(provider)) {
            // Update UI immediately; persist best-effort.
            select.value = 'edge';
            this._updateTTSProviderUI('edge');
            settingsManager.save({ tts_provider: 'edge' }).catch(() => {});
        }

        // Also hide the removed provider settings blocks (if present).
        const el = document.getElementById('tts-elevenlabs-settings');
        if (el) el.style.display = 'none';
    }

    // ─── Event Binding ──────────────────────────────────────

    _bindEvents() {
        // Sidebar toggle
        document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
            this._toggleSidebar();
        });

        // Mobile: close sidebar when tapping backdrop
        document.getElementById('mobile-overlay-backdrop')?.addEventListener('click', () => {
            if (!this.isMobile) return;
            // Close whichever overlay is open
            this._setMobileSheetOpen(false);
            this.sidebarOpen = false;
            document.body.classList.remove('sidebar-open');
            document.getElementById('sidebar')?.classList.add('hidden');
        });

        // Mobile FAB: toggle suggestions bottom sheet
        document.getElementById('btn-toggle-right-panel')?.addEventListener('click', () => {
            if (!this.isMobile) return;
            if (!this._isSuggestionsMode()) return;
            const open = !document.body.classList.contains('sheet-open');
            this._setMobileSheetOpen(open);
        });

        // Mobile: auto-collapse bottom sheet when user scrolls transcript
        document.getElementById('transcript-container')?.addEventListener('scroll', () => {
            if (!this.isMobile) return;
            if (!document.body.classList.contains('sheet-open')) return;
            this._setMobileSheetOpen(false);
        }, { passive: true });

        // New conversation
        document.getElementById('btn-new-conversation').addEventListener('click', () => {
            this._createNewSession();
        });

        // End session (separate button next to Start/Stop)
        document.getElementById('btn-end-session')?.addEventListener('click', async () => {
            await this._endSession();
        });

        // Settings button
        document.getElementById('btn-settings').addEventListener('click', () => {
            this._showView('settings');
        });

        // Back from settings
        document.getElementById('btn-back').addEventListener('click', () => {
            this._showView('overlay');
        });


        // Close button (overlay)
        document.getElementById('btn-close').addEventListener('click', async () => {
            await this._saveWindowPosition();
            await this.stop();
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

        this._initInterviewUploads();
        this._bindInterviewSettingsKeys();
        this._bindDimChips();

        // Interview suggestions triggered by inline brainstorm button (see _injectBrainstormButton)

        // Close Interview suggestions panel
        document.getElementById('btn-close-suggestions')?.addEventListener('click', () => {
            this._interviewSuggestionsClosed = true;
            // Collapse instead of fully hiding so the "Suggestions" open button
            // stays in the same header position as the close button.
            const panel = document.getElementById('interview-suggestions-panel');
            if (panel) panel.style.display = '';
            if (this.isMobile) {
                this._setMobileSheetOpen(false);
            } else {
                this._setRightPanelCollapsed(true);
            }
            // Keep docked if it was docked.
        });

        // Regenerate suggestions
        document.getElementById('btn-regenerate-suggestions')?.addEventListener('click', () => {
            if (!this._isSuggestionsMode()) return;
            this._interviewSuggestionsClosed = false;
            this._setRightPanelCollapsed(false);
            const { transcriptContext, userDraft } = this._lastInterviewSuggestArgs || {};
            this._markInterviewSuggestStart('manual');
            this._scheduleSuggestions({ transcriptContext, userDraft });
        });

        // Open suggestions panel (after closing)
        document.getElementById('btn-open-suggestions')?.addEventListener('click', () => {
            if (!this._isSuggestionsMode()) return;
            this._interviewSuggestionsClosed = false;
            if (this.isMobile) {
                this._setMobileSheetOpen(true);
            } else {
                this._setRightPanelCollapsed(false);
            }
            if (this._interviewSuggestionsItems.length) return;
            const { transcriptContext, userDraft } = this._lastInterviewSuggestArgs || {};
            // Manual mode: do not auto-generate on open
            //this._setInterviewSuggestionsStatus('Ready — click ⟳ to generate');
        });

        // Start/Stop button
        document.getElementById('btn-start').addEventListener('click', async () => {
            if (this.isStarting) return; // Prevent re-entry
            try {
                if (this.isRunning) {
                    await this._stopCapture();
                } else {
                    this.isStarting = true;
                    if (!this.sessionActive) {
                        this._createNewSession();
                    }
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

        // Chat input: Enter sends, Shift+Enter newline
        document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._sendChatMessage();
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

        // Translation mode toggle
        document.getElementById('select-translation-mode').addEventListener('change', (e) => {
            this._updateModeUI(e.target.value);
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

        document.querySelectorAll('.btn-toggle-ai-key').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = document.getElementById(btn.dataset.target);
                if (input) input.type = input.type === 'password' ? 'text' : 'password';
            });
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

        // Wire Soniox callbacks
        sonioxClient.onOriginal = (text, speaker, language) => {
            this.transcriptUI.addOriginal(text, speaker, language);
        };

        sonioxClient.onTranslation = (text) => {
            this.transcriptUI.addTranslation(text);
            this._speakIfEnabled(text);
            this._onInterviewSpeakerFinal(text);
        };

        sonioxClient.onProvisional = (text, speaker, language) => {
            if (text) {
                this._brainstormPending = false;
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
                            await this.stop();
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

        });
    }

    // ─── Views ──────────────────────────────────────────────

    _showView(view) {
        document.getElementById('overlay-view').classList.toggle('active', view === 'overlay');
        document.getElementById('settings-view').classList.toggle('active', view === 'settings');

        if (view === 'settings') {
            this._populateSettingsForm();
        }
    }

    // ─── Settings Form ─────────────────────────────────────

    _populateSettingsForm() {
        const s = settingsManager.get();

        document.getElementById('input-api-key').value = s.soniox_api_key || '';
        document.getElementById('select-source-lang').value = s.source_language || 'auto';
        document.getElementById('select-target-lang').value = s.target_language || 'vi';
        document.getElementById('select-translation-mode').value = s.translation_mode || 'soniox';
        this._updateModeUI(s.translation_mode || 'soniox');

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

        // Interview AI fields
        const pineHost = document.getElementById('interview-pinecone-host');
        if (pineHost) pineHost.value = s.pinecone_host || '';
        const pineDim = document.getElementById('interview-pinecone-dim');
        if (pineDim) {
            pineDim.value = String(s.pinecone_vector_dimension ?? 1536);
            this._updateDimChips(pineDim.value);
        }
        const pineKey = document.getElementById('pinecone-api-key');
        if (pineKey) pineKey.value = s.pinecone_api_key || '';
        const llmUrl = document.getElementById('llm-url');
        if (llmUrl) llmUrl.value = s.llm_url || '';
        const llmModel = document.getElementById('llm-model');
        if (llmModel) llmModel.value = s.llm_model || '';
        const llmKey = document.getElementById('llm-api-key');
        if (llmKey) llmKey.value = s.llm_api_key || '';
        const appMode = document.getElementById('select-app-mode');
        if (appMode) appMode.value = s.app_mode || '';
        const suggestionType = document.getElementById('select-suggestion-type');
        if (suggestionType) {
            const v = s.suggestion_type || 'translation';
            suggestionType.value = ['target', 'translation', 'both'].includes(v) ? v : 'translation';
        }

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
        settings.tts_enabled = false;

        settings.pinecone_host = document.getElementById('interview-pinecone-host')?.value?.trim() || '';
        settings.pinecone_vector_dimension = parseInt(
            document.getElementById('interview-pinecone-dim')?.value || '1536',
            10,
        );
        settings.llm_url = document.getElementById('llm-url')?.value?.trim() || '';
        settings.llm_model = document.getElementById('llm-model')?.value?.trim() || '';
        settings.pinecone_api_key = document.getElementById('pinecone-api-key')?.value?.trim() || '';
        settings.llm_api_key = document.getElementById('llm-api-key')?.value?.trim() || '';
        const st = document.getElementById('select-suggestion-type')?.value || 'translation';
        settings.suggestion_type = ['target', 'translation', 'both'].includes(st) ? st : 'translation';
        const am = document.getElementById('select-app-mode')?.value || '';
        settings.app_mode = ['Interview', 'Meeting'].includes(am) ? am : '';

        try {
            await settingsManager.save(settings);
            this._showToast('Settings saved', 'success');
            this._showView('overlay');
        } catch (err) {
            this._showToast(`Failed to save: ${err}`, 'error');
        }
    }

    // ─── Apply Settings ────────────────────────────────────

    _updateChatInputState() {
        const isInterview = this.currentTemplate === 'Interview';
        const panel = document.getElementById('chat-panel');
        if (panel) panel.style.display = isInterview ? '' : 'none';
        const input = document.getElementById('chat-input');
        if (!input) return;
        if (!isInterview) return;
        const hasKey = !!(settingsManager.get().llm_api_key?.trim());
        input.disabled = !hasKey;
        input.style.display = '';
        input.placeholder = hasKey
            ? 'Type a message… (Enter to send, Shift+Enter for newline)'
            : 'Add LLM API key in Settings to enable chat';
    }

    _applySettings(settings) {
        // Update overlay opacity
        const overlayView = document.getElementById('overlay-view');
        overlayView.style.opacity = settings.overlay_opacity || 0.85;

        // Apply app font size to UI bits that use CSS vars (e.g. Interview suggestions)
        const fs = Number(settings.font_size || 16);
        document.documentElement.style.setProperty('--app-font-size', `${Number.isFinite(fs) ? fs : 16}px`);
        const ff = String(settings.font_family || '').trim();
        if (ff) {
            document.documentElement.style.setProperty('--app-font-family', ff);
        } else {
            document.documentElement.style.removeProperty('--app-font-family');
        }

        // Update transcript UI
        if (this.transcriptUI) {
            this.transcriptUI.configure({
                maxLines: settings.max_lines || 5,
                showOriginal: settings.show_original !== false,
                fontSize: settings.font_size || 16,
                viewMode: 'subtitle',
            });
        }

        // Update current source button states
        this.currentSource = settings.audio_source || 'system';
        this._updateSourceButtons();

        // TTS is always OFF on app start — user must toggle on each session
        this.ttsEnabled = false;
        this._updateTTSButton();

        // Sync mode from settings
        const savedMode = settings.app_mode || null;
        if (savedMode !== this.currentTemplate) {
            this._setTemplateMode(savedMode);
        }

        this._updateChatInputState();
    }

    // ─── TTS Control ──────────────────────────────────────

    _toggleTTS() {
        const settings = settingsManager.get();
        const provider = settings.tts_provider || 'edge';

        // Block TTS in two-way mode to prevent audio feedback loop
        const translationType = document.getElementById('select-translation-type')?.value;
        if (translationType === 'two_way') {
            this._showToast('TTS is disabled in two-way mode to prevent audio loop', 'error');
            return;
        }

        // Check API key for premium providers
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

        this.ttsEnabled = !this.ttsEnabled;
        this._updateTTSButton();

        const tts = this._getActiveTTS();

        if (this.ttsEnabled) {
            this._configureTTS(tts, settings);
            if (this.isRunning) {
                tts.connect();
                audioPlayer.resume();
            }
            const label = { edge: 'Edge TTS (Free)', google: 'Google Chirp 3 HD', elevenlabs: 'ElevenLabs' }[provider] || provider;
            this._showToast(`TTS narration ON 🔊 (${label})`, 'success');
        } else {
            tts.disconnect();
            audioPlayer.stop();
            this._showToast('TTS narration OFF 🔇', 'success');
        }
    }

    _getActiveTTS() {
        const settings = settingsManager.get();
        const provider = settings.tts_provider || 'edge';
        if (provider === 'elevenlabs') return elevenLabsTTS;
        if (provider === 'google') return googleTTS;
        return edgeTTSRust;
    }

    _configureTTS(tts, settings) {
        const provider = settings.tts_provider || 'edge';
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
        return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    _updateTTSProviderUI(provider) {
        const ed = document.getElementById('tts-edge-settings');
        const go = document.getElementById('tts-google-settings');
        const el = document.getElementById('tts-elevenlabs-settings');
        if (ed) ed.style.display = provider === 'edge' ? '' : 'none';
        if (go) go.style.display = provider === 'google' ? '' : 'none';
        if (el) el.style.display = provider === 'elevenlabs' ? '' : 'none';
        // Update hint text
        const hint = document.getElementById('tts-provider-hint');
        if (hint) {
            const hints = {
                edge: 'Free, natural voices — no API key needed',
                google: 'Near-human quality — requires Google Cloud API key (1M chars/month free)',
                elevenlabs: 'Premium quality — requires ElevenLabs API key',
            };
            hint.textContent = hints[provider] || '';
        }
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

    // ─── Source Control ────────────────────────────────────

    _setSource(source) {
        const wasRunning = this.isRunning;
        const labels = { system: 'System Audio', microphone: 'Microphone', both: 'System + Mic' };
        const label = labels[source] || source;

        // If currently running, restart with new source
        if (wasRunning) {
            this.stop().then(() => {
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

    _updateModeUI(mode) {
        const isSoniox = mode === 'soniox';

        // Toggle hints
        const hintSoniox = document.getElementById('hint-mode-soniox');
        const hintLocal = document.getElementById('hint-mode-local');
        if (hintSoniox) hintSoniox.style.display = isSoniox ? '' : 'none';
        if (hintLocal) hintLocal.style.display = !isSoniox ? '' : 'none';

        // Toggle Soniox-only sections
        const sectionApiKey = document.getElementById('section-api-key');
        const sectionContext = document.getElementById('section-soniox-context');
        if (sectionApiKey) sectionApiKey.style.display = isSoniox ? '' : 'none';
        if (sectionContext) sectionContext.style.display = isSoniox ? '' : 'none';
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

        // Check ElevenLabs key only if TTS is enabled AND provider is elevenlabs
        if (this.ttsEnabled && settings.tts_provider === 'elevenlabs' && !settings.elevenlabs_api_key) {
            this._showToast('TTS is ON but ElevenLabs API key is missing. Add it in Settings or disable TTS.', 'error');
            this._showView('settings');
            return;
        }

        this.isRunning = true;
        this._updateStartButton();
        this._updateControlsForMode();
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

        // Clear transcript only if nothing is showing
        if (!this.transcriptUI.hasContent()) {
            this.transcriptUI.showListening();
        } else {
            this.transcriptUI.clearProvisional();
        }

        if (this.translationMode === 'local') {
            await this._startLocalMode(settings);
        } else {
            await this._startSonioxMode(settings);
        }

        // Start TTS if enabled
        if (this.ttsEnabled) {
            const tts = this._getActiveTTS();
            this._configureTTS(tts, settings);
            tts.connect();
            audioPlayer.resume();
        }
    }

    async _startSonioxMode(settings) {
        // Connect to Soniox
        console.log('[App] Connecting to Soniox...');
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

        // If system audio is selected, request MediaProjection first (no-op on desktop).
        try {
            if (this.currentSource === 'system' || this.currentSource === 'both') {
                await invoke('request_media_projection');
            }

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
            await this.stop();
        }
    }

    async _startLocalMode(settings) {
        console.log('[App] Starting Local mode (MLX models)...');
        this._updateStatus('connecting');

        // Step 0: Check audio permission FIRST (before loading models).
        // If system audio is selected, request MediaProjection first (no-op on desktop).
        try {
            if (this.currentSource === 'system' || this.currentSource === 'both') {
                await invoke('request_media_projection');
            }
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
            await this.stop();
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
                    this._onInterviewSpeakerFinal(data.translated);
                }
                }, 80);
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

    async _stopCapture() {
        if (!this.isRunning) return;
        this.isRunning = false;
        this._updateStartButton();
        this._updateControlsForMode();

        try {
            await invoke('stop_capture');
        } catch (err) {
            console.error('Failed to stop audio capture:', err);
        }

        if (this.translationMode === 'local') {
            try {
                await invoke('stop_local_pipeline');
            } catch (err) {
                console.error('Failed to stop local pipeline:', err);
            }
            this.localPipelineReady = false;
            this.transcriptUI.removeStatusMessage();
            this._updateStatus('disconnected');
        } else {
            sonioxClient.disconnect();
        }

        this.transcriptUI.clearProvisional();

        elevenLabsTTS.disconnect();
        edgeTTSRust.disconnect();
        audioPlayer.stop();
    }

    async stop() {
        await this._stopCapture();

        // Auto-save on stop — use full sessionLog (not trimmed display buffer)
        if (this.transcriptUI.hasSessionContent()) {
            await this._saveTranscriptFile();
            this.transcriptUI.clearSession();
        }

        // Reset session tracking
        this.sessionStartTime = null;
    }

    _createNewSession() {
        this.readOnlyMode = false;
        this.activeConversationFilename = null;
        this.sessionActive = true;
        this.sessionStartTime = null;
        this.recordingStartTime = null;
        this._updateControlsForMode();

        this.transcriptUI.clear();
        this.transcriptUI.showPlaceholder();

        document.querySelectorAll('#conversation-list .conversation-item').forEach(el => {
            el.classList.remove('active');
        });
    }

    async _endSession() {
        await this._stopCapture();

        if (this.transcriptUI.hasSessionContent()) {
            await this._saveTranscriptFile();
            this.transcriptUI.clearSession();
        }

        this.sessionStartTime = null;
        this.recordingStartTime = null;
        this.sessionActive = false;
        this.readOnlyMode = false;
        this._updateControlsForMode();

        this.transcriptUI.clear();
        this.transcriptUI.showPlaceholder();

        if (typeof this._loadConversationList === 'function') {
            await this._loadConversationList();
        }
    }

    _updateStartButton() {
        const btn = document.getElementById('btn-start');
        const iconPlay = document.getElementById('icon-play');
        const iconStop = document.getElementById('icon-stop');

        btn.classList.toggle('recording', this.isRunning);
        iconPlay.style.display = this.isRunning ? 'none' : 'block';
        iconStop.style.display = this.isRunning ? 'block' : 'none';
    }

    _updateEndButtonVisibility() {
        this._updateControlsForMode();
    }

    _updateControlsForMode() {
        const btnStart = document.getElementById('btn-start');
        if (this.readOnlyMode) {
            btnStart.disabled = true;
            btnStart.style.opacity = '0.35';
            btnStart.style.pointerEvents = 'none';
        } else {
            btnStart.disabled = false;
            btnStart.style.opacity = '';
            btnStart.style.pointerEvents = '';
        }
        const btnEndSession = document.getElementById('btn-end-session');
        const hasSessionContent = !!this.transcriptUI?.hasSessionContent?.();
        const shouldShowEnd = !this.readOnlyMode && (this.sessionActive || this.isRunning || hasSessionContent);
        if (btnEndSession) btnEndSession.style.display = shouldShowEnd ? 'flex' : 'none';
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

    _toggleSidebar() {
        this.sidebarOpen = !this.sidebarOpen;
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('hidden', !this.sidebarOpen);
        if (this.isMobile) {
            document.body.classList.toggle('sidebar-open', this.sidebarOpen);
        }
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

    async _openConversationReadOnly(filename) {
        this.readOnlyMode = true;
        this._updateControlsForMode();

        document.querySelectorAll('#conversation-list .conversation-item').forEach(el => {
            el.classList.toggle('active', el.dataset.filename === filename);
        });

        this.activeConversationFilename = filename;

        const contentEl = document.getElementById('transcript-content');
        if (contentEl) contentEl.textContent = 'Loading...';

        try {
            const text = await invoke('read_transcript', { filename });
            const segments = this._parseSavedTranscriptToSegments(text);
            this.transcriptUI.configure({ viewMode: 'subtitle' });
            this.transcriptUI.clear();
            this.transcriptUI.loadSegments(segments, { replaceSessionLog: false });

            if (!segments.length && contentEl) {
                contentEl.textContent = 'No transcript content.';
            }
        } catch (err) {
            if (contentEl) contentEl.textContent = `Error loading: ${err}`;
        }
    }

    _parseSavedTranscriptToSegments(text) {
        const raw = String(text || '');
        if (!raw.trim()) return [];

        // Strip first YAML frontmatter block: --- ... ---
        let body = raw;
        if (body.startsWith('---')) {
            const second = body.indexOf('\n---', 3);
            if (second !== -1) {
                const after = body.indexOf('\n', second + 1);
                body = after !== -1 ? body.slice(after + 1) : '';
            }
        }

        const lines = body.split(/\r?\n/);
        const segments = [];

        let currentSpeaker = null;
        let pending = null; // { speaker, original, createdAt }

        const speakerRe = /^\*\*Speaker\s+(.+?):\*\*\s*$/i;

        const flushPendingIfAny = () => {
            if (!pending) return;
            segments.push({
                original: pending.original || '',
                translation: pending.translation || '',
                status: 'translated',
                speaker: pending.speaker,
                language: null,
                confidence: null,
                createdAt: pending.createdAt,
            });
            pending = null;
        };

        for (let i = 0; i < lines.length; i++) {
            const lineRaw = lines[i];
            const line = (lineRaw || '').trim();
            if (!line) continue;

            const sp = line.match(speakerRe);
            if (sp) {
                const s = (sp[1] || '').trim();
                currentSpeaker = s;
                continue;
            }

            if (line.startsWith('>')) {
                // If we already had a pending EN without a VI, flush it before starting a new one.
                flushPendingIfAny();
                const original = line.replace(/^>\s*/, '').trim();
                pending = {
                    speaker: currentSpeaker,
                    original,
                    translation: '',
                    createdAt: Date.now() + segments.length,
                };
                continue;
            }

            // Treat as VI line if we have pending EN.
            if (pending && !pending.translation) {
                pending.translation = line;
                flushPendingIfAny();
            }
        }

        // Flush any trailing EN without VI
        flushPendingIfAny();

        // Normalize speaker values: if stored as "Speaker 1" accidentally, reduce to "1"
        segments.forEach(s => {
            if (typeof s.speaker === 'string') {
                const m = s.speaker.match(/^Speaker\s+(.+)$/i);
                if (m) s.speaker = m[1].trim();
            }
        });

        return segments.filter(s => (s.original || s.translation));
    }

    async _loadConversationList() {
        const listEl = document.getElementById('conversation-list');
        if (!listEl) return;

        try {
            const sessions = await invoke('list_transcripts');
            listEl.innerHTML = '';

            sessions.forEach(s => {
                const meta = this._parseSessionMeta(s);
                const li = document.createElement('li');
                li.className = 'conversation-item';
                li.dataset.filename = s.filename;
                li.innerHTML = `
                    <span class="conversation-label">🗨 ${meta.date} ${meta.time}</span>
                    <button type="button" class="btn-remove-conversation" title="Delete conversation" aria-label="Delete conversation">×</button>
                `;

                const removeBtn = li.querySelector('.btn-remove-conversation');
                removeBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const filename = s.filename;
                    const ok = confirm(`Delete conversation "${filename}"?\n\nThis cannot be undone.`);
                    if (!ok) return;
                    try {
                        await invoke('delete_transcript', { filename });
                        // If currently viewing this conversation in read-only, exit to a safe state
                        if (this.readOnlyMode && this.activeConversationFilename === filename) {
                            this._createNewSession();
                            this.activeConversationFilename = null;
                        }
                        await this._loadConversationList();
                        this._showToast('Deleted conversation', 'success');
                    } catch (err) {
                        this._showToast(`Delete failed: ${err}`, 'error');
                    }
                });
                li.addEventListener('click', () => {
                    this._openConversationReadOnly(s.filename);
                });
                listEl.appendChild(li);
            });
        } catch (err) {
            console.error('[Sidebar] Failed to load conversations:', err);
        }
    }

    _parseSessionMeta(session) {
        // created_at format: "2026-03-27 10:21:05"
        const parts = (session.created_at || '').split(' ');
        const date = parts[0] || '';
        const time = parts[1] ? parts[1].slice(0, 5) : '';
        return { date, time, duration: '', langPair: '' };
    }

    _formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
            window.__TAURI__?.opener?.openUrl('https://github.com/dainn-dev/assistant');
        });
        document.getElementById('link-issues')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__?.opener?.openUrl('https://github.com/dainn-dev/assistant/issues');
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

    _insertIntoTextarea(textarea, insertText) {
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? textarea.value.length;
        const before = textarea.value.slice(0, start);
        const after = textarea.value.slice(end);
        textarea.value = before + insertText + after;
        const nextPos = start + insertText.length;
        textarea.focus();
        textarea.setSelectionRange(nextPos, nextPos);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    _isSuggestionsMode() {
        return this.currentTemplate === 'Interview' || this.currentTemplate === 'Meeting';
    }

    _suggestionsPanelTitle() {
        return this.currentTemplate === 'Meeting' ? 'Suggestions' : 'Suggested answers';
    }

    _suggestionsEmptyText() {
        return this.currentTemplate === 'Meeting'
            ? 'Waiting for conversation context…'
            : 'Waiting for interviewer question…';
    }

    _updateSuggestionsPanelChrome() {
        const title = document.getElementById('interview-suggestions-title');
        if (title) title.textContent = this._suggestionsPanelTitle();
        this._updateSuggestionsEmptyState();
    }

    _updateSuggestionsEmptyState() {
        const empty = document.getElementById('interview-suggestions-empty');
        if (!empty) return;
        const show = this._isSuggestionsMode()
            && !this._interviewSuggestionsItems.length
            && !this._interviewSuggestionsClosed;
        empty.textContent = this._suggestionsEmptyText();
        empty.hidden = !show;
    }

    _clearSuggestionsPanel() {
        this._interviewSuggestGen += 1;
        clearTimeout(this._interviewSuggestTimer);
        this._cancelInterviewSuggestionsStreaming();
        this._interviewSuggestionsItems = [];
        this._lastInterviewSuggestArgs = { transcriptContext: null, userDraft: null };
        this._brainstormPending = false;
        this._interviewSuggestionsClosed = false;
        const list = document.getElementById('interview-suggestions-list');
        if (list) list.innerHTML = '';
        this._setInterviewSuggestionsStatus('');
        document.getElementById('transcript-content')?.querySelectorAll('.seg-brainstorm-btn').forEach((el) => el.remove());
        this._updateSuggestionsEmptyState();
    }

    _suggestionKindLabel(kind) {
        const labels = {
            talking_point: 'Talking Point',
            clarifying_question: 'Clarifying Question',
            action_item: 'Action Item',
        };
        return labels[kind] || '';
    }

    _prependSuggestionKindLabel(li, item) {
        if (this.currentTemplate !== 'Meeting') return;
        const label = this._suggestionKindLabel(item.suggestion_kind);
        if (!label) return;
        const el = document.createElement('span');
        el.className = 'suggestion-chip-kind';
        el.textContent = label;
        li.insertBefore(el, li.firstChild);
    }

    _setTemplateMode(mode) {
        const prevMode = this.currentTemplate;
        this.currentTemplate = mode || null;
        if (
            prevMode !== this.currentTemplate
            && prevMode
            && this.currentTemplate
            && (prevMode === 'Interview' || prevMode === 'Meeting')
            && (this.currentTemplate === 'Interview' || this.currentTemplate === 'Meeting')
        ) {
            this._clearSuggestionsPanel();
        }
        if (this._isSuggestionsMode()) {
            this._interviewSuggestionsClosed = false;
        }

        // Mobile: mark body classes for mode-specific UI
        document.body.classList.toggle('interview-active', this.currentTemplate === 'Interview');
        document.body.classList.toggle('suggestions-active', this._isSuggestionsMode());

        // Update dropdown label
        const templateLabel = document.querySelector('#btn-template .template-trigger-label');
        if (templateLabel) templateLabel.textContent = this.currentTemplate || 'Template';

        const uploads = document.getElementById('interview-uploads');
        if (uploads) uploads.style.display = this.currentTemplate === 'Interview' ? '' : 'none';
        const sugPanel = document.getElementById('interview-suggestions-panel');
        if (!this._isSuggestionsMode()) {
            if (sugPanel) sugPanel.style.display = 'none';
            this._undockInterviewSuggestions();
            this._rightPanelCollapsed = false;
            this._interviewSuggestGen += 1;
            if (this.isMobile) this._setMobileSheetOpen(false);
        } else {
            if (sugPanel) sugPanel.style.display = '';
            this._updateSuggestionsPanelChrome();
            if (this.isMobile) {
                this._undockInterviewSuggestions();
                this._setMobileSheetOpen(false);
            } else {
                this._dockInterviewSuggestionsRight();
                this._setRightPanelCollapsed(true);
            }
            if (this.currentTemplate === 'Interview') {
                this._scheduleInterviewIngest();
            }
        }
        this._updateChatInputState();
    }

    _dockInterviewSuggestionsRight() {
        if (this.isMobile) return;
        const panel = document.getElementById('interview-suggestions-panel');
        const right = document.getElementById('right-panel');
        const resizer = document.getElementById('right-panel-resizer');
        const contentArea = document.getElementById('content-area');
        if (!panel || !right || !contentArea) return;

        // Record original DOM position once, so we can restore later.
        if (!this._suggestionsDock.originalParent) {
            this._suggestionsDock.originalParent = panel.parentElement;
            this._suggestionsDock.originalNextSibling = panel.nextSibling;
        }

        if (panel.parentElement !== right) {
            right.appendChild(panel);
        }

        right.style.display = '';
        if (resizer) resizer.style.display = '';
        contentArea.classList.add('split-suggestions');
        panel.classList.add('docked-right');
        this._suggestionsDock.docked = true;

        this._initRightPanelResizer();
    }

    _initRightPanelResizer() {
        const resizer = document.getElementById('right-panel-resizer');
        const right = document.getElementById('right-panel');
        const contentArea = document.getElementById('content-area');
        if (!resizer || !right || !contentArea || resizer._resizerBound) return;
        resizer._resizerBound = true;

        // Restore saved width
        const saved = localStorage.getItem('rightPanelWidth');
        if (saved) right.style.width = saved;

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            resizer.classList.add('dragging');
            const startX = e.clientX;
            const startW = right.getBoundingClientRect().width;
            const totalW = contentArea.getBoundingClientRect().width;
            const maxW = Math.floor(totalW * 0.5);

            const onMove = (ev) => {
                const dx = startX - ev.clientX; // drag left = wider panel
                const newW = Math.min(maxW, Math.max(200, startW + dx));
                right.style.width = newW + 'px';
            };

            const onUp = () => {
                resizer.classList.remove('dragging');
                localStorage.setItem('rightPanelWidth', right.style.width);
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    _setRightPanelCollapsed(collapsed) {
        const contentArea = document.getElementById('content-area');
        const btnOpen = document.getElementById('btn-open-suggestions');
        const btnClose = document.getElementById('btn-close-suggestions');
        if (!contentArea || !btnOpen || !btnClose) return;
        this._rightPanelCollapsed = !!collapsed;
        contentArea.classList.toggle('right-panel-collapsed', this._rightPanelCollapsed);
        btnOpen.style.display = this._rightPanelCollapsed ? '' : 'none';
        btnClose.style.display = this._rightPanelCollapsed ? 'none' : '';
    }

    _setMobileSheetOpen(open) {
        if (!this.isMobile) return;
        document.body.classList.toggle('sheet-open', !!open);
        // Ensure sidebar state doesn't conflict with sheet UX.
        if (open) {
            this.sidebarOpen = false;
            document.body.classList.remove('sidebar-open');
            document.getElementById('sidebar')?.classList.add('hidden');
        }
    }

    _undockInterviewSuggestions() {
        const panel = document.getElementById('interview-suggestions-panel');
        const right = document.getElementById('right-panel');
        const contentArea = document.getElementById('content-area');
        if (!panel || !right || !contentArea) return;

        panel.classList.remove('docked-right');

        const { originalParent, originalNextSibling } = this._suggestionsDock;
        if (originalParent) {
            if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
                originalParent.insertBefore(panel, originalNextSibling);
            } else {
                originalParent.appendChild(panel);
            }
        }

        const resizer = document.getElementById('right-panel-resizer');
        if (resizer) resizer.style.display = 'none';
        right.style.display = 'none';
        contentArea.classList.remove('split-suggestions');
        this._suggestionsDock.docked = false;
    }

    _isAllowedInterviewFile(filename) {
        const name = String(filename || '').toLowerCase();
        return name.endsWith('.pdf') || name.endsWith('.docx');
    }

    _updateInterviewUploadPills() {
        const pillCv = document.getElementById('pill-cv');
        const pillCvName = document.getElementById('pill-cv-name');
        const pillJd = document.getElementById('pill-jd');
        const pillJdName = document.getElementById('pill-jd-name');

        if (pillCv && pillCvName) {
            if (this._interviewCvFile) {
                pillCvName.textContent = this._interviewCvFile.name || 'CV';
                pillCv.style.display = '';
            } else {
                pillCvName.textContent = '';
                pillCv.style.display = 'none';
            }
        }

        if (pillJd && pillJdName) {
            if (this._interviewJdFile) {
                pillJdName.textContent = this._interviewJdFile.name || 'JD';
                pillJd.style.display = '';
            } else {
                pillJdName.textContent = '';
                pillJd.style.display = 'none';
            }
        }
    }

    _initInterviewUploads() {
        const uploads = document.getElementById('interview-uploads');
        const btnUpload = document.getElementById('btn-upload-interview-files');
        const inputFiles = document.getElementById('file-upload-interview');
        const clearCv = document.getElementById('pill-cv-clear');
        const clearJd = document.getElementById('pill-jd-clear');

        if (!uploads || !btnUpload || !inputFiles) return;

        // Default hidden until Interview selected
        uploads.style.display = 'none';

        btnUpload.addEventListener('click', () => inputFiles.click());

        inputFiles.addEventListener('change', () => {
            const files = Array.from(inputFiles.files || []);
            if (!files.length) return;

            const allowed = files.filter(f => this._isAllowedInterviewFile(f.name));
            if (!allowed.length) {
                inputFiles.value = '';
                this._showToast('Please choose .pdf or .docx files', 'error');
                return;
            }

            // Use selection order: first = CV, second = JD (if present)
            this._interviewCvFile = allowed[0] || null;
            this._interviewJdFile = allowed[1] || null;
            this._updateInterviewUploadPills();
            this._scheduleInterviewIngest();
        });

        clearCv?.addEventListener('click', () => {
            this._interviewCvFile = null;
            inputFiles.value = '';
            this._updateInterviewUploadPills();
        });

        clearJd?.addEventListener('click', () => {
            this._interviewJdFile = null;
            inputFiles.value = '';
            this._updateInterviewUploadPills();
        });

        this._updateInterviewUploadPills();
    }

    _initTemplateDropdown() {
        const trigger = document.getElementById('btn-template');
        const menu = document.getElementById('menu-template');
        const input = document.getElementById('chat-input');
        if (!trigger || !menu || !input) return;

        const setOpen = (open) => {
            if (open) {
                menu.classList.add('open');
                trigger.setAttribute('aria-expanded', 'true');
                menu.setAttribute('aria-hidden', 'false');
            } else {
                menu.classList.remove('open');
                trigger.setAttribute('aria-expanded', 'false');
                menu.setAttribute('aria-hidden', 'true');
            }
        };

        const isOpen = () => menu.classList.contains('open');

        trigger.addEventListener('click', (e) => {
            e.preventDefault();
            setOpen(!isOpen());
        });

        // Select mode on item click (no textbox insertion)
        menu.querySelectorAll('.template-item').forEach((btn) => {
            btn.addEventListener('click', () => {
                this._setTemplateMode(btn.textContent?.trim() || null);
                input.focus();
                setOpen(false);
            });
        });

        // Close when clicking outside
        document.addEventListener('mousedown', (e) => {
            const dropdown = document.getElementById('template-dropdown');
            if (!dropdown) return;
            if (!dropdown.contains(e.target)) setOpen(false);
        });

        // Close on Esc
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') setOpen(false);
        });
    }

    _sendChatMessage() {
        const input = document.getElementById('chat-input');
        if (!input) return;
        const text = (input.value || '').trim();
        if (!text) return;

        input.value = '';
        this.transcriptUI?.addChatMessage?.(text, 'ME');
        this._consumePickedSuggestion(text);
        if (this.currentTemplate === 'Interview') {
            (async () => {
                try {
                    await invoke('save_interview_message', {
                        req: { userId: this._getInterviewUserId(), role: 'user', content: text },
                    });
                } catch (e) {
                    console.warn('[Interview] save user message', e);
                }
                this._lastInterviewSuggestArgs = { transcriptContext: null, userDraft: text };
                this._interviewSuggestionsClosed = false;
                this._setRightPanelCollapsed(false);
                this._markInterviewSuggestStart('draft');
                this._scheduleSuggestions({ transcriptContext: null, userDraft: text });
            })();
        }
    }

    _consumePickedSuggestion(sentText) {
        const picked = this._pickedSuggestion;
        this._pickedSuggestion = null;
        if (!picked || picked.id == null) return;
        if (!sentText || !String(sentText).includes(picked.text)) return;

        const next = this._interviewSuggestionsItems.filter((it) => it.id !== picked.id);
        if (next.length === this._interviewSuggestionsItems.length) return;

        this._renderInterviewSuggestions(next);
    }

    _updateDimChips(currentVal) {
        document.querySelectorAll('.ai-dim-chip').forEach(chip => {
            chip.classList.toggle('active', chip.dataset.dim === String(currentVal));
        });
    }

    _bindDimChips() {
        const dimInput = document.getElementById('interview-pinecone-dim');
        if (!dimInput) return;
        document.querySelectorAll('.ai-dim-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                dimInput.value = chip.dataset.dim;
                this._updateDimChips(chip.dataset.dim);
            });
        });
        dimInput.addEventListener('input', () => this._updateDimChips(dimInput.value));
    }

    _bindInterviewSettingsKeys() {
        document.querySelectorAll('.interview-key-row').forEach((row) => {
            const provider = row.dataset.provider;
            if (!provider) return;
            const keyInput = row.querySelector('.interview-key-input');
            const icon = row.querySelector('.interview-key-icon');

            // Clear input when focused if showing placeholder dots
            keyInput?.addEventListener('focus', () => {
                if (keyInput.dataset.hasSavedKey === 'true') keyInput.value = '';
            });

            // Auto-save on blur
            keyInput?.addEventListener('blur', async () => {
                const apiKey = keyInput.value.trim();
                if (!apiKey || apiKey === '••••••••') return;
                try {
                    await invoke('interview_set_api_key', { payload: { provider, apiKey } });
                    await this._refreshInterviewKeyRows();
                } catch (err) {
                    this._showToast(`Key save failed: ${err}`, 'error');
                }
            });

            // Auto-save on Enter
            keyInput?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') keyInput.blur();
            });

            // Click green tick → clear
            icon?.addEventListener('click', async () => {
                if (!icon.classList.contains('is-saved')) return;
                try {
                    await invoke('interview_clear_api_key', { provider });
                    await this._refreshInterviewKeyRows();
                } catch (err) {
                    this._showToast(`Clear failed: ${err}`, 'error');
                }
            });
        });
    }

    async _refreshInterviewKeyRows() {
        const st = await invoke('interview_key_status').catch((e) => {
            console.warn('[Interview] key status', e);
            return null;
        });
        if (!st) return;
        document.querySelectorAll('.interview-key-row').forEach((row) => {
            const p = row.dataset.provider;
            const input = row.querySelector('.interview-key-input');
            const icon = row.querySelector('.interview-key-icon');
            if (!p) return;
            const on = st[p] === true;
            if (input) {
                input.dataset.hasSavedKey = on ? 'true' : 'false';
                input.classList.toggle('is-saved', on);
                if (on && !input.value) input.value = '••••••••';
                if (!on) input.value = '';
            }
            if (icon) {
                icon.classList.toggle('is-saved', on);
                icon.classList.toggle('not-set', !on);
                icon.title = on ? 'Click to clear' : 'Not set';
                icon.innerHTML = on
                    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>'
                    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
            }
        });
    }

    _getInterviewUserId() {
        const KEY = 'myjavis_interview_user_id';
        let id = localStorage.getItem(KEY);
        if (!id) {
            id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `u_${Date.now()}`;
            localStorage.setItem(KEY, id);
        }
        return id;
    }

    _scheduleInterviewIngest() {
        if (this.currentTemplate !== 'Interview') return;
        if (!this._interviewCvFile && !this._interviewJdFile) return;
        clearTimeout(this._ingestInterviewDebounce);
        this._ingestInterviewDebounce = setTimeout(() => void this._ingestInterviewFilesNow(), 500);
    }

    async _ingestInterviewFilesNow() {
        if (!this._interviewCvFile && !this._interviewJdFile) return;

        const progressEl = document.getElementById('ingest-progress');
        const fillEl = document.getElementById('ingest-progress-fill');
        const labelEl = document.getElementById('ingest-progress-label');

        const stageLabel = { extracting: 'Extracting…', embedding: 'Embedding…', upserting: 'Saving to index…', done: 'Done' };
        const showProgress = (pct, label) => {
            if (progressEl) progressEl.style.display = 'flex';
            if (fillEl) fillEl.style.width = `${pct}%`;
            if (labelEl) labelEl.textContent = label;
        };
        const hideProgress = () => {
            setTimeout(() => { if (progressEl) progressEl.style.display = 'none'; }, 1200);
        };

        showProgress(0, 'Preparing…');
        const unlisten = await listen('ingest:progress', (e) => {
            const { stage, current, total, docType } = e.payload;
            const prefix = docType === 'cv' ? 'CV' : 'JD';
            let pct = 5;
            if (stage === 'embedding') pct = total > 0 ? 10 + Math.round((current / total) * 70) : 10;
            else if (stage === 'upserting') pct = 85;
            else if (stage === 'done') pct = 100;
            showProgress(pct, `${prefix}: ${stageLabel[stage] || stage}`);
        });

        try {
            const userId = this._getInterviewUserId();
            const req = { userId };
            if (this._interviewCvFile) {
                const buf = await this._interviewCvFile.arrayBuffer();
                req.cv = { filename: this._interviewCvFile.name, bytes: Array.from(new Uint8Array(buf)) };
            }
            if (this._interviewJdFile) {
                const buf = await this._interviewJdFile.arrayBuffer();
                req.jd = { filename: this._interviewJdFile.name, bytes: Array.from(new Uint8Array(buf)) };
            }
            const res = await invoke('ingest_interview_files', { req });
            showProgress(100, 'Indexed');
            this._showToast(res.message || 'Documents indexed', 'success');
        } catch (e) {
            if (progressEl) progressEl.style.display = 'none';
            this._showToast(`Ingest failed: ${e}`, 'error');
        } finally {
            unlisten();
            hideProgress();
        }
    }

    _onInterviewSpeakerFinal(text) {
        if (!this._isSuggestionsMode()) return;
        const t = String(text || '').trim();
        if (!t) return;
        this._lastInterviewSuggestArgs = { transcriptContext: t, userDraft: null };
        this._brainstormPending = true;
        this._injectBrainstormButton();
        if (this.currentTemplate === 'Interview') {
            (async () => {
                try {
                    await invoke('save_interview_message', {
                        req: { userId: this._getInterviewUserId(), role: 'speaker', content: t },
                    });
                } catch (e) {
                    console.warn('[Interview] save speaker line', e);
                }
            })();
        }
    }

    _injectBrainstormButton() {
        if (!this._brainstormPending) return;
        const content = document.getElementById('transcript-content');
        if (!content) return;
        // Remove any existing brainstorm button first
        content.querySelectorAll('.seg-brainstorm-btn').forEach(el => el.remove());
        // Support both view modes: subtitle-pair (subtitle view) and seg-block (single/dual view)
        const pairs = content.querySelectorAll('.subtitle-pair:not(.pending), .seg-block');
        const lastBlock = pairs[pairs.length - 1];
        if (!lastBlock) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'seg-brainstorm-btn';
        btn.title = 'Generate answer suggestions';
        btn.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.3 6l-.7.5V17a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-1.5l-.7-.5A7 7 0 0 1 5 9a7 7 0 0 1 7-7z"/>
            <line x1="9" y1="21" x2="15" y2="21"/>
        </svg>`;
        btn.addEventListener('click', () => {
            this._brainstormPending = false;
            btn.remove();
            this._interviewSuggestionsClosed = false;
            this._setRightPanelCollapsed(false);
            const { transcriptContext, userDraft } = this._lastInterviewSuggestArgs || {};
            this._markInterviewSuggestStart(transcriptContext ? 'speaker' : 'draft');
            this._scheduleSuggestions({ transcriptContext, userDraft });
        });
        lastBlock.appendChild(btn);
    }

    _scheduleSuggestions({ transcriptContext, userDraft }) {
        if (!this._isSuggestionsMode()) return;
        // Manual mode: _markInterviewSuggestStart is called by the trigger button
        this._lastInterviewSuggestArgs = {
            transcriptContext: transcriptContext || null,
            userDraft: userDraft || null,
        };
        clearTimeout(this._interviewSuggestTimer);
        const gen = ++this._interviewSuggestGen;
        this._interviewSuggestTimer = setTimeout(() => {
            void this._runInterviewSuggestions(gen, { transcriptContext, userDraft });
        }, 200);
    }

    _setInterviewSuggestionsStatus(text) {
        const el = document.getElementById('interview-suggestions-status');
        if (!el) return;
        if (!text) {
            el.style.display = 'none';
            el.textContent = '';
            return;
        }
        el.style.display = '';
        el.textContent = text;
    }

    _markInterviewSuggestStart(origin) {
        this._cancelInterviewSuggestionsStreaming();
        if (this._interviewSuggestPerf.hideTimer) {
            clearTimeout(this._interviewSuggestPerf.hideTimer);
            this._interviewSuggestPerf.hideTimer = null;
        }
        this._interviewSuggestPerf.origin = origin || null;
        this._interviewSuggestPerf.t0 = performance.now();
        if (this._interviewSuggestPerf.timer) clearInterval(this._interviewSuggestPerf.timer);
        this._interviewSuggestPerf.timer = setInterval(() => {
            const ms = performance.now() - this._interviewSuggestPerf.t0;
            const s = (ms / 1000).toFixed(ms < 10_000 ? 1 : 0);
            this._setInterviewSuggestionsStatus(`Generating… ${s}s`);
        }, 100);
        this._setInterviewSuggestionsStatus('Generating… 0.0s');
    }

    _markInterviewSuggestDone(ok) {
        const t0 = this._interviewSuggestPerf.t0 || performance.now();
        const ms = performance.now() - t0;
        const s = (ms / 1000).toFixed(ms < 10_000 ? 1 : 0);
        if (this._interviewSuggestPerf.timer) {
            clearInterval(this._interviewSuggestPerf.timer);
            this._interviewSuggestPerf.timer = null;
        }
        this._setInterviewSuggestionsStatus(ok ? `Done · ${s}s` : `Failed · ${s}s`);
        this._interviewSuggestPerf.hideTimer = setTimeout(() => {
            this._setInterviewSuggestionsStatus('');
            this._interviewSuggestPerf.hideTimer = null;
        }, 2500);
    }

    _cancelInterviewSuggestionsStreaming() {
        const timers = this._interviewSuggestionsStream?.timers || [];
        timers.forEach((t) => {
            clearTimeout(t);
            clearInterval(t);
        });
        this._interviewSuggestionsStream.timers = [];
    }

    _renderInterviewSuggestionsStream(items) {
        // Renders list immediately (structure/buttons), then reveals text progressively.
        this._cancelInterviewSuggestionsStreaming();
        const t0 = this._interviewSuggestPerf.t0;
        const ms = t0 ? performance.now() - t0 : 0;
        const renderTime = ms > 0 ? (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's' : '';

        const panel = document.getElementById('interview-suggestions-panel');
        const list = document.getElementById('interview-suggestions-list');
        if (!panel || !list) return;

        const normalized = this._normalizeInterviewSuggestionItems(items);
        this._interviewSuggestionsItems = normalized.slice();

        if (this._interviewSuggestionsClosed) {
            panel.style.display = '';
            this._setRightPanelCollapsed(true);
            this._updateSuggestionsEmptyState();
            return;
        }
        if (!this._isSuggestionsMode()) {
            panel.style.display = 'none';
            list.innerHTML = '';
            this._undockInterviewSuggestions();
            return;
        }
        if (!normalized.length) {
            panel.style.display = '';
            list.innerHTML = '';
            this._dockInterviewSuggestionsRight();
            this._setRightPanelCollapsed(true);
            this._updateSuggestionsEmptyState();
            return;
        }

        this._updateSuggestionsEmptyState();

        this._setRightPanelCollapsed(false);
        panel.style.display = '';
        list.innerHTML = '';

        const suggestionType = settingsManager.get().suggestion_type || 'translation';

        const mkTypewriter = (btn, fullText) => {
            const text = String(fullText || '');
            btn.textContent = '';
            const state = { i: 0 };
            const tick = () => {
                const chunk = text.slice(0, state.i);
                btn.textContent = chunk;
                if (state.i >= text.length) return false;
                state.i = Math.min(text.length, state.i + Math.max(2, Math.ceil(text.length / 40)));
                return true;
            };
            tick();
            const interval = setInterval(() => {
                if (!tick()) clearInterval(interval);
            }, 30);
            this._interviewSuggestionsStream.timers.push(interval);
        };

        normalized.forEach((item, idx) => {
            const delay = idx * 120;
            const t = setTimeout(() => {
                if (suggestionType === 'both') {
                    if (!item.target.trim() && !item.translation.trim()) return;
                    const li = document.createElement('li');
                    li.className = 'suggestion-chip-row';
                    li.dataset.face = 'target';
                    this._prependSuggestionKindLabel(li, item);
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'suggestion-chip';

                    const del = document.createElement('button');
                    del.type = 'button';
                    del.className = 'suggestion-chip-delete';
                    del.title = 'Remove suggestion';
                    del.setAttribute('aria-label', 'Remove suggestion');
                    del.innerHTML = '×';
                    del.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this._renderInterviewSuggestions(this._interviewSuggestionsItems.filter((it) => it.id !== item.id));
                    });

                    const toggle = document.createElement('button');
                    toggle.type = 'button';
                    toggle.className = 'suggestion-chip-lang';
                    toggle.title = 'Switch language';
                    toggle.setAttribute('aria-label', 'Switch language');
                    toggle.innerHTML =
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
                    toggle.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const nextFace = li.dataset.face === 'translation' ? 'target' : 'translation';
                        li.dataset.face = nextFace;
                        const full = this._suggestionFaceText(item, nextFace);
                        mkTypewriter(btn, full);
                    });

                    btn.addEventListener('click', () => {
                        const face = li.dataset.face === 'translation' ? 'translation' : 'target';
                        const text = this._suggestionFaceText(item, face);
                        if (!text.trim()) return;
                        const ta = document.getElementById('chat-input');
                        this._pickedSuggestion = { id: item.id, text };
                        if (ta) this._insertIntoTextarea(ta, `${text} `);
                    });

                    const timeSpan = document.createElement('span');
                    timeSpan.className = 'suggestion-chip-time';
                    timeSpan.textContent = renderTime;

                    li.appendChild(btn);
                    li.appendChild(del);
                    li.appendChild(timeSpan);
                    li.appendChild(toggle);
                    list.appendChild(li);

                    mkTypewriter(btn, this._suggestionFaceText(item, 'target'));
                    return;
                }

                const text = this._suggestionChipLabel(item, suggestionType);
                if (!text.trim()) return;
                const li = document.createElement('li');
                li.className = 'suggestion-chip-row';
                this._prependSuggestionKindLabel(li, item);
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'suggestion-chip';
                btn.addEventListener('click', () => {
                    const ta = document.getElementById('chat-input');
                    this._pickedSuggestion = { id: item.id, text };
                    if (ta) this._insertIntoTextarea(ta, `${text} `);
                });
                const del = document.createElement('button');
                del.type = 'button';
                del.className = 'suggestion-chip-delete';
                del.title = 'Remove suggestion';
                del.setAttribute('aria-label', 'Remove suggestion');
                del.innerHTML = '×';
                del.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._renderInterviewSuggestions(this._interviewSuggestionsItems.filter((it) => it.id !== item.id));
                });

                const timeSpan = document.createElement('span');
                timeSpan.className = 'suggestion-chip-time';
                timeSpan.textContent = renderTime;

                li.appendChild(btn);
                li.appendChild(del);
                li.appendChild(timeSpan);
                list.appendChild(li);
                mkTypewriter(btn, text);
            }, delay);
            this._interviewSuggestionsStream.timers.push(t);
        });

        this._dockInterviewSuggestionsRight();
    }

    async _runInterviewSuggestions(gen, { transcriptContext, userDraft }) {
        if (gen !== this._interviewSuggestGen) return;
        const panel = document.getElementById('interview-suggestions-panel');
        try {
            // If we didn't get a speaker/draft marker for some reason, start timing here.
            if (!this._interviewSuggestPerf.t0) this._markInterviewSuggestStart(null);
            const res = await invoke('suggest_interview_answers', {
                req: {
                    userId: this._getInterviewUserId(),
                    transcriptContext: transcriptContext || null,
                    userDraft: userDraft || null,
                    appMode: settingsManager.get().app_mode || this.currentTemplate || null,
                },
            });
            if (gen !== this._interviewSuggestGen) return;
            this._renderInterviewSuggestionsStream(res.suggestions || []);
            this._markInterviewSuggestDone(true);
        } catch (e) {
            console.warn('[Interview] suggest', e);
            if (gen === this._interviewSuggestGen) this._updateSuggestionsEmptyState();
            this._markInterviewSuggestDone(false);
        }
    }

    _normalizeInterviewSuggestionItems(raw) {
        const st = settingsManager.get().suggestion_type || 'translation';
        if (!Array.isArray(raw)) return [];
        return raw.map((x, i) => {
            if (typeof x === 'string') {
                if (st === 'translation') return { id: i, target: '', translation: x, suggestion_kind: 'answer' };
                if (st === 'target') return { id: i, target: x, translation: '', suggestion_kind: 'answer' };
                return { id: i, target: x, translation: x, suggestion_kind: 'answer' };
            }
            const id = typeof x.id === 'number' ? x.id : i;
            return {
                id,
                target: x.target != null ? String(x.target) : '',
                translation: x.translation != null ? String(x.translation) : '',
                suggestion_kind: x.suggestionKind != null
                    ? String(x.suggestionKind)
                    : (x.suggestion_kind != null ? String(x.suggestion_kind) : 'answer'),
            };
        });
    }

    _suggestionFaceText(item, face) {
        return face === 'translation' ? item.translation : item.target;
    }

    _suggestionChipLabel(item, suggestionType) {
        if (suggestionType === 'translation') return item.translation || item.target;
        if (suggestionType === 'target') return item.target || item.translation;
        return item.target || item.translation;
    }

    _renderInterviewSuggestions(items) {
        const panel = document.getElementById('interview-suggestions-panel');
        const list = document.getElementById('interview-suggestions-list');
        if (!panel || !list) return;
        const normalized = this._normalizeInterviewSuggestionItems(items);
        this._interviewSuggestionsItems = normalized.slice();
        if (this._interviewSuggestionsClosed) {
            panel.style.display = '';
            this._setRightPanelCollapsed(true);
            this._updateSuggestionsEmptyState();
            return;
        }
        if (!this._isSuggestionsMode()) {
            panel.style.display = 'none';
            list.innerHTML = '';
            this._undockInterviewSuggestions();
            return;
        }
        if (!normalized.length) {
            panel.style.display = '';
            list.innerHTML = '';
            this._dockInterviewSuggestionsRight();
            this._setRightPanelCollapsed(true);
            this._updateSuggestionsEmptyState();
            return;
        }
        this._updateSuggestionsEmptyState();
        this._setRightPanelCollapsed(false);
        panel.style.display = '';
        list.innerHTML = '';
        const suggestionType = settingsManager.get().suggestion_type || 'translation';
        normalized.forEach((item) => {
            if (suggestionType === 'both') {
                if (!item.target.trim() && !item.translation.trim()) return;
                const li = document.createElement('li');
                li.className = 'suggestion-chip-row';
                li.dataset.face = 'target';
                this._prependSuggestionKindLabel(li, item);
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'suggestion-chip';
                btn.textContent = this._suggestionFaceText(item, 'target');

                const del = document.createElement('button');
                del.type = 'button';
                del.className = 'suggestion-chip-delete';
                del.title = 'Remove suggestion';
                del.setAttribute('aria-label', 'Remove suggestion');
                del.innerHTML = '×';
                del.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._renderInterviewSuggestions(this._interviewSuggestionsItems.filter((it) => it.id !== item.id));
                });

                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'suggestion-chip-lang';
                toggle.title = 'Switch language';
                toggle.setAttribute('aria-label', 'Switch language');
                toggle.innerHTML =
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const nextFace = li.dataset.face === 'translation' ? 'target' : 'translation';
                    li.dataset.face = nextFace;
                    btn.textContent = this._suggestionFaceText(item, nextFace);
                });
                btn.addEventListener('click', () => {
                    const face = li.dataset.face === 'translation' ? 'translation' : 'target';
                    const text = this._suggestionFaceText(item, face);
                    if (!text.trim()) return;
                    const ta = document.getElementById('chat-input');
                    this._pickedSuggestion = { id: item.id, text };
                    if (ta) this._insertIntoTextarea(ta, `${text} `);
                });
                li.appendChild(btn);
                li.appendChild(del);
                li.appendChild(toggle);
                list.appendChild(li);
                return;
            }
            const text = this._suggestionChipLabel(item, suggestionType);
            if (!text.trim()) return;
            const li = document.createElement('li');
            li.className = 'suggestion-chip-row';
            this._prependSuggestionKindLabel(li, item);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'suggestion-chip';
            btn.textContent = text;
            btn.addEventListener('click', () => {
                const ta = document.getElementById('chat-input');
                this._pickedSuggestion = { id: item.id, text };
                if (ta) this._insertIntoTextarea(ta, `${text} `);
            });
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'suggestion-chip-delete';
            del.title = 'Remove suggestion';
            del.setAttribute('aria-label', 'Remove suggestion');
            del.innerHTML = '×';
            del.addEventListener('click', (e) => {
                e.stopPropagation();
                this._renderInterviewSuggestions(this._interviewSuggestionsItems.filter((it) => it.id !== item.id));
            });
            li.appendChild(btn);
            li.appendChild(del);
            list.appendChild(li);
        });

        // For Interview/Meeting template, show suggestions in a split right panel (subtitle stays visible on the left).
        this._dockInterviewSuggestionsRight();
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});
