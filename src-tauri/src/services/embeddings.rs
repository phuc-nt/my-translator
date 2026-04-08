//! Embeddings: OpenAI (1536-d) for Pinecone; Gemini fallback when OpenAI key missing.

use crate::secrets::{SecretSlot, get_secret};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::json;

const OPENAI_URL: &str = "https://api.openai.com/v1/embeddings";
const GEMINI_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";

#[derive(Debug, Deserialize)]
struct OpenAiEmbeddingData {
    embedding: Vec<f32>,
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

pub fn embed_batch_prefer_openai(client: &Client, texts: &[String]) -> Result<(Vec<Vec<f32>>, usize), String> {
    if texts.is_empty() {
        return Ok((Vec::new(), embedding_dimension_for_openai_small()));
    }

    if let Some(key) = get_secret(SecretSlot::Openai)? {
        return embed_openai(client, &key, texts);
    }

    if let Some(key) = get_secret(SecretSlot::Gemini)? {
        return embed_gemini_one_by_one(client, &key, texts);
    }

    Err(
        "No embedding API key: store an OpenAI or Gemini key for semantic search (Interview settings).".to_string(),
    )
}

fn embed_openai(client: &Client, api_key: &str, texts: &[String]) -> Result<(Vec<Vec<f32>>, usize), String> {
    let body = json!({
        "model": "text-embedding-3-small",
        "input": texts,
    });
    let resp = client
        .post(OPENAI_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .map_err(|e| format!("OpenAI embeddings HTTP: {e}"))?;

    if !resp.status().is_success() {
        let t = resp.text().unwrap_or_default();
        return Err(format!("OpenAI embeddings error: {t}"));
    }

    let parsed: OpenAiEmbeddingsResponse = resp.json().map_err(|e| e.to_string())?;
    let vecs: Vec<Vec<f32>> = parsed.data.into_iter().map(|d| d.embedding).collect();
    let dim = vecs.first().map(|v| v.len()).unwrap_or(embedding_dimension_for_openai_small());
    Ok((vecs, dim))
}

/// Gemini API accepts one content per request for this endpoint in the simple form.
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
