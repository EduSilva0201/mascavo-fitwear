CREATE TABLE integration_tokens (
 provider TEXT PRIMARY KEY, access_token TEXT NOT NULL, refresh_token TEXT NOT NULL,
 expires_at INTEGER NOT NULL, refresh_state TEXT NOT NULL DEFAULT 'idle'
);
