//! API keys stored in a dedicated secrets.json file in the app config directory.
//! Using file-based storage for cross-platform reliability (keyring v3 has
//! empty-blob read issues on Windows Credential Manager).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Copy, Debug)]
pub enum SecretSlot {
    Llm,
    Pinecone,
}

impl SecretSlot {
    fn key(self) -> &'static str {
        match self {
            SecretSlot::Llm => "llm_api_key",
            SecretSlot::Pinecone => "pinecone_api_key",
        }
    }

    pub fn parse(s: &str) -> Option<SecretSlot> {
        match s.to_lowercase().as_str() {
            "llm" => Some(SecretSlot::Llm),
            "pinecone" => Some(SecretSlot::Pinecone),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct SecretsFile {
    #[serde(flatten)]
    keys: HashMap<String, String>,
}

fn secrets_path() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("com.personal.translator");
    path.push("secrets.json");
    path
}

fn load_secrets() -> SecretsFile {
    let path = secrets_path();
    if !path.exists() {
        return SecretsFile::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_secrets(store: &SecretsFile) -> Result<(), String> {
    let path = secrets_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(store).map_err(|e| format!("serialize: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write secrets: {e}"))
}

pub fn set_secret(slot: SecretSlot, value: &str) -> Result<(), String> {
    let mut store = load_secrets();
    store.keys.insert(slot.key().to_string(), value.to_string());
    save_secrets(&store)
}

pub fn get_secret(slot: SecretSlot) -> Result<Option<String>, String> {
    let store = load_secrets();
    Ok(store.keys.get(slot.key()).filter(|v| !v.is_empty()).cloned())
}

pub fn delete_secret(slot: SecretSlot) -> Result<(), String> {
    let mut store = load_secrets();
    store.keys.remove(slot.key());
    save_secrets(&store)
}

pub fn has_secret(slot: SecretSlot) -> Result<bool, String> {
    Ok(get_secret(slot)?.is_some())
}
