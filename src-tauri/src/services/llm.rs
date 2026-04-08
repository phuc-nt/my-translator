//! Multi-provider chat completion for suggested interview answers.

use crate::secrets::{SecretSlot, get_secret};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::json;

#[derive(Clone, Copy)]
pub enum LlmProvider {
    Openai,
    Gemini,
    Claude,
}

impl LlmProvider {
    pub fn parse(s: &str) -> Option<LlmProvider> {
        match s.to_lowercase().as_str() {
            "openai" => Some(LlmProvider::Openai),
            "gemini" | "google" => Some(LlmProvider::Gemini),
            "claude" | "anthropic" => Some(LlmProvider::Claude),
            _ => None,
        }
    }
}

pub fn complete_suggestions(client: &Client, provider: LlmProvider, user_prompt: &str) -> Result<String, String> {
    match provider {
        LlmProvider::Openai => {
            let key = get_secret(SecretSlot::Openai)?.ok_or("OpenAI API key not configured")?;
            openai_chat(client, &key, user_prompt)
        }
        LlmProvider::Gemini => {
            let key = get_secret(SecretSlot::Gemini)?.ok_or("Gemini API key not configured")?;
            gemini_generate(client, &key, user_prompt)
        }
        LlmProvider::Claude => {
            let key = get_secret(SecretSlot::Claude)?.ok_or("Claude API key not configured")?;
            claude_messages(client, &key, user_prompt)
        }
    }
}

fn openai_chat(client: &Client, api_key: &str, prompt: &str) -> Result<String, String> {
    let body = json!({
        "model": "gpt-4o-mini",
        "temperature": 0.5,
        "messages": [{
            "role": "user",
            "content": prompt,
        }],
    });
    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .map_err(|e| format!("OpenAI chat: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().unwrap_or_default());
    }
    #[derive(Deserialize)]
    struct Msg {
        content: String,
    }
    #[derive(Deserialize)]
    struct Choice {
        message: Msg,
    }
    #[derive(Deserialize)]
    struct Root {
        choices: Vec<Choice>,
    }
    let root: Root = resp.json().map_err(|e| e.to_string())?;
    root.choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or_else(|| "OpenAI: empty choices".to_string())
}

fn gemini_generate(client: &Client, api_key: &str, prompt: &str) -> Result<String, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
    );
    let body = json!({
        "contents": [{ "parts": [{ "text": prompt }] }],
        "generationConfig": { "temperature": 0.5 },
    });
    let resp = client
        .post(url)
        .json(&body)
        .send()
        .map_err(|e| format!("Gemini: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().unwrap_or_default());
    }
    #[derive(Deserialize)]
    struct Part {
        text: Option<String>,
    }
    #[derive(Deserialize)]
    struct Content {
        parts: Option<Vec<Part>>,
    }
    #[derive(Deserialize)]
    struct Candidate {
        content: Option<Content>,
    }
    #[derive(Deserialize)]
    struct Root {
        candidates: Option<Vec<Candidate>>,
    }
    let root: Root = resp.json().map_err(|e| e.to_string())?;
    let text = root
        .candidates
        .and_then(|c| c.into_iter().next())
        .and_then(|x| x.content)
        .and_then(|x| x.parts)
        .and_then(|p| p.into_iter().next())
        .and_then(|p| p.text)
        .ok_or_else(|| "Gemini: no text".to_string())?;
    Ok(text)
}

fn claude_messages(client: &Client, api_key: &str, prompt: &str) -> Result<String, String> {
    let body = json!({
        "model": "claude-3-5-haiku-20241022",
        "max_tokens": 1024,
        "temperature": 0.5,
        "messages": [{ "role": "user", "content": prompt }],
    });
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Claude: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().unwrap_or_default());
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let content = v
        .get("content")
        .and_then(|c| c.as_array())
        .ok_or_else(|| "Claude: no content".to_string())?;
    let mut out = String::new();
    for block in content {
        if block.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                out.push_str(t);
            }
        }
    }
    if out.is_empty() {
        return Err("Claude: empty text".to_string());
    }
    Ok(out)
}
