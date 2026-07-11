/**
 * Transcript UI — continuous paragraph flow display with speaker diarization
 * 
 * Design: All text flows as one continuous paragraph.
 * - Translated text: white (primary color)
 * - Original text (pending translation): cyan/accent color  
 * - Provisional text (being recognized): dimmed
 * - Speaker labels: shown when speaker changes (e.g. "Speaker 1:")
 * - Language badges: shown when detected language changes (e.g. "🇯🇵 JA")
 * - Confidence: low-confidence segments highlighted
 */

export class TranscriptUI {
    constructor(container) {
        this.container = container;
        this.contentEl = null;
        this.maxChars = 1200;
        this.fontSize = 16;
        this.viewMode = 'single'; // 'single' or 'dual'

        // Segments: each has { original, translation, status, speaker, language, confidence }
        this.segments = [];
        // sessionLog: parallel array — never trimmed, holds complete session history
        this.sessionLog = [];
        this.provisionalText = '';
        this.provisionalSpeaker = null;
        this.provisionalLanguage = null;
        // Source-side provisional (OpenAI Realtime: source ASR is separate from target).
        // Soniox leaves this empty; its provisionalText carries the source-language ASR.
        this.sourceProvisionalText = '';
        // Provider hint — Soniox puts source-language in provisionalText; OpenAI
        // splits source/target streams; Qwen Live Flash emits target-only.
        // Backing field for the `provider` getter/setter below.
        this._provider = 'soniox';
        this.currentSpeaker = null; // Track current speaker to detect changes
        this.currentLanguage = null; // Track current language to detect changes
        this.lastConfidence = null; // Last confidence score from Soniox
    }

    get provider() {
        return this._provider;
    }

    set provider(value) {
        this._provider = value;
        // Qwen Live Flash has no source channel — strip the dual-view CSS class
        // so the overlay reverts to single-column layout even if viewMode='dual'.
        const overlay = document.getElementById('overlay-view');
        if (overlay) {
            const wantsDual = this.viewMode === 'dual' && value !== 'qwen';
            overlay.classList.toggle('dual-view', wantsDual);
        }
    }

    /**
     * Update display settings
     */
    configure({ maxLines, showOriginal, fontSize, fontColor, viewMode }) {
        if (maxLines !== undefined) this.maxChars = maxLines * 160;
        if (fontSize !== undefined) {
            this.fontSize = fontSize;
            this.container.style.setProperty('--transcript-font-size', `${fontSize}px`);
        }
        if (fontColor !== undefined) {
            this.fontColor = fontColor;
            this.container.style.setProperty('--transcript-font-color', fontColor);
        }
        if (viewMode !== undefined) {
            this.viewMode = viewMode;
            const overlay = document.getElementById('overlay-view');
            if (overlay) {
                const wantsDual = viewMode === 'dual' && this._provider !== 'qwen';
                overlay.classList.toggle('dual-view', wantsDual);
            }
            this._render();
        }
    }

    /**
     * Add finalized original text (pending translation)
     */
    addOriginal(text, speaker, language) {
        this._removeListening();
        const seg = {
            original: text,
            translation: null,
            status: 'original',
            speaker: speaker || null,
            language: language || null,
            confidence: this.lastConfidence,
            createdAt: Date.now(),
        };
        this.segments.push(seg);
        // Also push a separate copy to sessionLog (never trimmed)
        this.sessionLog.push({
            original: text,
            translation: null,
            status: 'original',
            speaker: speaker || null,
            language: language || null,
            confidence: this.lastConfidence,
            createdAt: seg.createdAt,
        });
        if (speaker) this.currentSpeaker = speaker;
        if (language) this.currentLanguage = language;
        this._cleanupStaleOriginals();
        this._render();
    }

    /**
     * Apply translation to the oldest untranslated segment
     */
    addTranslation(text) {
        const seg = this.segments.find(s => s.status === 'original');
        if (seg) {
            seg.translation = text;
            seg.status = 'translated';
            // Mirror update in sessionLog: find matching entry by createdAt
            const logSeg = this.sessionLog.find(
                s => s.status === 'original' && s.createdAt === seg.createdAt
            );
            if (logSeg) {
                logSeg.translation = text;
                logSeg.status = 'translated';
            }
        } else {
            const newSeg = {
                original: '',
                translation: text,
                status: 'translated',
                speaker: null,
                createdAt: Date.now(),
            };
            this.segments.push(newSeg);
            this.sessionLog.push({ ...newSeg });
        }
        this._render();
    }

