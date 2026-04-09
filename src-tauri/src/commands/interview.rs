use crate::db::{self, InterviewDb};
use crate::services::embeddings;
use crate::services::llm;
use crate::services::pinecone::{pinecone_vector_from_parts, query_top_k, upsert_vectors};
use crate::settings::SettingsState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

const INGEST_CHUNK_MAX_CHARS: usize = 1200;
const INGEST_CHUNK_OVERLAP_CHARS: usize = 150;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterviewFilePart {
    pub filename: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestInterviewFilesRequest {
    pub user_id: String,
    pub cv: Option<InterviewFilePart>,
    pub jd: Option<InterviewFilePart>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestInterviewFilesResponse {
    pub ok: bool,
    pub cv_doc_id: Option<String>,
    pub jd_doc_id: Option<String>,
    pub cv_chunks: usize,
    pub jd_chunks: usize,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveInterviewMessageRequest {
    pub user_id: String,
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestInterviewAnswersRequest {
    pub user_id: String,
    #[serde(default)]
    pub transcript_context: Option<String>,
    #[serde(default)]
    pub user_draft: Option<String>,
    #[serde(default)]
    pub debug: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InterviewSuggestionItem {
    pub id: u32,
    pub target: String,
    pub translation: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestInterviewAnswersResponse {
    pub suggestions: Vec<InterviewSuggestionItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debug: Option<String>,
}

fn extract_docx(data: &[u8]) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    use std::io::{Cursor, Read};
    use zip::ZipArchive;

    let cur = Cursor::new(data);
    let mut archive = ZipArchive::new(cur).map_err(|e| format!("docx zip: {e}"))?;
    let mut file = archive
        .by_name("word/document.xml")
        .map_err(|e| format!("docx missing document.xml: {e}"))?;
    let mut xml = String::new();
    file.read_to_string(&mut xml).map_err(|e| format!("docx read: {e}"))?;

    let mut reader = Reader::from_str(&xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut out = String::new();
    let mut wt_depth = 0i32;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                if e.name().as_ref() == b"w:t" {
                    wt_depth += 1;
                }
            }
            Ok(Event::End(ref e)) => {
                if e.name().as_ref() == b"w:t" {
                    wt_depth = (wt_depth - 1).max(0);
                }
            }
            Ok(Event::Text(ref t)) => {
                if wt_depth > 0 {
                    let s = t.unescape().map_err(|e| e.to_string())?;
                    out.push_str(&s);
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(e.to_string()),
            Ok(_) => {}
        }
        buf.clear();
    }

    Ok(out)
}

fn extract_pdf(data: &[u8]) -> Result<String, String> {
    pdf_extract::extract_text_from_mem(data).map_err(|e| format!("pdf: {e}"))
}

fn extract_file_text(filename: &str, bytes: &[u8]) -> Result<String, String> {
    let lower = filename.to_lowercase();
    let text = if lower.ends_with(".pdf") {
        extract_pdf(bytes)?
    } else if lower.ends_with(".docx") {
        extract_docx(bytes)?
    } else {
        return Err(format!("Unsupported file type: {filename}"));
    };
    Ok(text.trim().chars().take(200_000).collect::<String>())
}

/// Word-boundary chunks up to `max_chars` (byte length of joined words, matching OpenAI token-ish limits for ASCII-heavy CVs).
/// After each chunk except the last, the next chunk starts with a suffix of the previous chunk (up to `overlap` **characters**, word-aligned).
fn chunk_text_with_overlap(text: &str, max_chars: usize, overlap: usize) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    if max_chars == 0 {
        return Vec::new();
    }
    let overlap = overlap.min(max_chars.saturating_sub(1));

    fn overlap_suffix<'a>(s: &'a str, max_overlap_chars: usize) -> &'a str {
        if max_overlap_chars == 0 || s.is_empty() {
            return "";
        }
        let char_count = s.chars().count();
        if char_count <= max_overlap_chars {
            return s;
        }
        let skip = char_count - max_overlap_chars;
        let mut n = 0usize;
        let mut start_byte = 0usize;
        for (i, _) in s.char_indices() {
            if n >= skip {
                start_byte = i;
                break;
            }
            n += 1;
        }
        let tail = &s[start_byte..];
        match tail.find(' ') {
            Some(pos) if pos + 1 < tail.len() => &tail[pos + 1..],
            _ => tail,
        }
    }

    let words: Vec<&str> = text.split_whitespace().collect();
    let mut out = Vec::new();
    let mut word_idx = 0usize;
    let mut pending: Option<String> = None;

    while word_idx < words.len() || pending.is_some() {
        let mut cur = pending.take().unwrap_or_default();
        while word_idx < words.len() {
            let w = words[word_idx];
            let add = if cur.is_empty() { w.len() } else { w.len() + 1 };
            if cur.len() + add > max_chars && !cur.is_empty() {
                break;
            }
            if !cur.is_empty() {
                cur.push(' ');
            }
            cur.push_str(w);
            word_idx += 1;
        }
        if cur.is_empty() && word_idx < words.len() {
            cur.push_str(words[word_idx]);
            word_idx += 1;
        }
        let chunk = cur.trim().to_string();
        if chunk.is_empty() {
            break;
        }
        out.push(chunk.clone());
        if word_idx >= words.len() {
            break;
        }
        let suf = overlap_suffix(&chunk, overlap);
        if !suf.trim().is_empty() {
            pending = Some(suf.to_string());
        }
    }
    out
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

fn extract_json_array_slice(text: &str) -> Option<&str> {
    let start = text.find('[')?;
    let end = text.rfind(']')?;
    if end <= start {
        return None;
    }
    Some(&text[start..=end])
}

fn line_fallback_suggestion_strings(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.trim().trim_start_matches(|c| c == '-' || c == '•').trim().to_string())
        .filter(|l| !l.is_empty())
        .take(6)
        .collect()
}

#[derive(Deserialize)]
struct SuggestionBothRow {
    target: String,
    translation: String,
}

fn normalized_suggestion_type(raw: &str) -> &str {
    match raw {
        "target" | "translation" | "both" => raw,
        _ => "translation",
    }
}

fn parse_suggestions_from_llm(raw: &str, suggestion_type: &str) -> Vec<InterviewSuggestionItem> {
    let st = normalized_suggestion_type(suggestion_type);
    let Some(slice) = extract_json_array_slice(raw) else {
        return match st {
            "both" => line_fallback_suggestion_strings(raw)
                .into_iter()
                .enumerate()
                .map(|(i, s)| InterviewSuggestionItem {
                    id: i as u32,
                    target: s.clone(),
                    translation: s,
                })
                .collect(),
            "target" => line_fallback_suggestion_strings(raw)
                .into_iter()
                .enumerate()
                .map(|(i, s)| InterviewSuggestionItem {
                    id: i as u32,
                    target: s,
                    translation: String::new(),
                })
                .collect(),
            _ => line_fallback_suggestion_strings(raw)
                .into_iter()
                .enumerate()
                .map(|(i, s)| InterviewSuggestionItem {
                    id: i as u32,
                    target: String::new(),
                    translation: s,
                })
                .collect(),
        };
    };

    match st {
        "both" => serde_json::from_slice::<Vec<SuggestionBothRow>>(slice.as_bytes())
            .map(|rows| {
                rows.into_iter()
                    .enumerate()
                    .map(|(i, r)| InterviewSuggestionItem {
                        id: i as u32,
                        target: r.target,
                        translation: r.translation,
                    })
                    .collect()
            })
            .unwrap_or_else(|_| {
                serde_json::from_slice::<Vec<String>>(slice.as_bytes())
                    .unwrap_or_else(|_| line_fallback_suggestion_strings(raw))
                    .into_iter()
                    .enumerate()
                    .map(|(i, s)| InterviewSuggestionItem {
                        id: i as u32,
                        target: s.clone(),
                        translation: s,
                    })
                    .collect()
            }),
        "target" => serde_json::from_slice::<Vec<String>>(slice.as_bytes())
            .unwrap_or_else(|_| line_fallback_suggestion_strings(raw))
            .into_iter()
            .enumerate()
            .map(|(i, s)| InterviewSuggestionItem {
                id: i as u32,
                target: s,
                translation: String::new(),
            })
            .collect(),
        _ => serde_json::from_slice::<Vec<String>>(slice.as_bytes())
            .unwrap_or_else(|_| line_fallback_suggestion_strings(raw))
            .into_iter()
            .enumerate()
            .map(|(i, s)| InterviewSuggestionItem {
                id: i as u32,
                target: String::new(),
                translation: s,
            })
            .collect(),
    }
}

fn emit_progress(app: &AppHandle, doc_type: &str, stage: &str, current: usize, total: usize) {
    let _ = app.emit("ingest:progress", serde_json::json!({
        "docType": doc_type,
        "stage": stage,
        "current": current,
        "total": total,
    }));
}

fn ingest_one_doc(
    app: &AppHandle,
    conn: &rusqlite::Connection,
    client: &reqwest::blocking::Client,
    pinecone_host: &str,
    pine_key: &str,
    embeddings_url: &str,
    embeddings_key: &str,
    user_id: &str,
    doc_type: &str,
    part: InterviewFilePart,
    expected_dim: usize,
) -> Result<(String, usize), String> {
    emit_progress(app, doc_type, "extracting", 0, 1);
    let text = extract_file_text(&part.filename, &part.bytes)?;
    let doc_id = Uuid::new_v4().to_string();
    db::upsert_document(conn, &doc_id, user_id, doc_type, &part.filename, Some(&part.bytes), &text)?;

    fn normalize_whitespace_key(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        for w in s.split_whitespace() {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(w);
        }
        out
    }

    let chunks = chunk_text_with_overlap(&text, INGEST_CHUNK_MAX_CHARS, INGEST_CHUNK_OVERLAP_CHARS);

    // Dedupe chunks BEFORE embedding and Pinecone upsert to avoid storing duplicates.
    // Key: trim + normalize whitespace only (no lowercasing) to avoid accidental semantic merges.
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut unique_chunks: Vec<(usize, String)> = Vec::new(); // (original index, chunk text)
    for (i, ch) in chunks.into_iter().enumerate() {
        let key = normalize_whitespace_key(&ch);
        if seen.contains_key(&key) {
            continue;
        }
        seen.insert(key, i);
        unique_chunks.push((i, ch));
    }

    let total_chunks = unique_chunks.len();
    emit_progress(app, doc_type, "embedding", 0, total_chunks);
    let mut all_vectors = Vec::with_capacity(total_chunks);
    let max = embeddings::OPENAI_EMBEDDINGS_MAX_INPUTS;
    for batch_start in (0..unique_chunks.len()).step_by(max) {
        let batch_end = (batch_start + max).min(unique_chunks.len());
        let batch: Vec<String> = unique_chunks[batch_start..batch_end]
            .iter()
            .map(|(_, ch)| ch.clone())
            .collect();
        let (vecs, dim) = embeddings::embed_batch_prefer_openai(client, embeddings_url, embeddings_key, &batch, Some(expected_dim))?;
        emit_progress(app, doc_type, "embedding", batch_end, total_chunks);
        if dim != expected_dim {
            return Err(format!(
                "Embedding dimension is {dim} but Settings expects {expected_dim}. Set pinecone_vector_dimension to {dim} or use matching embeddings (1536 OpenAI / 768 Gemini)."
            ));
        }
        if vecs.len() != batch.len() {
            return Err(format!(
                "Batch embedding returned {} vectors for {} chunks — API response mismatch.",
                vecs.len(),
                batch.len()
            ));
        }
        for (j, v) in vecs.into_iter().enumerate() {
            let idx = batch_start + j;
            let (orig_i, ch) = &unique_chunks[idx];
            let ref_id = format!("{doc_id}#{orig_i}");
            let pid = format!("{user_id}_{doc_id}_{orig_i}");
            all_vectors.push(pinecone_vector_from_parts(
                pid,
                v,
                user_id,
                "doc_chunk",
                &ref_id,
                Some(doc_type),
                ch,
            ));
        }
    }
    emit_progress(app, doc_type, "upserting", 0, 1);
    upsert_vectors(client, pinecone_host, pine_key, Some(user_id), all_vectors)?;
    emit_progress(app, doc_type, "done", total_chunks, total_chunks);
    Ok((doc_id, total_chunks))
}

#[tauri::command]
pub fn ingest_interview_files(
    app: AppHandle,
    db: State<'_, InterviewDb>,
    settings: State<'_, SettingsState>,
    mut req: IngestInterviewFilesRequest,
) -> Result<IngestInterviewFilesResponse, String> {
    if req.cv.is_none() && req.jd.is_none() {
        return Err("No files to ingest".to_string());
    }

    let (pinecone_host, expected_dim, pine_key, llm_url, llm_api_key) = {
        let g = settings.0.lock().map_err(|e| e.to_string())?;
        (g.pinecone_host.clone(), g.pinecone_vector_dimension as usize, g.pinecone_api_key.clone(), g.llm_url.clone(), g.llm_api_key.clone())
    };
    if pinecone_host.trim().is_empty() {
        return Err("Pinecone host is empty — fill it in Settings → AI.".to_string());
    }
    if pine_key.trim().is_empty() {
        return Err("Pinecone API key not set — add it in Settings → AI.".to_string());
    }
    if llm_api_key.trim().is_empty() {
        return Err("LLM API key not set — add it in Settings → AI.".to_string());
    }
    let embeddings_url = embeddings::embeddings_url_from_llm_url(&llm_url);

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let client = http_client()?;

    let mut cv_doc = None;
    let mut jd_doc = None;
    let mut cv_chunks = 0usize;
    let mut jd_chunks = 0usize;

    if let Some(cv) = req.cv.take() {
        let (id, n) = ingest_one_doc(
            &app,
            &conn,
            &client,
            &pinecone_host,
            &pine_key,
            &embeddings_url,
            &llm_api_key,
            &req.user_id,
            "cv",
            cv,
            expected_dim,
        )?;
        cv_doc = Some(id);
        cv_chunks = n;
    }
    if let Some(jd) = req.jd.take() {
        let (id, n) = ingest_one_doc(
            &app,
            &conn,
            &client,
            &pinecone_host,
            &pine_key,
            &embeddings_url,
            &llm_api_key,
            &req.user_id,
            "jd",
            jd,
            expected_dim,
        )?;
        jd_doc = Some(id);
        jd_chunks = n;
    }

    Ok(IngestInterviewFilesResponse {
        ok: true,
        cv_doc_id: cv_doc,
        jd_doc_id: jd_doc,
        cv_chunks,
        jd_chunks,
        message: format!("Indexed CV ({cv_chunks} chunks), JD ({jd_chunks} chunks)."),
    })
}

#[tauri::command]
pub fn save_interview_message(
    db: State<'_, InterviewDb>,
    req: SaveInterviewMessageRequest,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::insert_message(&conn, &req.user_id, &req.role, &req.content)?;
    Ok(())
}

#[tauri::command]
pub fn suggest_interview_answers(
    db: State<'_, InterviewDb>,
    settings: State<'_, SettingsState>,
    req: SuggestInterviewAnswersRequest,
) -> Result<SuggestInterviewAnswersResponse, String> {
    let (
        pinecone_host,
        expected_dim,
        llm_url,
        llm_model,
        source_language,
        target_language,
        suggestion_type,
        llm_key,
        pine_key,
    ) = {
        let g = settings.0.lock().map_err(|e| e.to_string())?;
        (
            g.pinecone_host.clone(),
            g.pinecone_vector_dimension as usize,
            g.llm_url.clone(),
            g.llm_model.clone(),
            g.source_language.clone(),
            g.target_language.clone(),
            g.suggestion_type.clone(),
            g.llm_api_key.clone(),
            g.pinecone_api_key.clone(),
        )
    };
    if llm_url.trim().is_empty() {
        return Err("LLM URL not configured — fill it in Settings → AI.".to_string());
    }
    if llm_model.trim().is_empty() {
        return Err("LLM model not configured — fill it in Settings → AI.".to_string());
    }
    if llm_key.trim().is_empty() {
        return Err("LLM API key not set — add it in Settings → AI.".to_string());
    }
    if pine_key.trim().is_empty() {
        return Err("Pinecone API key not set — add it in Settings → AI.".to_string());
    }

    let db_path = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn
            .path()
            .map(PathBuf::from)
            .ok_or_else(|| "SQLite path unavailable".to_string())?
    };

    let uid = req.user_id.clone();
    let (recent, summary_opt) = std::thread::scope(|s| {
        let path_a = db_path.clone();
        let path_b = db_path;
        let uid_a = uid.clone();
        let uid_b = uid;
        let h1 = s.spawn(move || {
            let c = rusqlite::Connection::open(&path_a).map_err(|e| e.to_string())?;
            db::recent_messages(&c, &uid_a, 6)
        });
        let h2 = s.spawn(move || {
            let c = rusqlite::Connection::open(&path_b).map_err(|e| e.to_string())?;
            db::get_summary(&c, &uid_b)
        });
        (h1.join().unwrap(), h2.join().unwrap())
    });
    let recent = recent?;
    let summary = summary_opt?.unwrap_or_default();

    if pinecone_host.trim().is_empty() {
        return Err("Pinecone host not configured.".to_string());
    }

    let client = http_client()?;

    let mut query_bits: Vec<String> = Vec::new();
    if let Some(ref t) = req.transcript_context {
        if !t.trim().is_empty() {
            query_bits.push(format!("Latest interviewer / dialogue line:\n{t}"));
        }
    }
    if let Some(ref d) = req.user_draft {
        if !d.trim().is_empty() {
            query_bits.push(format!("Candidate draft or notes:\n{d}"));
        }
    }
    let query_text = if query_bits.is_empty() {
        "General interview coaching for the next reply.".to_string()
    } else {
        query_bits.join("\n\n")
    };

    let emb_url = embeddings::embeddings_url_from_llm_url(&llm_url);
    let (query_vec, qdim) = embeddings::embed_batch_prefer_openai(&client, &emb_url, &llm_key, &[query_text.clone()], Some(expected_dim))?;
    if qdim != expected_dim {
        return Err(format!(
            "Embedding dimension mismatch: got {qdim}, settings {expected_dim}."
        ));
    }
    let qv = query_vec.into_iter().next().ok_or("no query vector")?;

    let matches = query_top_k(
        &client,
        &pinecone_host,
        &pine_key,
        Some(&req.user_id),
        qv,
        4,
    )?;

    let mut context_snips: Vec<String> = Vec::new();
    for m in &matches {
        if let Some(meta) = &m.metadata {
            if let Some(serde_json::Value::String(s)) = meta.get("content") {
                if !s.trim().is_empty() {
                    context_snips.push(s.clone());
                }
            }
        }
    }

    let mut recent_lines = String::new();
    for (role, content, _) in recent {
        recent_lines.push_str(&format!("- [{role}] {content}\n"));
    }

    let ctx_block = context_snips.join("\n---\n");
    let st = normalized_suggestion_type(&suggestion_type);
    let return_format = match st {
        "both" => format!(
            "Return ONLY a JSON array with exactly 1 object. The object must have exactly two string keys: \"target\" and \"translation\".\n\
The \"target\" value must be the answer in the source/interview language (settings code: {src}).\n\
The \"translation\" value must be the same answer meaning in the translation language (settings code: {tgt}).\n\
Example: [{{\"target\":\"Hello\",\"translation\":\"Xin chào\"}}]\n\
No markdown fences, no extra text — ONLY the JSON array.",
            src = source_language,
            tgt = target_language,
        ),
        "target" => format!(
            "Return ONLY a JSON array with exactly 1 string. The string must be an answer option entirely in the source/interview language (settings code: {src}).\n\
Example: [\"option one\"]\n\
No markdown fences, no extra text — ONLY the JSON array.",
            src = source_language,
        ),
        _ => format!(
            "Return ONLY a JSON array with exactly 1 string. The string must be an answer option entirely in the translation language (settings code: {tgt}).\n\
Example: [\"option one\"]\n\
No markdown fences, no extra text — ONLY the JSON array.",
            tgt = target_language,
        ),
    };

    let prompt = format!(
        "You are the candidate — a senior software engineer. Speak in first person as if you are answering the interviewer directly.\n\
Use the CV/JD snippets below to ground your answer in the candidate's real experience: specific technologies, projects, and patterns they have worked with.\n\
Make the answer technical and concrete (mention design patterns, frameworks, real examples from the CV), not generic theory.\n\
Keep it concise, spoken tone, under ~80 words.\n\n\
{return_format}\n\n\
Session summary (may be empty):\n\
{summary}\n\n\
Recent messages / transcript:\n\
{recent_lines}\n\n\
Candidate CV/JD knowledge (use this to make the answer personal and technical):\n\
{ctx_block}\n\n\
Interviewer's question / task focus:\n\
{query_text}\n",
        return_format = return_format,
        summary = summary,
        recent_lines = recent_lines,
        ctx_block = ctx_block,
        query_text = query_text,
    );

    let raw = llm::complete_suggestions(&client, &llm_url, &llm_key, &llm_model, &prompt)?;
    let suggestions = parse_suggestions_from_llm(&raw, st);

    let debug = if req.debug == Some(true) {
        Some(format!(
            "pinecone_matches={}, llm_model={}, prompt_chars={}",
            matches.len(),
            llm_model,
            prompt.len()
        ))
    } else {
        None
    };

    Ok(SuggestInterviewAnswersResponse { suggestions, debug })
}
