// SessionStore — single source of truth for the current translation session.
//
// Lifecycle: app launch → init() → beginChunk() / addSegment() / endChunk()
// (repeatable across many Start/Stop cycles) → endSession() on Stop or app close.
// Persists both .md (human-readable) + .json (structured) via the Rust
// `save_session` Tauri command: on every endChunk, on endSession, and on a
// ~15s autosave cadence while recording so a crash/force-quit loses at most one
// autosave interval instead of the whole live chunk.

const { invoke } = window.__TAURI__.core;

const AUTOSAVE_MS = 15000;

export class SessionStore {
    constructor() {
        this.id = null;
        this.createdAt = null;
        this.endedAt = null;
        this.title = '';
        this.engine = null;            // 'openai' | 'soniox' | 'local'
        this.sourceLang = '';
        this.targetLang = '';
        this.chunks = [];
        this.currentChunk = null;
        // Dirty tracking via a monotonic mutation counter: the store is "dirty"
        // whenever _mutations !== _persistedMutations. A segment arriving while a
        // persist is in flight bumps _mutations past the captured generation, so
        // the next persist re-runs instead of dropping the update.
        this._mutations = 0;
        this._persistedMutations = 0;
        // Single-flight: persist() calls chain here so two save_session invokes
        // for this session never overlap the shared deterministic .tmp path.
        this._persistChain = Promise.resolve();
        this._lastPersistAt = 0;
        this._autosaveTimer = null;
    }

    init({ engine, sourceLang, targetLang } = {}) {
        this._cancelAutosave();
        this.id = this._generateId();
        this.createdAt = new Date().toISOString();
        this.endedAt = null;
        this.title = '';
        this.engine = engine || null;
        this.sourceLang = sourceLang || '';
        this.targetLang = targetLang || '';
        this.chunks = [];
        this.currentChunk = null;
        this._mutations = 0;
        this._persistedMutations = 0;
        this._persistChain = Promise.resolve();
        this._lastPersistAt = Date.now();
    }

    static async resume(id) {
        const result = await invoke('read_session', { id });
        const s = new SessionStore();
        const j = result.json;
        s.id = j.id;
        s.createdAt = j.created_at;
        s.endedAt = j.ended_at;
        s.title = j.title || '';
        s.engine = j.engine || null;
        s.sourceLang = j.source_lang || '';
        s.targetLang = j.target_lang || '';
        s.chunks = j.chunks || [];
        s.currentChunk = null;
        return s;
    }

    beginChunk({ engine, sourceLang, targetLang } = {}) {
        if (engine) this.engine = engine;
        if (sourceLang) this.sourceLang = sourceLang;
        if (targetLang) this.targetLang = targetLang;
        this.currentChunk = {
            started_at: new Date().toISOString(),
            ended_at: null,
            segments: [],
        };
    }

    addSegment(src, tgt) {
        if (!this.currentChunk) {
            this.beginChunk();
        }
        this.currentChunk.segments.push({
            ts: this._timeStr(new Date()),
            src: src || '',
            tgt: tgt || '',
        });
        this._mutations++;
        this._scheduleAutosave();
    }

    endChunk() {
        this._cancelAutosave();
        if (!this.currentChunk) return;
        this.currentChunk.ended_at = new Date().toISOString();
        if (this.currentChunk.segments.length > 0) {
            this.chunks.push(this.currentChunk);
            // Closing a non-empty chunk sets its ended_at — a real state change
            // that must reach disk even if autosave already flushed the segments.
            this._mutations++;
        }
        this.currentChunk = null;
    }

    // Public persist entry point. Serializes concurrent calls through a chain so
    // two save_session invokes never overlap. Returns 'saved' | 'skipped' | 'failed'.
    persist() {
        const link = this._persistChain.then(() => this._persistNow());
        this._persistChain = link.catch(() => {});
        return link;
    }

    async _persistNow() {
        if (this._mutations === this._persistedMutations || this.totalSegmentCount() === 0) {
            return 'skipped';
        }
        const gen = this._mutations;
        if (!this.title) this.title = this._autoTitle();
        const json = this._toJson();
        const md = this._toMarkdown();
        try {
            await invoke('save_session', {
                id: this.id,
                mdContent: md,
                jsonData: json,
            });
            this._persistedMutations = gen;
            this._lastPersistAt = Date.now();
            return 'saved';
        } catch (err) {
            console.error('[SessionStore] persist failed:', err);
            return 'failed';
        }
    }

    async endSession() {
        this.endChunk();
        this.endedAt = new Date().toISOString();
        this._mutations++;
        return await this.persist();
    }

    async setTitle(newTitle) {
        const t = (newTitle || '').trim().slice(0, 200);
        this.title = t;
        try {
            await invoke('update_session_title', { id: this.id, title: t });
        } catch (err) {
            console.error('[SessionStore] update_session_title failed:', err);
        }
    }

    isEmpty() {
        const chunkSegs = this.chunks.reduce((n, c) => n + c.segments.length, 0);
        const liveSegs = this.currentChunk?.segments.length || 0;
        return chunkSegs + liveSegs === 0;
    }