    /**
     * Update provisional (in-progress) text
     */
    setProvisional(text, speaker, language) {
        this._removeListening();
        this.provisionalText = text;
        this.provisionalSpeaker = speaker || null;
        this.provisionalLanguage = language || null;
        this._render();
    }

    /**
     * Clear provisional text
     */
    clearProvisional() {
        this.provisionalText = '';
        this.provisionalSpeaker = null;
        this.provisionalLanguage = null;
        this._render();
    }

    /**
     * Set source-side provisional (OpenAI Realtime only). Renders on the source
     * panel in dual view; ignored in single view (which shows target only).
     */
    setSourceProvisional(text) {
        this._removeListening();
        this.sourceProvisionalText = text || '';
        this._render();
    }

    clearSourceProvisional() {
        this.sourceProvisionalText = '';
        this._render();
    }

    /**
     * Check if there is any content to display
     */
    hasContent() {
        return this.segments.length > 0 || this.provisionalText ||
            !!this.container.querySelector('.listening-indicator');
    }

    /**
     * Show placeholder state
     */
    showPlaceholder() {
        this.container.innerHTML = `
      <div class="transcript-placeholder">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="8" y1="23" x2="16" y2="23"/>
        </svg>
        <p>Press ▶ to start translating</p>
        <p class="shortcut-hint">⌘ Enter</p>
      </div>
    `;
        this.segments = [];
        this.sessionLog = [];
        this.provisionalText = '';
        this.provisionalSpeaker = null;
        this.provisionalLanguage = null;
        this.currentSpeaker = null;
        this.currentLanguage = null;
        this.lastConfidence = null;
        this.contentEl = null;
    }

    /**
     * Show listening state
     */
    showListening() {
        // Remove existing indicators first (prevent duplicates)
        this.container.querySelectorAll('.listening-indicator').forEach(el => el.remove());

        const placeholder = this.container.querySelector('.transcript-placeholder');
        if (placeholder) placeholder.remove();

        this._ensureContent();

        const indicator = document.createElement('div');
        indicator.className = 'listening-indicator';
        indicator.innerHTML = `
            <div class="listening-waves">
                <span></span><span></span><span></span><span></span><span></span>
            </div>
            <p>Listening...</p>
        `;
        this.contentEl.appendChild(indicator);
    }

