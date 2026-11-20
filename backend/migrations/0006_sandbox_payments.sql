-- Sandbox only: these records are not orders and do not reserve stock.
CREATE TABLE sandbox_payments (
 id TEXT PRIMARY KEY,
 customer_id TEXT NOT NULL REFERENCES customers(id),
 request_key TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 state TEXT NOT NULL DEFAULT 'processing',
 provider_id TEXT,
 invoice_url TEXT,
 created_at INTEGER NOT NULL,
 UNIQUE(customer_id, request_key)
);
