#!/usr/bin/env python3
"""
Local translation pipeline sidecar for MyJavis.
Receives PCM audio via stdin, transcribes with Whisper, translates with Qwen2.5 LLM.
Outputs JSON results via stdout.

Protocol:
  stdin  → raw PCM s16le 16kHz mono bytes (continuous stream)
  stdout → JSON lines: {"type": "result", "original": "...", "translated": "...", "lang": "..."}
  stderr → log messages

Usage:
  python3 local_pipeline.py --asr-model whisper --source-lang ja --target-lang vi
"""

import sys
import os
import json
import time
import wave
import tempfile
import threading
import numpy as np

# Suppress warnings
os.environ["TOKENIZERS_PARALLELISM"] = "false"


def log(msg):
    """Log to stderr so it doesn't interfere with stdout protocol."""
    print(f"[pipeline] {msg}", file=sys.stderr, flush=True)


def emit(data):
    """Send JSON to stdout."""
    print(json.dumps(data, ensure_ascii=False), flush=True)


# Language display names for translation prompt
LANG_NAMES = {
    "vi": "Vietnamese", "en": "English", "ja": "Japanese",
    "ko": "Korean", "zh": "Chinese", "fr": "French",
    "de": "German", "es": "Spanish", "th": "Thai",
}


class LocalPipeline:
    def __init__(
        self,
        asr_model="whisper",
        source_lang="ja",
        target_lang="vi",
        chunk_seconds=7,
        stride_seconds=5,
    ):
        self.asr_model_type = asr_model  # "whisper" or "qwen"
        self.source_lang = source_lang
        self.target_lang = target_lang
        self.target_lang_name = LANG_NAMES.get(target_lang, "Vietnamese")
        self.chunk_seconds = chunk_seconds
        self.stride_seconds = stride_seconds
        self.sample_rate = 16000
        self.bytes_per_sample = 2  # s16le

        # Audio buffer
        self.audio_buffer = bytearray()
        self.lock = threading.Lock()
        self.running = True

        # Chunk size in bytes
        self.chunk_bytes = self.chunk_seconds * self.sample_rate * self.bytes_per_sample
        self.stride_bytes = self.stride_seconds * self.sample_rate * self.bytes_per_sample

        # Previous transcription to detect new text
        self.prev_text = ""

        # Rolling context for translation continuity (like Soniox)
        self.context_history = []  # list of (original, translated) tuples
        self.max_context = 5  # keep last N translations for context

        # Model references (only loaded ones)
        self.asr_model = None
        self.llm_model = None
        self.llm_tokenizer = None

        self._load_models()

    def _load_models(self):
        """Load ASR + LLM translator."""

        # --- ASR Model ---
        if self.asr_model_type == "whisper":
            log("Loading Whisper-large-v3-turbo (MLX)...")
            emit({"type": "status", "message": "Loading Whisper-large-v3-turbo..."})
            t = time.time()
            import mlx_whisper
            import numpy as np
            # Pre-load by running a tiny transcription (numpy array to bypass ffmpeg)
            dummy_audio = np.zeros(1600, dtype=np.float32)  # 0.1s silence
            mlx_whisper.transcribe(
                dummy_audio,
                path_or_hf_repo="mlx-community/whisper-large-v3-turbo",
                language="ja",
            )
            self.asr_model = "mlx-community/whisper-large-v3-turbo"
            log(f"Whisper loaded in {time.time()-t:.1f}s")
        elif self.asr_model_type == "qwen":
            log("Loading Qwen3-ASR-0.6B...")
            emit({"type": "status", "message": "Loading Qwen3-ASR-0.6B..."})
            t = time.time()
            from mlx_audio.stt import load_model
            self.asr_model = load_model("Qwen/Qwen3-ASR-0.6B")
            log(f"Qwen ASR loaded in {time.time()-t:.1f}s")
        else:
            raise ValueError(f"Unknown ASR model: {self.asr_model_type}")

        # --- LLM Translator ---
        log("Loading Gemma-3-4B translator...")
        emit({"type": "status", "message": "Loading Gemma-3-4B translator..."})
        t = time.time()
        from mlx_lm import load
        self.llm_model, self.llm_tokenizer = load("mlx-community/gemma-3-4b-it-qat-4bit")
        log(f"LLM loaded in {time.time()-t:.1f}s")

        # Warm up LLM
        log("Warming up LLM...")
        emit({"type": "status", "message": "Warming up translator..."})
        self._translate("テスト")

        log("Pipeline ready!")
        emit({"type": "ready"})

    def _save_chunk_as_wav(self, pcm_bytes):
        """Save PCM bytes as temporary WAV file."""
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        with wave.open(tmp.name, "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self.sample_rate)
            wf.writeframes(pcm_bytes)
        return tmp.name

    def _transcribe(self, wav_path):
        """Transcribe audio using selected ASR model."""
        if self.asr_model_type == "whisper":
            import mlx_whisper
            import numpy as np
            # Load WAV as float32 numpy array (bypass ffmpeg)
            with wave.open(wav_path, "r") as wf:
                raw = wf.readframes(wf.getnframes())
                audio_np = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            result = mlx_whisper.transcribe(
                audio_np,
                path_or_hf_repo=self.asr_model,
                language=self._whisper_lang_code(),
                task="transcribe",
            )
            text = result.get("text", "").strip()
            lang = result.get("language", self.source_lang)
            return text, lang
        else:
            # Qwen3-ASR
            from mlx_audio.stt.generate import generate_transcription
            result = generate_transcription(
                model=self.asr_model,
                audio=wav_path,
                format="json",
                output_path="/tmp/_pipeline_asr",
            )
            return result.text.strip(), result.language

    def _whisper_lang_code(self):
        """Map source_lang to Whisper language code."""
        lang_map = {
            "Japanese": "ja", "ja": "ja",
            "English": "en", "en": "en",
            "Chinese": "zh", "zh": "zh",
            "Korean": "ko", "ko": "ko",
            "Vietnamese": "vi", "vi": "vi",
            "auto": None,
        }
        return lang_map.get(self.source_lang, "ja")

    def _translate(self, text):
        """Translate text using Gemma-3 LLM with rolling context."""
        if not text:
            return ""
        from mlx_lm import generate

        # Build context: only JA originals (no translations to avoid copying)
        context_block = ""
        if self.context_history:
            recent = self.context_history[-self.max_context:]
            ctx_ja = " / ".join(orig for orig, _ in recent)
            context_block = (
                f"[Topic context: {ctx_ja}]\n\n"
            )

        prompt = (
            "<start_of_turn>user\n"
            f"Translate this ONE Japanese sentence to {self.target_lang_name}.\n"
            f"Output ONLY the {self.target_lang_name} translation of the LAST line. Do NOT repeat previous content.\n"
            "\n"
            "Examples:\n"
            "JA: こんにちは、マイです。→ Xin chào, tôi là Mai.\n"
            "JA: おでんを作って食べました。→ Tôi đã làm oden ăn.\n"
            "JA: えっ？コンビニにおでん？→ Hả? Oden ở cửa hàng tiện lợi á?\n"
            "\n"
            "Rules: Vietnamese only. Keep names (マイ=Mai). Keep food (おでん=oden). ONE sentence output only.\n"
            "\n"
            f"{context_block}"
            f"Translate: {text}\n"
            "<end_of_turn>\n"
            "<start_of_turn>model\n"
        )

        result = generate(
            self.llm_model,
            self.llm_tokenizer,
            prompt=prompt,
            max_tokens=100,  # Shorter — only 1 sentence needed
        )

        # Post-process: clean up LLM output
        result = self._clean_translation(result)

        # Dedup: remove overlap with previous translation
        if result and self.context_history:
            last_trans = self.context_history[-1][1]
            result = self._remove_overlap(result, last_trans)

        # Add to context history
        if result:
            self.context_history.append((text, result))
            if len(self.context_history) > self.max_context * 2:
                self.context_history = self.context_history[-self.max_context:]

        return result

    def _clean_translation(self, text):
        """Remove special tokens and truncate at hallucination."""
        import re
        # Remove Gemma special tokens
        text = text.split('<end_of_turn>')[0]
        text = re.sub(r'<[^>]+>', '', text)
        # Take only the first meaningful line
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        text = lines[0] if lines else ''
        # Remove any prefix artifacts
        text = re.sub(r'^(VI:\s*|→\s*|Translate:\s*)', '', text)
        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def _remove_overlap(self, new_text, prev_text):
        """Remove text from new_text that overlaps with prev_text."""
        if not prev_text or not new_text:
            return new_text
        # Check if new_text starts with a significant chunk of prev_text
        words_new = new_text.split()
        words_prev = prev_text.split()
        if len(words_prev) < 3 or len(words_new) < 3:
            return new_text
        # Find longest prefix overlap
        max_overlap = min(len(words_new), len(words_prev))
        overlap_len = 0
        for i in range(3, max_overlap + 1):
            suffix = ' '.join(words_prev[-i:])
            prefix = ' '.join(words_new[:i])
            if suffix.lower() == prefix.lower():
                overlap_len = i
        if overlap_len >= 3:
            return ' '.join(words_new[overlap_len:]).strip()
        return new_text

    def _dedup_transcript(self, text):
        """Remove overlapping text from previous transcript chunk."""
        if not self.prev_text or not text:
            return text
        
        prev = self.prev_text
        # Find longest suffix of prev_text that matches a prefix of text
        # Use character-level matching for Japanese (no spaces between words)
        best_overlap = 0
        min_overlap = 3  # At least 3 chars to count as overlap
        max_check = min(len(prev), len(text), 100)  # Don't check too far
        
        for length in range(min_overlap, max_check + 1):
            if prev[-length:] == text[:length]:
                best_overlap = length
        
        if best_overlap >= min_overlap:
            new_text = text[best_overlap:].strip()
            return new_text if new_text else text
        
        return text

    def _process_chunk(self, pcm_bytes):
        """Process one audio chunk: transcribe → emit original → translate → emit translation."""
        t_start = time.time()

        # Check if audio has actual content (not silence)
        samples = np.frombuffer(pcm_bytes, dtype=np.int16)
        rms = np.sqrt(np.mean(samples.astype(np.float32) ** 2))
        if rms < 100:  # Silence threshold
            return

        # Save as WAV
        wav_path = self._save_chunk_as_wav(pcm_bytes)

        try:
            # Step 1: Transcribe
            t1 = time.time()
            text, lang = self._transcribe(wav_path)
            t_asr = time.time() - t1

            if not text or text == self.prev_text:
                return

            # Dedup transcript: strip overlap with previous chunk
            new_text = self._dedup_transcript(text)
            if not new_text or len(new_text) < 3:
                self.prev_text = text
                return

            log(f"Transcript: {text}")
            log(f"New text:   {new_text}")

            # Translate
            t2 = time.time()
            translated = self._translate(new_text)
            t_llm = time.time() - t2

            total = time.time() - t_start
            log(f"ASR={t_asr:.2f}s LLM={t_llm:.2f}s total={total:.2f}s")

            # Emit combined result
            emit({
                "type": "result",
                "original": new_text,
                "translated": translated,
                "language": lang if isinstance(lang, str) else (lang[0] if lang else "ja"),
                "timing": {
                    "asr": round(t_asr, 2),
                    "translate": round(t_llm, 2),
                    "total": round(total, 2),
                },
            })

            self.prev_text = text  # Store FULL text for next dedup

        finally:
            os.unlink(wav_path)

    def stdin_reader(self):
        """Read PCM bytes from stdin into buffer."""
        try:
            while self.running:
                data = sys.stdin.buffer.read(4096)
                if not data:
                    break
                with self.lock:
                    self.audio_buffer.extend(data)
        except Exception as e:
            log(f"stdin reader error: {e}")
        finally:
            self.running = False

    def run(self):
        """Main loop: read audio, process chunks with sliding window."""
        # Start stdin reader thread
        reader = threading.Thread(target=self.stdin_reader, daemon=True)
        reader.start()

        processed_pos = 0  # Track how far we've processed

        while self.running:
            time.sleep(0.5)  # Check every 500ms

            with self.lock:
                buf_len = len(self.audio_buffer)

            # When we have enough data for a chunk
            if buf_len - processed_pos >= self.chunk_bytes:
                with self.lock:
                    chunk = bytes(self.audio_buffer[processed_pos : processed_pos + self.chunk_bytes])

                self._process_chunk(chunk)
                processed_pos += self.stride_bytes

        # Process remaining audio
        with self.lock:
            remaining = len(self.audio_buffer) - processed_pos
            if remaining > self.sample_rate * self.bytes_per_sample:  # At least 1 second
                chunk = bytes(self.audio_buffer[processed_pos:])
                self._process_chunk(chunk)

        emit({"type": "done"})
        log("Pipeline stopped.")


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Local translation pipeline")
    parser.add_argument("--asr-model", default="whisper", choices=["whisper", "qwen"],
                        help="ASR model: 'whisper' (large-v3-turbo) or 'qwen' (Qwen3-ASR-0.6B)")
    parser.add_argument("--source-lang", default="ja", help="Source language")
    parser.add_argument("--target-lang", default="vi", help="Target language code (vi, en, etc.)")
    parser.add_argument("--chunk-seconds", type=int, default=7, help="Audio chunk size in seconds")
    parser.add_argument("--stride-seconds", type=int, default=5, help="Stride between chunks in seconds")
    parser.add_argument("--test", action="store_true", help="Run test with sample audio file")
    parser.add_argument("--test-file", default="/tmp/test_japanese.wav", help="Test audio file")
    args = parser.parse_args()

    if args.test:
        # Test mode: process a file directly
        pipeline = LocalPipeline(
            asr_model=args.asr_model,
            source_lang=args.source_lang,
            target_lang=args.target_lang,
            chunk_seconds=args.chunk_seconds,
            stride_seconds=args.stride_seconds,
        )

        log(f"Test mode: processing {args.test_file}")
        with wave.open(args.test_file, "r") as wf:
            pcm = wf.readframes(wf.getnframes())

        # Simulate streaming: feed chunks
        chunk_bytes = args.chunk_seconds * 16000 * 2
        stride_bytes = args.stride_seconds * 16000 * 2
        pos = 0
        while pos + chunk_bytes <= len(pcm):
            chunk = pcm[pos : pos + chunk_bytes]
            pipeline._process_chunk(chunk)
            pos += stride_bytes

        # Remaining
        if pos < len(pcm) and len(pcm) - pos > 16000 * 2:
            pipeline._process_chunk(pcm[pos:])

        emit({"type": "done"})
    else:
        # Normal mode: read from stdin
        pipeline = LocalPipeline(
            asr_model=args.asr_model,
            source_lang=args.source_lang,
            target_lang=args.target_lang,
            chunk_seconds=args.chunk_seconds,
            stride_seconds=args.stride_seconds,
        )
        pipeline.run()


if __name__ == "__main__":
    main()
