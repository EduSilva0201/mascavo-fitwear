PRAGMA foreign_keys = ON;
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX sessions_customer ON sessions(customer_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE auth_tokens (
  token_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX auth_tokens_customer ON auth_tokens(customer_id, purpose);
CREATE TABLE auth_rate_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
-- Local delivery adapter only. Never use this mailbox with customer data.
CREATE TABLE dev_mail (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  purpose TEXT NOT NULL,
  token TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
