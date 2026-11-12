CREATE TABLE customer_profiles (
 customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
 cpf TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
);
CREATE TABLE customer_addresses (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 label TEXT NOT NULL, recipient TEXT NOT NULL, cep TEXT NOT NULL, street TEXT NOT NULL,
 number TEXT NOT NULL, complement TEXT NOT NULL DEFAULT '', neighborhood TEXT NOT NULL,
 city TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX customer_addresses_owner ON customer_addresses(customer_id);
