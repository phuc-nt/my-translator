//! Pinecone serverless / REST: vectors/upsert and query.

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;

fn normalize_base_url(host: &str) -> String {
    let h = host.trim().trim_end_matches('/');
    if h.starts_with("http://") || h.starts_with("https://") {
        h.to_string()
    } else {
        format!("https://{h}")
    }
}

#[derive(Debug, Serialize)]
struct UpsertBody {
    vectors: Vec<PineconeVector>,
    #[serde(skip_serializing_if = "Option::is_none")]
    namespace: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PineconeVector {
    id: String,
    values: Vec<f32>,
    metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct QueryBody {
    vector: Vec<f32>,
    top_k: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    namespace: Option<String>,
    include_metadata: bool,
}

#[derive(Debug, Deserialize)]
pub struct QueryMatch {
    #[allow(dead_code)]
    pub id: String,
    #[allow(dead_code)]
    pub score: Option<f32>,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
struct QueryResponse {
    matches: Option<Vec<QueryMatch>>,
}

pub fn upsert_vectors(
    client: &Client,
    host: &str,
    api_key: &str,
    namespace: Option<&str>,
    vectors: Vec<PineconeVector>,
) -> Result<(), String> {
    if vectors.is_empty() {
        return Ok(());
    }
    let base = normalize_base_url(host);
    let url = format!("{base}/vectors/upsert");
    let body = UpsertBody {
        vectors,
        namespace: namespace.map(String::from),
    };
    let resp = client
        .post(url)
        .header("Api-Key", api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Pinecone upsert: {e}"))?;
    if !resp.status().is_success() {
        let t = resp.text().unwrap_or_default();
        return Err(format!("Pinecone upsert failed: {t}"));
    }
    Ok(())
}

pub fn query_top_k(
    client: &Client,
    host: &str,
    api_key: &str,
    namespace: Option<&str>,
    vector: Vec<f32>,
    top_k: u32,
) -> Result<Vec<QueryMatch>, String> {
    let base = normalize_base_url(host);
    let url = format!("{base}/query");
    let body = QueryBody {
        vector,
        top_k,
        namespace: namespace.map(String::from),
        include_metadata: true,
    };
    let resp = client
        .post(url)
        .header("Api-Key", api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Pinecone query: {e}"))?;
    if !resp.status().is_success() {
        let t = resp.text().unwrap_or_default();
        return Err(format!("Pinecone query failed: {t}"));
    }
    let parsed: QueryResponse = resp.json().map_err(|e| e.to_string())?;
    Ok(parsed.matches.unwrap_or_default())
}

pub fn pinecone_vector_from_parts(
    id: String,
    values: Vec<f32>,
    user_id: &str,
    kind: &str,
    ref_id: &str,
    doc_type: Option<&str>,
    content_excerpt: &str,
) -> PineconeVector {
    let mut metadata = HashMap::new();
    metadata.insert("user_id".into(), json!(user_id));
    metadata.insert("kind".into(), json!(kind));
    metadata.insert("ref_id".into(), json!(ref_id));
    if let Some(dt) = doc_type {
        metadata.insert("doc_type".into(), json!(dt));
    }
    let excerpt: String = content_excerpt.chars().take(1800).collect();
    metadata.insert("content".into(), json!(excerpt));
    PineconeVector { id, values, metadata }
}
