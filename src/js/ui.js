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
        this.viewMode = 'subtitle'; // 'single' | 'dual' | 'subtitle'

        // Segments: each has { original, translation, status, speaker, language, confidence }
        this.segments = [];
        // sessionLog: parallel array — never trimmed, holds complete session history
        this.sessionLog = [];
        this.provisionalText = '';
        this.provisionalSpeaker = null;
        this.provisionalLanguage = null;
        this.currentSpeaker = null; // Track current speaker to detect changes
        this.currentLanguage = null; // Track current language to detect changes
        this.lastConfidence = null; // Last confidence score from Soniox
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
                overlay.classList.toggle('dual-view', viewMode === 'dual');
                if (viewMode !== 'dual') {
                    overlay.classList.remove('dual-view');
                }
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
     * Add a chat message (UI-only) into subtitle timeline
     */
    addChatMessage(text, who = 'ME') {
        this._removeListening();
        const seg = {
            original: text,
            translation: null,
            status: 'chat',
            speaker: who,
            language: null,
            confidence: null,
            createdAt: Date.now(),
        };
        this.segments.push(seg);
        this.sessionLog.push({ ...seg });
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

    loadSegments(segments, { replaceSessionLog = true } = {}) {
        this._removeListening();
        this._ensureContent();
        this.segments = Array.isArray(segments) ? segments : [];
        if (replaceSessionLog) this.sessionLog = this.segments.map(s => ({ ...s }));
        this.provisionalText = '';
        this.provisionalSpeaker = null;
        this.provisionalLanguage = null;
        this.currentSpeaker = null;
        this.currentLanguage = null;
        this.lastConfidence = null;
        this._render();
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

        if (this.viewMode === 'dual') {
            this._renderDual();
        } else if (this.viewMode === 'subtitle') {
            this._renderSubtitle();
        } else {
            this._renderSingle();
        }
        this.onAfterRender?.();
    }

    _renderSubtitle() {
        // Subtitle timeline: render multiple bilingual blocks, but merge tiny fragments
        // into fuller sentence-like chunks (movie-style pacing, not one global 2-line block).

        const isStrongBoundary = (text) => /[.!?]\s*$/.test(text);
        const isWeakBoundary = (text) => /[,;:]\s*$/.test(text);
        const cleanJoin = (parts) => parts.join(' ').replace(/\s+/g, ' ').trim();

        const translated = this.segments.filter(s => s.status === 'translated' && s.translation);
        const pendingOriginals = this.segments.filter(s => s.status === 'original' && s.original);
        const chatSegs = this.segments.filter(s => s.status === 'chat' && s.original);

        const chunks = [];
        let enBuf = [];
        let viBuf = [];
        let lastMeta = null; // keep last seg meta for labels
        let currentSpeaker = null;

        const flush = () => {
            const en = cleanJoin(enBuf.filter(Boolean));
            const vi = cleanJoin(viBuf.filter(Boolean));
            if (en || vi) {
                chunks.push({
                    en,
                    vi,
                    meta: lastMeta,
                    speaker: currentSpeaker,
                });
            }
            enBuf = [];
            viBuf = [];
        };

        // Iterate in original order but only handle translated + chat
        const ordered = this.segments.filter(s =>
            (s.status === 'translated' && s.translation) || (s.status === 'chat' && s.original)
        );

        const GAP_MS = 5000;
        let lastSegTime = null;

        for (const seg of ordered) {
            if (seg.status === 'chat') {
                // Flush any pending bilingual buffer before rendering chat bubble
                flush();
                lastSegTime = seg.createdAt || null;
                chunks.push({
                    en: seg.original.trim(),
                    vi: '',
                    meta: seg,
                    speaker: seg.speaker || 'ME',
                    kind: 'chat',
                });
                continue;
            }

            // Speaker change -> start a new subtitle chunk
            const segSpeaker = seg.speaker || null;
            if (currentSpeaker === null) {
                currentSpeaker = segSpeaker;
            } else if (segSpeaker !== currentSpeaker) {
                flush();
                currentSpeaker = segSpeaker;
            }

            // Time gap > 5s -> treat as new subtitle block
            if (lastSegTime !== null && seg.createdAt && (seg.createdAt - lastSegTime) > GAP_MS) {
                flush();
            }
            lastSegTime = seg.createdAt || lastSegTime;

            const en = (seg.original || '').trim();
            const vi = (seg.translation || '').trim();
            if (en) enBuf.push(en);
            if (vi) viBuf.push(vi);
            lastMeta = seg;

            const enLine = cleanJoin(enBuf);
            const viLine = cleanJoin(viBuf);

            const tooLong = enLine.length >= 90 || viLine.length >= 110;
            const bigEnough = enLine.length >= 55 || viLine.length >= 70;
            const veryBig = enLine.length >= 75 || viLine.length >= 95;

            // Only break on punctuation if we already have a reasonably-sized chunk,
            // otherwise keep accumulating to avoid tiny subtitle fragments.
            const shouldBreak =
                tooLong ||
                ((isStrongBoundary(en) || isStrongBoundary(vi)) && bigEnough) ||
                ((isWeakBoundary(en) || isWeakBoundary(vi)) && veryBig);

            if (shouldBreak) flush();
        }
        flush();

        // Keep only the newest few chunks (like subtitles)
        const MAX_CHUNKS = 8;
        const recent = chunks.slice(-MAX_CHUNKS);

        // Append a pending block at bottom (EN only + VI ellipsis)
        let pendingEn = '';
        let pendingSpeaker = null;
        if (pendingOriginals.length > 0) {
            pendingEn = cleanJoin(pendingOriginals.slice(-2).map(s => s.original.trim()));
            pendingSpeaker = pendingOriginals[pendingOriginals.length - 1]?.speaker || null;
        } else if (this.provisionalText) {
            pendingEn = this.provisionalText.trim();
            pendingSpeaker = this.provisionalSpeaker || null;
        }

        let html = '';
        let lastRenderedSpeaker = null;

        for (const c of recent) {
            if (c.kind === 'chat') {
                html += `<div class="subtitle-chat me">
                    <div class="subtitle-chat-who">${this._esc(c.speaker || 'ME')}:</div>
                    <div class="subtitle-chat-text">${this._esc(c.en)}</div>
                </div>`;
                continue;
            }

            if (c.speaker && c.speaker !== lastRenderedSpeaker) {
                html += `<div class="subtitle-speaker">Speaker ${this._esc(c.speaker)}:</div>`;
                lastRenderedSpeaker = c.speaker;
            }
            html += `<div class="subtitle-pair">
                <div class="subtitle-top"><span class="subtitle-prefix">EN:</span> ${this._esc(c.en)}</div>
                <div class="subtitle-bottom"><span class="subtitle-prefix">VI:</span> ${this._esc(c.vi)}</div>
            </div>`;
        }

        if (pendingEn) {
            if (pendingSpeaker && pendingSpeaker !== lastRenderedSpeaker) {
                html += `<div class="subtitle-speaker">Speaker ${this._esc(pendingSpeaker)}:</div>`;
                lastRenderedSpeaker = pendingSpeaker;
            }
            html += `<div class="subtitle-pair pending">
                <div class="subtitle-top"><span class="subtitle-prefix">EN:</span> ${this._esc(pendingEn)}</div>
                <div class="subtitle-bottom"><span class="subtitle-prefix">VI:</span> …</div>
            </div>`;
        }

        this.contentEl.innerHTML = html;
        this._smartScroll(this.container.parentElement || this.container);
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
            html += `<div class="seg-block"><div class="seg-provisional">${this._esc(this.provisionalText)}</div></div>`;
        }

        this.contentEl.innerHTML = html;
        this._smartScroll(this.container.parentElement || this.container);
    }

    _renderDual() {
        // Save scroll state before re-render
        const oldSrcPanel = this.contentEl.querySelector('.panel-source .panel-body') || this.contentEl.querySelector('.panel-source');
        const oldTgtPanel = this.contentEl.querySelector('.panel-translation .panel-body') || this.contentEl.querySelector('.panel-translation');
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

        if (this.provisionalText) {
            srcHtml += `<div class="seg-text pending">${this._esc(this.provisionalText)}</div>`;
            tgtHtml += `<div class="seg-text pending">...</div>`;
        }

        this.contentEl.innerHTML = `
            <div class="panel-source">
              <div class="panel-header">English</div>
              <div class="panel-body">${srcHtml}</div>
            </div>
            <div class="panel-translation">
              <div class="panel-header">Vietnamese</div>
              <div class="panel-body">${tgtHtml}</div>
            </div>
        `;

        // Restore scroll: auto-scroll if was near bottom, otherwise keep position
        const srcPanel = this.contentEl.querySelector('.panel-source');
        const tgtPanel = this.contentEl.querySelector('.panel-translation');
        const srcBody = srcPanel?.querySelector('.panel-body');
        const tgtBody = tgtPanel?.querySelector('.panel-body');
        if (srcPanel) {
            if (srcScrollState.nearBottom) {
                if (srcBody) srcBody.scrollTop = srcBody.scrollHeight;
            } else {
                if (srcBody) srcBody.scrollTop = srcScrollState.scrollTop;
            }
        }
        if (tgtPanel) {
            if (tgtScrollState.nearBottom) {
                if (tgtBody) tgtBody.scrollTop = tgtBody.scrollHeight;
            } else {
                if (tgtBody) tgtBody.scrollTop = tgtScrollState.scrollTop;
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
