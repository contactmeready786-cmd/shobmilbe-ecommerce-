// What the shop's own APIs answer, as the browser code reads it (the server side: lib/api/*.ts). An answer that can
// also be an error carries the error fields too; a broken or missing body arrives as {} (postJson never throws on one).

/** The usual small answer: a message to show, or an error. */
export type MessageAnswer = { ok?: boolean; message?: string; error?: string };

/** POST /api/quote — each line's real price (flash sale, cheaper for more pieces) and the free gifts */
export type QuoteAnswer = {
  lines?: { id: number; product_id: number; qty: number; price: number; base: number; kind: string; note: string; tiers: { min_qty: number; price: number }[]; flash_left: number | null }[];
  gifts?: { id: number; name: string; slug: string; qty: number; price: number; note: string; image: string | null; emoji: string | null }[];
  subtotal?: number;
};

/** GET /api/resume?id=… — the reminder SMS link's saved checkout */
export type ResumeAnswer = { ok: true; name: string | null; phone: string | null; items: { id: number; qty: number }[] } | { ok: false };

/** POST /api/giftcard */
export type GiftcardAnswer = { ok: true; code: string; balance: number; message: string } | { ok: false; message: string };

/** POST /api/orders — the order placed (where to go next), or what to fix */
export type OrderAnswer = { code?: string; redirect?: string; error?: string; field?: string; otp?: boolean };

/** POST /api/checkout-otp/status | send | smscheck | verify */
export type OtpAnswer = {
  need?: boolean; why?: string; // status
  sent?: boolean; wait?: number; len?: number; message?: string; // send
  stuck?: boolean; state?: string; // smscheck
  ok?: boolean; token?: string; // verify
  error?: string; expired?: boolean; // any step that went wrong
};

// ---------- admin ----------
/** One courier's record of a phone number (FraudBD). */
export type FraudCourier = { name: string; type: string; total: number; success: number; cancel: number; rating: string; risk: string; message: string };
/** GET /admin/api/fraud?phone=… (lib/services/fraud.ts check): the number's record here and at the couriers. */
export type FraudReport =
  | { ok: false; message: string }
  | {
    ok: true; phone: string;
    own: { orders: number; delivered: number; failed: number; open: number; last_day: number };
    pathao: { ok: boolean; total: number; success: number; rating: string; message: string } | null;
    fraudbd: ({ ok: true; couriers: FraudCourier[]; total: number; success: number; cancel: number; rate: number | null } | { ok: false; message: string }) | null;
    cached_at: string | null;
    level: string; label: string; advice: string; total: number; success: number; rate: number | null;
    sources: { pathao: boolean; fraudbd: boolean };
  };
