CREATE TABLE sandbox_asaas_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
