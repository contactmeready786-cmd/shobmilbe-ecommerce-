-- Test data for the parity check. Runs on an EMPTY local test database only, never on the real shop.
INSERT INTO categories (name, slug, icon, sort) VALUES
  ('আরডুইনো', 'arduino', '🔧', 1),
  ('সেন্সর', 'sensor', '📡', 2),
  ('মডিউল', 'module', '🧩', 3)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO products (name, slug, category_id, price, old_price, stock, description, short_description, sku, brand, featured, active)
SELECT v.name, v.slug, c.id, v.price, v.old_price, v.stock, v.descr, v.short, v.sku, v.brand, v.featured, true
FROM (VALUES
  ('Arduino Uno R3', 'arduino-uno-r3', 'arduino', 850, 950, 12, 'Arduino Uno R3 বোর্ড, ATmega328P সহ।', 'জনপ্রিয় মাইক্রোকন্ট্রোলার বোর্ড', 'ARD-UNO', 'Arduino', true),
  ('Arduino Nano', 'arduino-nano', 'arduino', 450, NULL, 0, 'ছোট আকারের আরডুইনো।', 'ছোট বোর্ড', 'ARD-NANO', 'Arduino', false),
  ('HC-SR04 Ultrasonic Sensor', 'hc-sr04', 'sensor', 95, 120, 40, 'দূরত্ব মাপার সেন্সর।', 'আল্ট্রাসনিক সেন্সর', 'HCSR04', '', true),
  ('SG90 Servo Motor', 'sg90-servo', 'module', 160, NULL, 25, 'ছোট সার্ভো মোটর।', '৯ গ্রাম সার্ভো', 'SG90', 'TowerPro', false),
  ('PAM8403 Amplifier Board', 'pam8403', 'module', 45, 60, 3, 'ছোট অডিও এমপ্লিফায়ার।', '৩ ওয়াট x ২', 'PAM8403', '', false),
  ('1K Resistor', '1k-resistor', 'module', 1, NULL, 500, 'রেজিস্টর।', '১ কিলো ওহম', 'R1K', '', false)
) AS v(name, slug, cat, price, old_price, stock, descr, short, sku, brand, featured)
JOIN categories c ON c.slug = v.cat
ON CONFLICT (slug) DO NOTHING;

INSERT INTO orders (code, customer_name, phone, address, area, note, subtotal, delivery, total, payment, status, created_at)
VALUES
  ('TEST1001', 'রহিম উদ্দিন', '01700000001', 'বাড়ি ১, রোড ২', 'dhaka', '', 945, 60, 1005, 'cod', 'pending', '2026-10-01 10:00+06'),
  ('TEST1002', 'করিম মিয়া', '01800000002', 'গ্রাম কালিকাপুর', 'outside', 'দ্রুত দিন', 160, 110, 270, 'cod', 'delivered', '2026-10-02 12:30+06')
ON CONFLICT (code) DO NOTHING;

INSERT INTO order_items (order_id, product_id, name, price, qty)
SELECT o.id, p.id, p.name, p.price, 1 FROM orders o JOIN products p ON p.slug IN ('arduino-uno-r3', 'hc-sr04')
WHERE o.code = 'TEST1001' AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = o.id);
INSERT INTO order_items (order_id, product_id, name, price, qty)
SELECT o.id, p.id, p.name, p.price, 1 FROM orders o JOIN products p ON p.slug = 'sg90-servo'
WHERE o.code = 'TEST1002' AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = o.id);

-- detail pages (customer, blog, brand, supplier, purchase, gift card, warehouse, complaint, review)
INSERT INTO customers (name, phone, email, address, district, thana, created_at)
SELECT 'রহিম উদ্দিন', '01700000001', 'rahim@example.com', 'বাড়ি ১, রোড ২', 'Dhaka', 'Adabor', '2026-09-01 10:00+06'
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone = '01700000001');
INSERT INTO blog_posts (title, slug, excerpt, content, status, published_at, created_at)
VALUES ('Arduino শুরু করবেন যেভাবে', 'arduino-start', 'প্রথম প্রজেক্ট', '## শুরু\nএকটা LED জ্বালান।', 'published', '2026-09-05 10:00+06', '2026-09-05 10:00+06')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO brands (name, slug, description) VALUES ('Arduino', 'arduino-brand', 'ইতালির বোর্ড') ON CONFLICT (slug) DO NOTHING;
INSERT INTO suppliers (name, company, phone) SELECT 'করিম ট্রেডার্স', 'করিম', '01900000003'
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE phone = '01900000003');
INSERT INTO purchases (code, supplier_id, purchase_date, status, subtotal, total, created_at)
SELECT 'PUR-1', s.id, '2026-09-10', 'received', 4250, 4250, '2026-09-10 10:00+06' FROM suppliers s WHERE s.phone = '01900000003'
ON CONFLICT (code) DO NOTHING;
INSERT INTO purchase_items (purchase_id, product_id, name, qty, unit_cost)
SELECT pu.id, p.id, p.name, 5, 850 FROM purchases pu, products p WHERE pu.code = 'PUR-1' AND p.slug = 'arduino-uno-r3'
AND NOT EXISTS (SELECT 1 FROM purchase_items WHERE purchase_id = pu.id);
INSERT INTO gift_cards (code, initial, balance, status, buyer_name, created_at)
VALUES ('GIFT-TEST-1', 500, 500, 'active', 'রহিম', '2026-09-12 10:00+06') ON CONFLICT (code) DO NOTHING;
INSERT INTO warehouses (name, address, is_shop) SELECT 'গুদাম ১', 'পুরান ঢাকা', false
WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = 'গুদাম ১');
INSERT INTO complaints (code, name, phone, order_code, topic, message, status, created_at)
VALUES ('CMP-1', 'রহিম উদ্দিন', '01700000001', 'TEST1001', 'delivery', 'পণ্য দেরিতে এসেছে', 'open', '2026-10-03 10:00+06') ON CONFLICT (code) DO NOTHING;
INSERT INTO reviews (product_id, name, phone, rating, body, status, created_at)
SELECT p.id, 'রহিম', '01700000001', 5, 'ভালো বোর্ড', 'approved', '2026-10-04 10:00+06' FROM products p WHERE p.slug = 'arduino-uno-r3'
AND NOT EXISTS (SELECT 1 FROM reviews WHERE body = 'ভালো বোর্ড');
