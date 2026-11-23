CREATE TABLE shipping_oauth_attempt (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  processing INTEGER NOT NULL DEFAULT 0
);
