ALTER TABLE orders ADD COLUMN delivery_state TEXT NOT NULL DEFAULT 'to_arrange'
  CHECK (delivery_state IN ('to_arrange', 'scheduled', 'delivered'));
ALTER TABLE orders ADD COLUMN delivery_date TEXT;