    /**
     * Show status message in transcript area (e.g. loading model)
     */
    showStatusMessage(message) {
        this._ensureContent();
        let statusEl = this.contentEl.querySelector('.pipeline-status');
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.className = 'pipeline-status';
            statusEl.style.cssText = 'text-align:center; padding:8px; color:rgba(255,255,255,0.5); font-size:13px;';
            this.contentEl.appendChild(statusEl);
        }
        statusEl.textContent = message;
    }

    /**
     * Remove status message
     */
    removeStatusMessage() {
        if (this.contentEl) {
            const statusEl = this.contentEl.querySelector('.pipeline-status');
            if (statusEl) statusEl.remove();
        }
    }

    /**
     * Get transcript as plain text for copying
     */
    getPlainText() {
        let lines = [];
        for (const seg of this.segments) {
            if (seg.original) lines.push(seg.original);
            if (seg.translation) lines.push(seg.translation);
            if (seg.original || seg.translation) lines.push('');
        }
        if (this.provisionalText) lines.push(this.provisionalText);
        return lines.join('\n').trim();
    }

    /**
     * Get formatted content for saving to file (markdown with metadata)
     */
    getFormattedContent(metadata = {}) {
        if (this.segments.length === 0) return null;

        const lines = [];

        // Metadata header
        lines.push('---');
        lines.push(`date: ${new Date().toISOString()}`);
        if (metadata.model) lines.push(`model: ${metadata.model}`);
        if (metadata.sourceLang) lines.push(`source_language: ${metadata.sourceLang}`);
        if (metadata.targetLang) lines.push(`target_language: ${metadata.targetLang}`);
        if (metadata.duration) lines.push(`recording_duration: ${metadata.duration}`);
        if (metadata.audioSource) lines.push(`audio_source: ${metadata.audioSource}`);
        lines.push(`segments: ${this.segments.length}`);
        lines.push('---');
        lines.push('');

        // Transcript entries
        for (const seg of this.segments) {
            if (seg.speaker) lines.push(`**Speaker ${seg.speaker}:**`);
            if (seg.original) lines.push(`> ${seg.original}`);
            if (seg.translation) lines.push(seg.translation);
            lines.push('');
        }

        return lines.join('\n').trim();
    }

    /**
     * Check if there are segments to save
     */
    hasSegments() {
        return this.segments.length > 0;
    }

    /**
     * Check if sessionLog has content (full session, not display buffer)
     */
    hasSessionContent() {
        return this.sessionLog.length > 0;
    }

    /**
     * Get full session text from sessionLog (never trimmed).
     * Returns formatted markdown with all segments.
     */
    getFullSessionText(metadata = {}) {
        if (this.sessionLog.length === 0) return null;

        const lines = [];

        // YAML frontmatter
        lines.push('---');
        const now = new Date();
        lines.push(`date: ${now.toISOString().slice(0, 10)}`);
        lines.push(`time: ${now.toTimeString().slice(0, 8)}`);
        if (metadata.duration) lines.push(`duration: ${metadata.duration}`);
        if (metadata.sourceLang) lines.push(`source_lang: ${metadata.sourceLang}`);
        if (metadata.targetLang) lines.push(`target_lang: ${metadata.targetLang}`);
        if (metadata.mode) lines.push(`mode: ${metadata.mode}`);
        if (metadata.audioSource) lines.push(`audio_source: ${metadata.audioSource}`);
        if (metadata.model) lines.push(`model: ${metadata.model}`);
        lines.push(`segments: ${this.sessionLog.length}`);
        lines.push('---');
        lines.push('');

        // Transcript entries
        for (const seg of this.sessionLog) {
            if (seg.speaker) lines.push(`**Speaker ${seg.speaker}:**`);
            if (seg.original) lines.push(`> ${seg.original}`);
            if (seg.translation) lines.push(seg.translation);
            lines.push('');
        }

        return lines.join('\n').trim();
    }

    /**
     * Clear session log (call after saving)
     */
    clearSession() {
        this.sessionLog = [];
    }

    /**
     * Clear display buffer only (segments array).
     * sessionLog is NOT cleared — use clearSession() explicitly.
     */
    clear() {
        this.container.innerHTML = '';
        this.segments = [];
        this.provisionalText = '';
        this.provisionalSpeaker = null;
        this.provisionalLanguage = null;
        this.currentSpeaker = null;
        this.currentLanguage = null;
        this.lastConfidence = null;
        this.contentEl = null;
    }

    /**
     * Update confidence score
     */
    setConfidence(confidence) {
        this.lastConfidence = confidence;
    }

    // ─── Internal ──────────────────────────────────────────

    _ensureContent() {
        if (!this.contentEl) {
            this.container.innerHTML = '';
            this.contentEl = document.createElement('div');
            this.contentEl.className = 'transcript-flow';
            this.container.appendChild(this.contentEl);
        }
    }

    _removeListening() {
        const indicator = this.container.querySelector('.listening-indicator');
        if (indicator) indicator.remove();
    }

    _render() {
        this._ensureContent();
        this._trimSegments();

        // Qwen Live Flash is translation-only (no source transcript channel),
        // so force single-panel even when the user picked dual view — otherwise
        // the source panel sits empty / shows dim provisional noise.
        if (this.viewMode === 'dual' && this.provider !== 'qwen') {
            this._renderDual();
        } else {
            this._renderSingle();
        }
    }

    _renderSingle() {
        let html = '';
        let lastRenderedSpeaker = null;
        let lastRenderedLang = null;

        for (const seg of this.segments) {
            // Speaker label
            if (seg.speaker && seg.speaker !== lastRenderedSpeaker) {
                html += `<span class="speaker-label">Speaker ${seg.speaker}:</span> `;
                lastRenderedSpeaker = seg.speaker;
            }

            // Language badge
            if (seg.language && seg.language !== lastRenderedLang) {
                html += `<span class="lang-badge">${this._langEmoji(seg.language)}</span> `;
                lastRenderedLang = seg.language;
            }

            if (seg.status === 'translated' && seg.translation) {
                const confidenceClass = (seg.confidence !== null && seg.confidence < 0.7) ? ' low-confidence' : '';
                html += `<div class="seg-block">`;
                html += `<div class="seg-translated${confidenceClass}">${this._esc(seg.translation)}</div>`;
                html += `</div>`;
            }
            // Skip 'original' segments in single mode — wait for translation
        }

        if (this.provisionalText) {
            if (this.provisionalSpeaker && this.provisionalSpeaker !== lastRenderedSpeaker) {
                html += `<span class="speaker-label">Speaker ${this.provisionalSpeaker}:</span> `;
            }
            if (this.provisionalLanguage && this.provisionalLanguage !== lastRenderedLang) {
                html += `<span class="lang-badge">${this._langEmoji(this.provisionalLanguage)}</span> `;
            }
            // OpenAI splits source/target streams: when sourceProvisionalText is
            // present, provisionalText is already the translated stream → render
            // as bright translated text. Qwen Live Flash is translation-only —
            // provisionalText is the target language too. Soniox uses
            // provisionalText for source ASR → keep dim italic.
            const isTargetStream = this.sourceProvisionalText || this.provider === 'qwen';
            const cls = isTargetStream ? 'seg-translated' : 'seg-provisional';
            html += `<div class="seg-block"><div class="${cls}">${this._esc(this.provisionalText)}</div></div>`;
        }

        this.contentEl.innerHTML = html;
        // #transcript-content is the scroller since the activity-shell redesign
        // (its parent #transcript-container is overflow:hidden). Scroll whichever
        // actually overflows so this stays correct if the layout shifts again.
        const parent = this.container.parentElement;
        const scroller = (this.container.scrollHeight > this.container.clientHeight || !parent)
            ? this.container : parent;
        this._smartScroll(scroller);
    }

    _renderDual() {
        // Save scroll state before re-render
        const oldSrcPanel = this.contentEl.querySelector('.panel-source');
        const oldTgtPanel = this.contentEl.querySelector('.panel-translation');
        const srcScrollState = oldSrcPanel ? this._getScrollState(oldSrcPanel) : { nearBottom: true, scrollTop: 0 };
        const tgtScrollState = oldTgtPanel ? this._getScrollState(oldTgtPanel) : { nearBottom: true, scrollTop: 0 };

        let srcHtml = '';
        let tgtHtml = '';
        let lastSpeaker = null;
        let lastLang = null;

        for (const seg of this.segments) {
            let speakerHtml = '';
            if (seg.speaker && seg.speaker !== lastSpeaker) {
                speakerHtml = `<div class="speaker-label">Speaker ${seg.speaker}:</div>`;
                lastSpeaker = seg.speaker;
            }

            let langHtml = '';
            if (seg.language && seg.language !== lastLang) {
                langHtml = `<span class="lang-badge">${this._langEmoji(seg.language)}</span> `;
                lastLang = seg.language;
            }

            if (seg.status === 'translated' && seg.translation) {
                const confidenceClass = (seg.confidence !== null && seg.confidence < 0.7) ? ' low-confidence' : '';
                srcHtml += speakerHtml + langHtml;
                srcHtml += `<div class="seg-text">${this._esc(seg.original || '')}</div>`;
                tgtHtml += speakerHtml ? '<div class="speaker-label">&nbsp;</div>' : '';
                tgtHtml += `<div class="seg-text${confidenceClass}">${this._esc(seg.translation)}</div>`;
            } else if (seg.status === 'original' && seg.original) {
                srcHtml += speakerHtml + langHtml;
                srcHtml += `<div class="seg-text pending">${this._esc(seg.original)}</div>`;
                tgtHtml += speakerHtml ? '<div class="speaker-label">&nbsp;</div>' : '';
                tgtHtml += `<div class="seg-text pending">...</div>`;
            }
        }

        // Two providers feed provisional text differently:
        // - Soniox: provisionalText is the source-language ASR (no separate source channel).
        // - OpenAI Realtime: sourceProvisionalText is source ASR; provisionalText is target.
        // Use explicit provider flag — checking !!sourceProvisionalText fails when
        // whisper lags behind translation, dumping target deltas into the source panel.
        if (this.sourceProvisionalText || this.provisionalText) {
            const usingOpenAi = this.provider === 'openai';
            const srcText = usingOpenAi ? this.sourceProvisionalText : this.provisionalText;
            const tgtText = usingOpenAi ? this.provisionalText : '';
            if (srcText) srcHtml += `<div class="seg-text pending">${this._esc(srcText)}</div>`;
            tgtHtml += `<div class="seg-text pending">${tgtText ? this._esc(tgtText) : '...'}</div>`;
        }

        this.contentEl.innerHTML = `
            <div class="panel-source">${srcHtml}</div>
            <div class="panel-translation">${tgtHtml}</div>
        `;

        // Restore scroll: auto-scroll if was near bottom, otherwise keep position
        const srcPanel = this.contentEl.querySelector('.panel-source');
        const tgtPanel = this.contentEl.querySelector('.panel-translation');
        if (srcPanel) {
            if (srcScrollState.nearBottom) {
                srcPanel.scrollTop = srcPanel.scrollHeight;
            } else {
                srcPanel.scrollTop = srcScrollState.scrollTop;
            }
        }
        if (tgtPanel) {
            if (tgtScrollState.nearBottom) {
                tgtPanel.scrollTop = tgtPanel.scrollHeight;
            } else {
                tgtPanel.scrollTop = tgtScrollState.scrollTop;
            }
        }
    }

    _getScrollState(el) {
        return {
            nearBottom: (el.scrollHeight - el.scrollTop - el.clientHeight) < 100,
            scrollTop: el.scrollTop
        };
    }

    _smartScroll(el) {
        const isNearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 100;
        if (isNearBottom) {
            el.scrollTop = el.scrollHeight;
        }
    }

    _trimSegments() {
        let totalLen = 0;
        for (const seg of this.segments) {
            totalLen += (seg.translation || seg.original || '').length;
        }
        while (totalLen > this.maxChars && this.segments.length > 2) {
            const removed = this.segments.shift();
            totalLen -= (removed.translation || removed.original || '').length;
        }
    }

    /**
     * Remove stale original segments that never received translation.
     * - Originals older than 10s are removed
     * - Max 3 pending originals allowed (oldest dropped)
     */
    _cleanupStaleOriginals() {
        const now = Date.now();
        const STALE_MS = 10000; // 10 seconds
        const MAX_PENDING = 3;

        // Remove originals older than STALE_MS
        this.segments = this.segments.filter(seg => {
            if (seg.status === 'original' && (now - seg.createdAt) > STALE_MS) {
                return false; // drop stale
            }
            return true;
        });

        // If still too many pending originals, drop oldest
        let pending = this.segments.filter(s => s.status === 'original');
        while (pending.length > MAX_PENDING) {
            const oldest = pending.shift();
            const idx = this.segments.indexOf(oldest);
            if (idx !== -1) this.segments.splice(idx, 1);
        }
    }

    _esc(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get language flag emoji + code
     */
    _langEmoji(langCode) {
        const flags = {
            'en': '🇬🇧', 'ja': '🇯🇵', 'ko': '🇰🇷', 'zh': '🇨🇳',
            'vi': '🇻🇳', 'fr': '🇫🇷', 'de': '🇩🇪', 'es': '🇪🇸',
            'th': '🇹🇭', 'id': '🇮🇩', 'pt': '🇵🇹', 'ru': '🇷🇺',
            'ar': '🇸🇦', 'hi': '🇮🇳', 'it': '🇮🇹', 'nl': '🇳🇱',
            'pl': '🇵🇱', 'tr': '🇹🇷', 'sv': '🇸🇪', 'da': '🇩🇰',
            'no': '🇳🇴', 'fi': '🇫🇮', 'el': '🇬🇷', 'cs': '🇨🇿',
            'ro': '🇷🇴', 'hu': '🇭🇺', 'uk': '🇺🇦', 'he': '🇮🇱',
            'ms': '🇲🇾', 'tl': '🇵🇭', 'bn': '🇧🇩', 'ta': '🇱🇰',
        };
        const flag = flags[langCode] || '🌐';
        return `${flag} ${langCode.toUpperCase()}`;
    }
}
