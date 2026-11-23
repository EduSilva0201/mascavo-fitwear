ALTER TABLE order_notifications ADD COLUMN email_request_json TEXT;
ALTER TABLE order_notifications ADD COLUMN email_started_at INTEGER;
ALTER TABLE order_notifications ADD COLUMN email_next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_notifications ADD COLUMN email_provider_id TEXT;
