//! API keys stored in the OS credential store (never in settings JSON).

use keyring::Entry;

const SERVICE: &str = "com.personal.translator.myjavis";

#[derive(Clone, Copy, Debug)]
pub enum SecretSlot {
    Openai,
    Gemini,
    Claude,
    Pinecone,
}

impl SecretSlot {
    fn username(self) -> &'static str {
        match self {
            SecretSlot::Openai => "openai_api_key",
            SecretSlot::Gemini => "gemini_api_key",
            SecretSlot::Claude => "claude_api_key",
            SecretSlot::Pinecone => "pinecone_api_key",
        }
    }

    pub fn parse(s: &str) -> Option<SecretSlot> {
        match s.to_lowercase().as_str() {
            "openai" => Some(SecretSlot::Openai),
            "gemini" | "google" => Some(SecretSlot::Gemini),
            "claude" | "anthropic" => Some(SecretSlot::Claude),
            "pinecone" => Some(SecretSlot::Pinecone),
            _ => None,
        }
    }
}

fn entry(slot: SecretSlot) -> Result<Entry, String> {
    Entry::new(SERVICE, slot.username()).map_err(|e| format!("keyring entry: {e}"))
}

pub fn set_secret(slot: SecretSlot, value: &str) -> Result<(), String> {
    let e = entry(slot)?;
    e.set_password(value).map_err(|e| format!("Failed to store key: {e}"))
}

pub fn get_secret(slot: SecretSlot) -> Result<Option<String>, String> {
    let e = entry(slot)?;
    match e.get_password() {
        Ok(p) if !p.is_empty() => Ok(Some(p)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read key: {e}")),
    }
}

pub fn delete_secret(slot: SecretSlot) -> Result<(), String> {
    let e = entry(slot)?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete key: {e}")),
    }
}

pub fn has_secret(slot: SecretSlot) -> Result<bool, String> {
    Ok(get_secret(slot)?.is_some())
}