    totalSegmentCount() {
        const finished = this.chunks.reduce((n, c) => n + c.segments.length, 0);
        const live = this.currentChunk?.segments.length || 0;
        return finished + live;
    }

    // ─── Internals ─────────────────────────────────────────────────

    // All chunks that should be serialized, including the still-open live chunk
    // (kept ended_at: null) when it has segments. Never mutates this.chunks.
    _allChunks() {
        if (this.currentChunk && this.currentChunk.segments.length > 0) {
            return [...this.chunks, this.currentChunk];
        }
        return this.chunks;
    }

    _scheduleAutosave() {
        const elapsed = Date.now() - this._lastPersistAt;
        if (elapsed >= AUTOSAVE_MS) {
            // Fire-and-forget: don't await inside the transcription callback path.
            this.persist();
        } else if (!this._autosaveTimer) {
            // Elapsed-time trigger (not a fixed interval) stays bounded even when
            // WKWebView throttles timers on a minimized window, as long as
            // segments keep arriving to re-evaluate the elapsed check.
            this._autosaveTimer = setTimeout(() => {
                this._autosaveTimer = null;
                this.persist();
            }, AUTOSAVE_MS - elapsed);
        }
    }

    _cancelAutosave() {
        if (this._autosaveTimer) {
            clearTimeout(this._autosaveTimer);
            this._autosaveTimer = null;
        }
    }

    _generateId() {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    }

    _timeStr(d) {
        const p = n => String(n).padStart(2, '0');
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }

    _autoTitle() {
        for (const chunk of this._allChunks()) {
            for (const seg of chunk.segments) {
                if (seg.tgt && seg.tgt.trim()) {
                    return seg.tgt.trim().split(/\s+/).slice(0, 7).join(' ').slice(0, 80);
                }
            }
        }
        return 'Untitled session';
    }

    // End time of an open (ended_at: null) chunk, derived from its last segment's
    // HH:MM:SS stamp anchored to the chunk's start date. Lets a crashed file list
    // a sane duration instead of 0.
    _lastSegmentEndTime(c) {
        const seg = c.segments[c.segments.length - 1];
        if (!seg || !seg.ts) return 0;
        const [h, m, s] = seg.ts.split(':').map(Number);
        const end = new Date(c.started_at);
        end.setHours(h, m, s, 0);
        return end.getTime();
    }

    _totalDurationSec() {
        let total = 0;
        for (const c of this._allChunks()) {
            if (!c.started_at) continue;
            const start = new Date(c.started_at).getTime();
            let end;
            if (c.ended_at) {
                end = new Date(c.ended_at).getTime();
            } else {
                if (!c.segments || c.segments.length === 0) continue;
                end = this._lastSegmentEndTime(c);
            }
            if (end > start) total += Math.floor((end - start) / 1000);
        }
        return total;
    }

    _toJson() {
        return {
            id: this.id,
            created_at: this.createdAt,
            ended_at: this.endedAt,
            title: this.title || this._autoTitle(),
            engine: this.engine || 'unknown',
            source_lang: this.sourceLang || '',
            target_lang: this.targetLang || '',
            duration_sec: this._totalDurationSec(),
            chunks: this._allChunks(),
        };
    }

    _formatDateTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    _formatDuration(sec) {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    _toMarkdown() {
        const lines = [];
        const title = this.title || this._autoTitle();
        const dur = this._formatDuration(this._totalDurationSec());
        const langPair = (this.sourceLang || '?') + ' → ' + (this.targetLang || '?');

        lines.push(`# ${title}`);
        lines.push('');
        lines.push(`**Engine**: ${this.engine || 'unknown'} · ${langPair} · ${this._formatDateTime(this.createdAt)} · ${dur}`);
        lines.push('');

        const all = this._allChunks();
        for (let i = 0; i < all.length; i++) {
            const chunk = all[i];
            if (i > 0) {
                const prevEnd = new Date(all[i - 1].ended_at).getTime();
                const curStart = new Date(chunk.started_at).getTime();
                const gapMin = Math.max(0, Math.round((curStart - prevEnd) / 60000));
                const startStr = this._formatDateTime(chunk.started_at).slice(11);
                lines.push('');
                lines.push(`──── resumed at ${startStr} (after ${gapMin}m) ────`);
                lines.push('');
            }
            const startStr = this._formatDateTime(chunk.started_at).slice(11);
            const endStr = chunk.ended_at ? this._formatDateTime(chunk.ended_at).slice(11) : '...';
            lines.push(`## Chunk ${i + 1} — ${startStr} – ${endStr}`);
            lines.push('');
            for (const seg of chunk.segments) {
                if (seg.src) {
                    lines.push(`[${seg.ts}] ${seg.src}`);
                    lines.push(`→ ${seg.tgt}`);
                } else {
                    lines.push(`[${seg.ts}] ${seg.tgt}`);
                }
                lines.push('');
            }
        }
        return lines.join('\n');
    }
}

export const sessionStore = new SessionStore();
