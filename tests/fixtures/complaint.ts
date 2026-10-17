export const settings = { store_name: 'সবমিলবে', session_secret: 'x', complaint_hours: '48', phone: '01712345678' };
export const settingsNoPhone = { store_name: 'সবমিলবে', session_secret: 'x', show_phone: '0' };
export const values = { name: 'রাজন "R"', phone: '01712345678', order_code: 'SMAB<12>', topic: 'delivery', message: "পণ্য এখনো আসেনি & <ভাঙা>\nদ্বিতীয় লাইন", email: 'a@b.com' };
export const warrantyOne = { topic: 'warranty', item: '17', item_name: 'ESP32 Dev Board', item_end: '2026-12-31T00:00:00Z' };
export const warrantyList = { topic: 'warranty', items: [{ product_id: 3, name: 'Relay Module', valid: true }, { product_id: 4, name: 'Old <Sensor>', valid: false }] };
export const open = { code: 'C111222', status: 'open', topic: 'delivery', order_code: 'SMXY12AB', created_at: '2026-10-10T04:00:00Z', due_at: '2026-10-13T04:00:00Z', message: 'আসেনি\n"কবে?"', replies: [] };
export const closed = { code: 'C333444', status: 'resolved', topic: 'unknown-topic', order_code: '', created_at: '2026-10-01T04:00:00Z', resolved_at: '2026-10-02T09:15:00Z', message: 'x', replies: [{ body: 'ঠিক করা হয়েছে <ধন্যবাদ>', created_at: '2026-10-02T09:15:00Z' }] };
