use crate::secrets::{SecretSlot, delete_secret, has_secret, set_secret};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterviewSetKeyPayload {
    pub provider: String,
    pub api_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyFlags {
    pub openai: bool,
    pub gemini: bool,
    pub claude: bool,
    pub pinecone: bool,
}

#[tauri::command]
pub fn interview_set_api_key(payload: InterviewSetKeyPayload) -> Result<(), String> {
    let slot = SecretSlot::parse(&payload.provider).ok_or_else(|| "Unknown provider".to_string())?;
    let trimmed = payload.api_key.trim();
    if trimmed.is_empty() {
        return Err("API key is empty".to_string());
    }
    set_secret(slot, trimmed)
}

#[tauri::command]
pub fn interview_clear_api_key(provider: String) -> Result<(), String> {
    let slot = SecretSlot::parse(&provider).ok_or_else(|| "Unknown provider".to_string())?;
    delete_secret(slot)
}

#[tauri::command]
pub fn interview_has_api_key(provider: String) -> Result<bool, String> {
    let slot = SecretSlot::parse(&provider).ok_or_else(|| "Unknown provider".to_string())?;
    has_secret(slot)
}

#[tauri::command]
pub fn interview_key_status() -> Result<ProviderKeyFlags, String> {
    Ok(ProviderKeyFlags {
        openai: has_secret(SecretSlot::Openai)?,
        gemini: has_secret(SecretSlot::Gemini)?,
        claude: has_secret(SecretSlot::Claude)?,
        pinecone: has_secret(SecretSlot::Pinecone)?,
    })
}
