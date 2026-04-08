use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// SQLite connection for interview RAG (managed by Tauri).
pub struct InterviewDb(pub Mutex<Connection>);

pub fn sqlite_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create app_data_dir: {e}"))?;
    Ok(dir.join("assistant.sqlite3"))
}

pub fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    let path = sqlite_path(app)?;
    let conn = Connection::open(path).map_err(|e| format!("sqlite open: {e}"))?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode=WAL;

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_user_time ON messages(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS summaries (
            user_id TEXT PRIMARY KEY,
            summary TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            importance INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);

        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            doc_type TEXT NOT NULL,
            filename TEXT NOT NULL,
            bytes BLOB,
            extracted_text TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
        "#,
    )
    .map_err(|e| format!("sqlite migrate: {e}"))?;
    Ok(())
}

pub fn insert_message(conn: &Connection, user_id: &str, role: &str, content: &str) -> Result<i64, String> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO messages (user_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![user_id, role, content, now],
    )
    .map_err(|e| format!("insert message: {e}"))?;
    Ok(conn.last_insert_rowid())
}

pub fn recent_messages(conn: &Connection, user_id: &str, limit: usize) -> Result<Vec<(String, String, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT role, content, created_at FROM messages WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )
        .map_err(|e| format!("prepare messages: {e}"))?;
    let rows = stmt
        .query_map(params![user_id, limit as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })
        .map_err(|e| format!("query messages: {e}"))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    out.reverse();
    Ok(out)
}

pub fn get_summary(conn: &Connection, user_id: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT summary FROM summaries WHERE user_id = ?1")
        .map_err(|e| format!("prepare summary: {e}"))?;
    stmt
        .query_row(params![user_id], |row| row.get(0))
        .optional()
        .map_err(|e| format!("summary: {e}"))
}

/// Replace document rows for cv/jd for this user (one row per doc_type).
pub fn upsert_document(
    conn: &Connection,
    id: &str,
    user_id: &str,
    doc_type: &str,
    filename: &str,
    bytes: Option<&[u8]>,
    extracted_text: &str,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "DELETE FROM documents WHERE user_id = ?1 AND doc_type = ?2",
        params![user_id, doc_type],
    )
    .map_err(|e| format!("delete old doc: {e}"))?;
    conn.execute(
        "INSERT INTO documents (id, user_id, doc_type, filename, bytes, extracted_text, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, user_id, doc_type, filename, bytes, extracted_text, now],
    )
    .map_err(|e| format!("insert document: {e}"))?;
    Ok(())
}

