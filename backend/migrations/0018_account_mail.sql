ALTER TABLE dev_mail ADD COLUMN auth_token_hash TEXT;
ALTER TABLE dev_mail ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX dev_mail_account_queue ON dev_mail(next_attempt_at, created_at) WHERE auth_token_hash IS NOT NULL;
