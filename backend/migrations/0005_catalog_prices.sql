-- Prices supplied by the store owner; inventory remains provisional.
UPDATE catalog_products SET price_cents = 15000, provisional = 0 WHERE id = 11;
UPDATE catalog_products SET price_cents = 17000, provisional = 0 WHERE id IN (12, 13, 14);
UPDATE catalog_products SET price_cents = 16000, provisional = 0 WHERE id IN (9, 10);
