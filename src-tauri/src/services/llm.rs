//! Generic OpenAI-compatible chat completion for suggested interview answers.

use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::json;

pub fn complete_suggestions(
    client: &Client,
    url: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    let body = json!({
        "model": model,
        "temperature": 0.5,
        "max_tokens": 600,
        "messages": [{ "role": "user", "content": prompt }],
    });

    let resp = client
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .map_err(|e| format!("LLM request: {e}"))?;

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
        .ok_or_else(|| "LLM: empty choices".to_string())
}
