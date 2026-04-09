//! Embeddings: OpenAI-compatible embeddings endpoint.

use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::json;

const GEMINI_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";

/// OpenAI embeddings API max inputs per request.
pub const OPENAI_EMBEDDINGS_MAX_INPUTS: usize = 2048;

#[derive(Debug, Deserialize)]
struct OpenAiEmbeddingData {
    embedding: Vec<f32>,
    #[serde(default)]
    index: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct OpenAiEmbeddingsResponse {
    data: Vec<OpenAiEmbeddingData>,
}

#[derive(Debug, Deserialize)]
struct GeminiEmbedResponse {
    embedding: GeminiValues,
}

#[derive(Debug, Deserialize)]
struct GeminiValues {
    values: Vec<f32>,
}

pub fn embedding_dimension_for_openai_small() -> usize {
    1536
}

pub fn embedding_dimension_for_gemini_004() -> usize {
    768
}

/// Derive an embeddings URL from an LLM chat completions URL.
/// e.g. https://openrouter.ai/api/v1/chat/completions -> https://openrouter.ai/api/v1/embeddings
pub fn embeddings_url_from_llm_url(llm_url: &str) -> String {
    let base = llm_url
        .trim_end_matches("/chat/completions")
        .trim_end_matches("/completions");
    format!("{}/embeddings", base)
}

pub fn embed_batch_prefer_openai(client: &Client, url: &str, api_key: &str, texts: &[String], dimensions: Option<usize>) -> Result<(Vec<Vec<f32>>, usize), String> {
    if texts.is_empty() {
        return Ok((Vec::new(), embedding_dimension_for_openai_small()));
    }
    embed_openai(client, url, api_key, texts, dimensions)
}

fn embed_openai(client: &Client, url: &str, api_key: &str, texts: &[String], dimensions: Option<usize>) -> Result<(Vec<Vec<f32>>, usize), String> {
    let mut body = json!({
        "model": "text-embedding-3-small",
        "input": texts,
    });
    if let Some(dim) = dimensions {
        body["dimensions"] = serde_json::Value::from(dim);
    }
    let resp = client
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .map_err(|e| format!("Embeddings HTTP: {e}"))?;


    if !resp.status().is_success() {
        let t = resp.text().unwrap_or_default();
        return Err(format!("Embeddings error: {t}"));
    }

    let parsed: OpenAiEmbeddingsResponse = resp.json().map_err(|e| e.to_string())?;
    if parsed.data.len() != texts.len() {
        return Err(format!(
            "Embeddings: expected {} vectors, got {}",
            texts.len(),
            parsed.data.len()
        ));
    }
    let mut pairs: Vec<(usize, Vec<f32>)> = parsed
        .data
        .into_iter()
        .enumerate()
        .map(|(pos, d)| (d.index.unwrap_or(pos), d.embedding))
        .collect();
    pairs.sort_by_key(|(i, _)| *i);
    for (expected, (idx, _)) in pairs.iter().enumerate() {
        if *idx != expected {
            return Err(format!(
                "Embeddings: response index out of order (expected contiguous 0..{}, got {})",
                texts.len(),
                idx
            ));
        }
    }
    let vecs: Vec<Vec<f32>> = pairs.into_iter().map(|(_, v)| v).collect();
    let dim = vecs.first().map(|v| v.len()).unwrap_or(embedding_dimension_for_openai_small());
    Ok((vecs, dim))
}

/// Gemini API accepts one content per request for this endpoint in the simple form.
#[allow(dead_code)]
fn embed_gemini_one_by_one(client: &Client, api_key: &str, texts: &[String]) -> Result<(Vec<Vec<f32>>, usize), String> {
    let mut out = Vec::with_capacity(texts.len());
    let mut dim = embedding_dimension_for_gemini_004();
    for t in texts {
        let url = format!("{GEMINI_URL}?key={api_key}");
        let body = json!({ "content": { "parts": [{ "text": t }] } });
        let resp = client
            .post(&url)
            .json(&body)
            .send()
            .map_err(|e| format!("Gemini embed HTTP: {e}"))?;
        if !resp.status().is_success() {
            let txt = resp.text().unwrap_or_default();
            return Err(format!("Gemini embed error: {txt}"));
        }
        let parsed: GeminiEmbedResponse = resp.json().map_err(|e| e.to_string())?;
        dim = parsed.embedding.values.len();
        out.push(parsed.embedding.values);
    }
    Ok((out, dim))
}
