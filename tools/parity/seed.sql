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
