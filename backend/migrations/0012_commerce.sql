CREATE TABLE orders (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), request_key TEXT NOT NULL,
 request_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 billing_type TEXT NOT NULL, installments INTEGER NOT NULL,
 payment_state TEXT NOT NULL DEFAULT 'creating', reservation_state TEXT NOT NULL DEFAULT 'active',
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, provider_customer TEXT, provider_id TEXT UNIQUE,
 installment_id TEXT, invoice_url TEXT, fiscal_json TEXT, payment_revision INTEGER NOT NULL DEFAULT 0, checked_at INTEGER NOT NULL DEFAULT 0,
 UNIQUE(customer_id,request_key)
);
CREATE TABLE order_items (
 order_id TEXT NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL, color TEXT NOT NULL, size TEXT NOT NULL,
 qty INTEGER NOT NULL CHECK(qty>0), PRIMARY KEY(order_id,product_id,color,size)
);
CREATE TABLE order_stock_checks (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE shipment_settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
CREATE TABLE sku_packages (
 product_id INTEGER NOT NULL, color TEXT NOT NULL, size TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(product_id,color,size)
);
CREATE TABLE shipments (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), sequence INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'new', provider_id TEXT UNIQUE, tracking TEXT, tracking_url TEXT,
 print_url TEXT, payload_json TEXT NOT NULL, last_status_at TEXT, updated_at INTEGER NOT NULL,
 UNIQUE(order_id,sequence)
);
CREATE TABLE shipment_operations (
 shipment_id TEXT NOT NULL REFERENCES shipments(id), action TEXT NOT NULL, state TEXT NOT NULL,
 updated_at INTEGER NOT NULL, PRIMARY KEY(shipment_id,action)
);
CREATE TABLE commerce_events (
 provider TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL, payload_json TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', received_at INTEGER NOT NULL, PRIMARY KEY(provider,id)
);
CREATE TABLE order_notifications (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), kind TEXT NOT NULL,
 recipient TEXT NOT NULL, payload_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
 UNIQUE(order_id,kind)
);
CREATE TABLE local_order_mail (
 id TEXT PRIMARY KEY REFERENCES order_notifications(id), recipient TEXT NOT NULL,
 subject TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
