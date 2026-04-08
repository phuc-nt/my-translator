use crate::db::{self, InterviewDb};
use crate::secrets::{SecretSlot, get_secret};
use crate::services::embeddings;
use crate::services::llm::{self, LlmProvider};
use crate::services::pinecone::{pinecone_vector_from_parts, query_top_k, upsert_vectors};
use crate::settings::SettingsState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tauri::State;
use uuid::Uuid;

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestInterviewAnswersResponse {
    pub suggestions: Vec<String>,
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

fn chunk_text(text: &str, max_chars: usize) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut cur = String::new();
    for word in text.split_whitespace() {
        let add = if cur.is_empty() { word.len() } else { word.len() + 1 };
        if cur.len() + add > max_chars && !cur.is_empty() {
            out.push(cur.trim().to_string());
            cur.clear();
        }
        if !cur.is_empty() {
            cur.push(' ');
        }
        cur.push_str(word);
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
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

fn parse_json_string_array(text: &str) -> Vec<String> {
    let Some(start) = text.find('[') else {
        return Vec::new();
    };
    let Some(end) = text.rfind(']') else {
        return Vec::new();
    };
    if end <= start {
        return Vec::new();
    }
    let slice = &text[start..=end];
    serde_json::from_slice::<Vec<String>>(slice.as_bytes()).unwrap_or_else(|_| {
        text.lines()
            .map(|l| l.trim().trim_start_matches(|c| c == '-' || c == '•').trim().to_string())
            .filter(|l| !l.is_empty())
            .take(6)
            .collect()
    })
}

fn ingest_one_doc(
    conn: &rusqlite::Connection,
    client: &reqwest::blocking::Client,
    pinecone_host: &str,
    pine_key: &str,
    user_id: &str,
    doc_type: &str,
    part: InterviewFilePart,
    expected_dim: usize,
) -> Result<(String, usize), String> {
    let text = extract_file_text(&part.filename, &part.bytes)?;
    let doc_id = Uuid::new_v4().to_string();
    db::upsert_document(conn, &doc_id, user_id, doc_type, &part.filename, Some(&part.bytes), &text)?;

    let chunks = chunk_text(&text, 480);
    let mut all_vectors = Vec::new();
    for (i, ch) in chunks.iter().enumerate() {
        let batch = vec![ch.clone()];
        let (vecs, dim) = embeddings::embed_batch_prefer_openai(client, &batch)?;
        if dim != expected_dim {
            return Err(format!(
                "Embedding dimension is {dim} but Settings expects {expected_dim}. Set pinecone_vector_dimension to {dim} or use matching embeddings (1536 OpenAI / 768 Gemini)."
            ));
        }
        let v = vecs.into_iter().next().ok_or("empty embedding")?;
        let ref_id = format!("{doc_id}#{i}");
        let pid = format!("{user_id}_{doc_id}_{i}");
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
    upsert_vectors(client, pinecone_host, pine_key, Some(user_id), all_vectors)?;
    Ok((doc_id, chunks.len()))
}

#[tauri::command]
pub fn ingest_interview_files(
    db: State<'_, InterviewDb>,
    settings: State<'_, SettingsState>,
    mut req: IngestInterviewFilesRequest,
) -> Result<IngestInterviewFilesResponse, String> {
    if req.cv.is_none() && req.jd.is_none() {
        return Err("No files to ingest".to_string());
    }

    let (pinecone_host, expected_dim) = {
        let g = settings.0.lock().map_err(|e| e.to_string())?;
        (g.pinecone_host.clone(), g.pinecone_vector_dimension as usize)
    };
    if pinecone_host.trim().is_empty() {
        return Err("Pinecone host is empty — fill it in Settings → Interview AI.".to_string());
    }

    let pine_key = get_secret(SecretSlot::Pinecone)?.ok_or("Pinecone API key not stored")?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let client = http_client()?;

    let mut cv_doc = None;
    let mut jd_doc = None;
    let mut cv_chunks = 0usize;
    let mut jd_chunks = 0usize;

    if let Some(cv) = req.cv.take() {
        let (id, n) = ingest_one_doc(
            &conn,
            &client,
            &pinecone_host,
            &pine_key,
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
            &conn,
            &client,
            &pinecone_host,
            &pine_key,
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
    let (pinecone_host, expected_dim, llm_name) = {
        let g = settings.0.lock().map_err(|e| e.to_string())?;
        (
            g.pinecone_host.clone(),
            g.pinecone_vector_dimension as usize,
            g.interview_llm_provider.clone(),
        )
    };

    let provider = LlmProvider::parse(&llm_name).ok_or("Invalid interview_llm_provider in settings")?;

    let pine_key = get_secret(SecretSlot::Pinecone)?.ok_or("Pinecone API key not stored")?;

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
            db::recent_messages(&c, &uid_a, 12)
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

    let (query_vec, qdim) = embeddings::embed_batch_prefer_openai(&client, &[query_text.clone()])?;
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
        8,
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
    let prompt = format!(
        r#"You are an interview coach. Using ONLY the context below (CV/JD snippets, memories) plus the recent chat/transcript, propose 2–4 concise answer options the candidate could say next (spoken tone, under ~90 words each).

Return a JSON array of strings, for example: ["option 1", "option 2"]
No markdown, no keys, ONLY the JSON array.

Session summary (may be empty):
{summary}

Recent messages / transcript:
{recent_lines}

Retrieved knowledge snippets:
{ctx_block}

Task focus:
{query_text}
"#
    );

    let raw = llm::complete_suggestions(&client, provider, &prompt)?;
    let suggestions = parse_json_string_array(&raw);

    let debug = if req.debug == Some(true) {
        Some(format!(
            "pinecone_matches={}, llm_provider={}, prompt_chars={}",
            matches.len(),
            llm_name,
            prompt.len()
        ))
    } else {
        None
    };

    Ok(SuggestInterviewAnswersResponse { suggestions, debug })
}
