CREATE TABLE sandbox_shipping_quotes (
 id TEXT PRIMARY KEY,
 customer_id TEXT NOT NULL REFERENCES customers(id),
 cart_json TEXT NOT NULL,
 cep TEXT NOT NULL,
 rates_json TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
ALTER TABLE sandbox_payments ADD COLUMN request_json TEXT;
ALTER TABLE sandbox_payments ADD COLUMN shipping_json TEXT;
ALTER TABLE sandbox_payments ADD COLUMN billing_type TEXT;
ALTER TABLE sandbox_payments ADD COLUMN installments INTEGER;
