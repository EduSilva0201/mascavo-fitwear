ALTER TABLE catalog_products ADD COLUMN revision TEXT NOT NULL DEFAULT 'initial';
CREATE TABLE store_settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, revision TEXT NOT NULL);
INSERT INTO store_settings VALUES (1,'{}','initial');
CREATE TABLE admin_audit (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES customers(id), action TEXT NOT NULL,
 target TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE admin_media (key TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, actor_id TEXT NOT NULL REFERENCES customers(id), created_at INTEGER NOT NULL);
