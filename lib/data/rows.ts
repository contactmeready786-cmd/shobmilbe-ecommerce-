// Made by tools/gen-row-types.ts from the database layout in lib/db.ts — don't edit by hand.
// One type per table: a row as lib/pg hands it over (numbers for whole numbers and money, Date for times, text for
// dates, null where the column allows it). A query that adds joined or computed columns can extend these:
//   db.q<OrdersRow & { item_count: number }>(…)
// After changing the database layout run: npx tsx tools/gen-row-types.ts (tests/row-types.test.ts checks it).

/** A row of accounts. */
export type AccountsRow = {
  id: number;
  name: string;
  type: string;
  details: string;
  opening_balance: number;
  active: boolean;
  sort: number;
};

/** A row of activity_log. */
export type ActivityLogRow = {
  id: number;
  staff_id: number | null;
  action: string;
  entity: string;
  entity_id: number | null;
  detail: string;
  created_at: Date;
};

/** A row of admin_sessions. */
export type AdminSessionsRow = {
  id: string;
  staff_id: number;
  verified: boolean;
  ip: string;
  ua: string;
  device: string;
  place: string;
  created_at: Date;
  last_seen: Date;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_why: string;
};

/** A row of autocalls. */
export type AutocallsRow = {
  id: number;
  order_id: number | null;
  phone: string;
  state: string;
  digit: string;
  ref: string;
  attempt: number;
  detail: string;
  created_at: Date;
  updated_at: Date;
};

/** A row of backups. */
export type BackupsRow = {
  id: number;
  kind: string;
  ok: boolean;
  size_bytes: number;
  tables: number;
  rows_count: number;
  with_images: boolean;
  encrypted: boolean;
  note: string;
  staff_id: number | null;
  created_at: Date;
  ik_id: string | null;
  ik_url: string | null;
};

/** A row of banners. */
export type BannersRow = {
  id: number;
  image_id: number | null;
  title: string;
  subtitle: string;
  link: string;
  button: string;
  placement: string;
  sort: number;
  active: boolean;
};

/** A row of blocklist. */
export type BlocklistRow = {
  id: number;
  kind: string;
  value: string;
  reason: string;
  created_by: number | null;
  created_at: Date;
  expires_at: Date | null;
};

/** A row of blog_categories. */
export type BlogCategoriesRow = {
  id: number;
  name: string;
  slug: string;
  sort: number;
};

/** A row of blog_posts. */
export type BlogPostsRow = {
  id: number;
  title: string;
  slug: string;
  category_id: number | null;
  excerpt: string;
  content: string;
  cover_id: number | null;
  status: string;
  published_at: Date | null;
  seo_title: string;
  seo_description: string;
  author_id: number | null;
  views: number;
  created_at: Date;
  updated_at: Date;
  auto_key: string | null;
};

/** A row of brands. */
export type BrandsRow = {
  id: number;
  name: string;
  slug: string;
  logo_id: number | null;
  description: string;
  seo_title: string;
  seo_description: string;
  active: boolean;
  sort: number;
  created_at: Date;
  noindex: boolean;
};

/** A row of bundle_items. */
export type BundleItemsRow = {
  id: number;
  bundle_id: number;
  product_id: number;
  qty: number;
};

/** A row of categories. */
export type CategoriesRow = {
  id: number;
  name: string;
  slug: string;
  icon: string;
  sort: number;
  image_id: number | null;
  active: boolean;
  parent_id: number | null;
  description: string;
  seo_title: string;
  seo_description: string;
  banner_id: number | null;
  noindex: boolean;
  size_chart: string;
  no_free_delivery: boolean;
};

/** A row of checkout_drafts. */
export type CheckoutDraftsRow = {
  id: string;
  visitor_id: string;
  session_id: string;
  name: string;
  phone: string;
  district: string;
  thana: string;
  address: string;
  note: string;
  items: unknown;
  subtotal: number;
  ip: string;
  status: string;
  order_code: string;
  admin_note: string;
  called_by: number | null;
  called_at: Date | null;
  created_at: Date;
  updated_at: Date;
  reminded_at: Date | null;
  remind_result: string;
};

/** A row of checkout_otps. */
export type CheckoutOtpsRow = {
  id: number;
  phone: string;
  code_hash: string;
  expires_at: Date;
  tries: number;
  sent_ok: boolean;
  verified_at: Date | null;
  used: boolean;
  ip: string;
  created_at: Date;
  gw_id: string;
  gw_state: string;
};

/** A row of cod_settlements. */
export type CodSettlementsRow = {
  id: number;
  courier: string;
  ref: string;
  settled_on: string;
  collected: number;
  fee: number;
  received: number;
  account_id: number | null;
  order_count: number;
  note: string;
  staff_id: number | null;
  created_at: Date;
};

/** A row of complaint_notes. */
export type ComplaintNotesRow = {
  id: number;
  complaint_id: number;
  staff_id: number | null;
  body: string;
  to_customer: boolean;
  sms_ok: boolean | null;
  created_at: Date;
};

/** A row of complaints. */
export type ComplaintsRow = {
  id: number;
  code: string;
  name: string;
  phone: string;
  email: string;
  order_code: string;
  topic: string;
  message: string;
  photos: number[];
  status: string;
  assigned_to: number | null;
  source: string;
  ip: string;
  due_at: Date;
  first_reply_at: Date | null;
  resolved_at: Date | null;
  resolution: string;
  created_at: Date;
  updated_at: Date;
  product_id: number | null;
  item_name: string;
  warranty_until: string | null;
};

/** A row of coupons. */
export type CouponsRow = {
  id: number;
  code: string;
  type: string;
  value: number;
  min_order: number;
  max_discount: number;
  starts_on: string | null;
  ends_on: string | null;
  usage_limit: number;
  used_count: number;
  per_phone: number;
  active: boolean;
  note: string;
  created_at: Date;
  product_ids: number[];
  category_ids: number[];
  first_order: boolean;
};

/** A row of customer_addresses. */
export type CustomerAddressesRow = {
  id: number;
  customer_id: number;
  label: string;
  name: string;
  phone: string;
  district: string;
  thana: string;
  address: string;
  is_default: boolean;
  created_at: Date;
};

/** A row of customer_email_otps. */
export type CustomerEmailOtpsRow = {
  id: number;
  email: string;
  code_hash: string;
  expires_at: Date;
  tries: number;
  used: boolean;
  ip: string;
  created_at: Date;
  pw_hash: string;
  purpose: string;
};

/** A row of customer_otps. */
export type CustomerOtpsRow = {
  id: number;
  phone: string;
  code_hash: string;
  expires_at: Date;
  tries: number;
  used: boolean;
  ip: string;
  created_at: Date;
};

/** A row of customers. */
export type CustomersRow = {
  id: number;
  name: string;
  phone: string | null;
  email: string;
  address: string;
  district: string;
  thana: string;
  note: string;
  created_at: Date;
  updated_at: Date;
  tags: string;
  grp: string;
  points: number;
  session_ver: number;
  last_login: Date | null;
  ref_code: string | null;
  referred_by: number | null;
  login_via: string;
  email_verified: boolean;
  contact_phone: string;
  password_hash: string;
  promo_sms: boolean;
};

/** A row of delete_codes. */
export type DeleteCodesRow = {
  id: number;
  staff_id: number | null;
  action: string;
  code_hash: string;
  ip: string;
  tries: number;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
};

/** A row of email_campaigns. */
export type EmailCampaignsRow = {
  id: number;
  subject: string;
  intro: string;
  product_ids: number[];
  button_text: string;
  button_url: string;
  audience: string;
  kind: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  staff_id: number | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
};

/** A row of email_log. */
export type EmailLogRow = {
  id: number;
  sub_id: number | null;
  email: string;
  kind: string;
  campaign_id: number | null;
  order_id: number | null;
  ok: boolean;
  detail: string;
  opened_at: Date | null;
  clicked_at: Date | null;
  created_at: Date;
};

/** A row of email_subs. */
export type EmailSubsRow = {
  id: number;
  email: string;
  name: string;
  phone: string;
  source: string;
  on_list: boolean;
  token: string;
  created_at: Date;
  unsub_at: Date | null;
  last_open_at: Date | null;
  fails: number;
};

/** A row of error_log. */
export type ErrorLogRow = {
  id: number;
  day: string;
  path: string;
  message: string;
  n: number;
  method: string;
  first_at: Date;
  last_at: Date;
};

/** A row of fb_comments. */
export type FbCommentsRow = {
  id: string;
  post_id: string;
  message: string;
  product_id: number | null;
  replied: boolean;
  reply_id: string;
  reply: string;
  error: string;
  created_at: Date;
};

/** A row of flash_items. */
export type FlashItemsRow = {
  id: number;
  sale_id: number;
  product_id: number;
  price: number;
  max_qty: number;
  sold: number;
};

/** A row of flash_sales. */
export type FlashSalesRow = {
  id: number;
  title: string;
  starts_at: Date;
  ends_at: Date;
  active: boolean;
  show_home: boolean;
  created_at: Date;
};

/** A row of fraud_checks. */
export type FraudChecksRow = {
  phone: string;
  data: unknown;
  checked_at: Date;
};

/** A row of geo_blocks. */
export type GeoBlocksRow = {
  day: string;
  country: string;
  why: string;
  n: number;
};

/** A row of gift_card_ledger. */
export type GiftCardLedgerRow = {
  id: number;
  card_id: number;
  order_id: number | null;
  amount: number;
  balance: number;
  note: string;
  staff_id: number | null;
  created_at: Date;
};

/** A row of gift_cards. */
export type GiftCardsRow = {
  id: number;
  code: string;
  initial: number;
  balance: number;
  status: string;
  source: string;
  buyer_name: string;
  buyer_phone: string;
  recipient_name: string;
  recipient_phone: string;
  message: string;
  expires_on: string | null;
  pay_method: string;
  trx_id: string;
  pay_number: string;
  price: number;
  customer_id: number | null;
  order_id: number | null;
  note: string;
  created_by: number | null;
  ip: string;
  activated_at: Date | null;
  created_at: Date;
};

/** A row of home_rows. */
export type HomeRowsRow = {
  id: number;
  title: string;
  sub: string;
  source: string;
  ref: string;
  product_ids: number[];
  min_price: number | null;
  max_price: number | null;
  sort: string;
  lim: number;
  badge: string;
  style: string;
  in_stock_only: boolean;
  created_at: Date;
  updated_at: Date;
};

/** A row of ik_trash. */
export type IkTrashRow = {
  file_id: string;
  added_at: Date;
};

/** A row of integration_logs. */
export type IntegrationLogsRow = {
  id: number;
  service: string;
  action: string;
  ok: boolean;
  message: string;
  ref: string;
  created_at: Date;
};

/** A row of kit_items. */
export type KitItemsRow = {
  id: number;
  kit_id: number;
  product_id: number;
  qty: number;
  optional: boolean;
  note: string;
  sort: number;
};

/** A row of kits. */
export type KitsRow = {
  id: number;
  slug: string;
  title: string;
  description: string;
  image_id: number | null;
  emoji: string;
  active: boolean;
  sort: number;
  created_at: Date;
  updated_at: Date;
  steps: string;
  level: string;
  duration: string;
  guide_key: string;
};

/** A row of live_clicks. */
export type LiveClicksRow = {
  day: string;
  sport: string;
  cat: string;
  n: number;
};

/** A row of login_history. */
export type LoginHistoryRow = {
  id: number;
  staff_id: number | null;
  login: string;
  event: string;
  ok: boolean;
  ip: string;
  device: string;
  place: string;
  detail: string;
  created_at: Date;
};

/** A row of login_lock_codes. */
export type LoginLockCodesRow = {
  hash: string;
  staff_id: number;
  expires_at: Date;
};

/** A row of loyalty_ledger. */
export type LoyaltyLedgerRow = {
  id: number;
  customer_id: number;
  order_id: number | null;
  points: number;
  kind: string;
  note: string;
  staff_id: number | null;
  created_at: Date;
};

/** A row of media. */
export type MediaRow = {
  id: number;
  mime: string;
  data: Buffer | null;
  thumb: Buffer | null;
  width: number | null;
  height: number | null;
  owner_type: string | null;
  owner_id: number | null;
  sort: number;
  created_at: Date;
  sha: string | null;
  phash: string | null;
  phash_m: string | null;
  wm: Buffer | null;
  wm_ver: string | null;
  ik_url: string | null;
  ik_id: string | null;
  wm_url: string | null;
  wm_ik_id: string | null;
  wb_state: string | null;
  wb_method: string | null;
  wb_note: string;
  wb_force: string | null;
  wb_try: number;
  wb_at: Date | null;
  wb_orig_url: string | null;
  wb_orig_id: string | null;
  wb_orig_mime: string | null;
};

/** A row of offers. */
export type OffersRow = {
  id: number;
  title: string;
  buy_product_id: number;
  buy_qty: number;
  get_product_id: number | null;
  get_qty: number;
  get_percent: number;
  max_times: number;
  starts_on: string | null;
  ends_on: string | null;
  active: boolean;
  created_at: Date;
};

/** A row of order_items. */
export type OrderItemsRow = {
  id: number;
  order_id: number | null;
  product_id: number | null;
  name: string;
  price: number;
  qty: number;
  sku: string;
  cost: number;
  components: unknown;
  note: string;
  kind: string;
  ref_id: number | null;
  preorder_qty: number;
};

/** A row of orders. */
export type OrdersRow = {
  id: number;
  code: string;
  customer_name: string;
  phone: string;
  address: string;
  area: string;
  note: string;
  subtotal: number;
  delivery: number;
  total: number;
  payment: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  email: string;
  district: string;
  thana: string;
  discount: number;
  coupon_code: string;
  payment_status: string;
  paid_amount: number;
  transaction_id: string;
  payment_number: string;
  courier: string;
  consignment_id: string;
  tracking_code: string;
  courier_status: string;
  courier_sent_at: Date | null;
  admin_note: string;
  ip: string;
  source: string;
  created_by: number | null;
  customer_id: number | null;
  cost_total: number;
  delivered_at: Date | null;
  returned_to: string;
  zone_name: string;
  refund_amount: number;
  refunded_at: Date | null;
  weight_g: number;
  points_used: number;
  points_discount: number;
  points_earned: number;
  handed_at: Date | null;
  handed_by: number | null;
  gift_code: string;
  gift_amount: number;
  ref_code: string;
  ref_by: number | null;
  ref_discount: number;
  ref_rewarded: boolean;
  warehouse_id: number | null;
  pos_tendered: number;
  cod_settlement_id: number | null;
  courier_fee: number;
  phone_check: string;
  consent_at: Date | null;
  account_id: number | null;
};

/** A row of owner_faces. */
export type OwnerFacesRow = {
  id: number;
  staff_id: number;
  photo: string;
  descriptor: string;
  source: string;
  created_at: Date;
};

/** A row of owner_passkeys. */
export type OwnerPasskeysRow = {
  id: number;
  staff_id: number;
  cred_id: string;
  public_key: string;
  alg: number;
  sign_count: number;
  rp_id: string;
  name: string;
  transports: string;
  created_at: Date;
  last_used: Date | null;
};

/** A row of page_views. */
export type PageViewsRow = {
  id: number;
  session_id: string;
  visitor_id: string;
  path: string;
  title: string;
  product_id: number | null;
  duration: number;
  scroll: number;
  created_at: Date;
};

/** A row of pages. */
export type PagesRow = {
  id: number;
  title: string;
  slug: string;
  content: string;
  in_footer: boolean;
  active: boolean;
  sort: number;
  updated_at: Date;
};

/** A row of payments. */
export type PaymentsRow = {
  id: number;
  order_id: number | null;
  method: string;
  amount: number;
  status: string;
  gateway_ref: string;
  trx_id: string;
  raw: unknown;
  created_at: Date;
  updated_at: Date;
};

/** A row of price_alerts. */
export type PriceAlertsRow = {
  id: number;
  product_id: number;
  phone: string;
  price_at: number;
  ip: string;
  created_at: Date;
  notified_at: Date | null;
  result: string;
};

/** A row of price_tiers. */
export type PriceTiersRow = {
  product_id: number;
  min_qty: number;
  price: number;
};

/** A row of product_links. */
export type ProductLinksRow = {
  product_id: number;
  linked_id: number;
  kind: string;
  sort: number;
};

/** A row of product_questions. */
export type ProductQuestionsRow = {
  id: number;
  product_id: number;
  name: string;
  phone: string;
  question: string;
  answer: string;
  status: string;
  ip: string;
  answered_by: number | null;
  answered_at: Date | null;
  created_at: Date;
};

/** A row of products. */
export type ProductsRow = {
  id: number;
  name: string;
  slug: string;
  category_id: number | null;
  price: number;
  old_price: number | null;
  stock: number;
  description: string;
  emoji: string;
  image: string | null;
  featured: boolean;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  sku: string;
  short_description: string;
  cost_price: number;
  youtube_url: string;
  product_type: string;
  image_id: number | null;
  seo_title: string;
  seo_description: string;
  low_stock: number;
  weight_g: number;
  unit: string;
  brand: string;
  sold_count: number;
  seo_keywords: string;
  allow_duplicate: boolean;
  import_ref: string;
  brand_id: number | null;
  model: string;
  specs: unknown;
  is_new: boolean;
  damaged_stock: number;
  supplier_id: number | null;
  noindex: boolean;
  wish_count: number;
  rating_avg: number;
  rating_count: number;
  warranty: string;
  warranty_type: string;
  barcode: string;
  parent_id: number | null;
  variant_label: string;
  variant_count: number;
  variant_title: string;
  variant_sort: number;
  preorder: boolean;
  preorder_days: number;
  location: string;
  seo_auto_at: Date | null;
  src_wm: boolean;
  src_wm_checked: boolean;
  pack_sizes: string;
  dims: string;
};

/** A row of purchase_items. */
export type PurchaseItemsRow = {
  id: number;
  purchase_id: number;
  product_id: number | null;
  name: string;
  qty: number;
  unit_cost: number;
};

/** A row of purchases. */
export type PurchasesRow = {
  id: number;
  code: string;
  supplier_id: number | null;
  purchase_date: string;
  status: string;
  subtotal: number;
  discount: number;
  shipping: number;
  other_cost: number;
  vat: number;
  total: number;
  note: string;
  created_by: number | null;
  received_at: Date | null;
  created_at: Date;
};

/** A row of push_campaigns. */
export type PushCampaignsRow = {
  id: number;
  title: string;
  body: string;
  url: string;
  image_id: number | null;
  total: number;
  sent: number;
  failed: number;
  staff_id: number | null;
  created_at: Date;
};

/** A row of push_subs. */
export type PushSubsRow = {
  id: number;
  staff_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  device: string;
  created_at: Date;
  last_ok: Date | null;
  fails: number;
};

/** A row of rate_limits. */
export type RateLimitsRow = {
  k: string;
  n: number;
  reset_at: Date;
};

/** A row of recovery_codes. */
export type RecoveryCodesRow = {
  id: number;
  hash: string;
  used_at: Date | null;
  created_at: Date;
};

/** A row of redirects. */
export type RedirectsRow = {
  from_path: string;
  to_path: string;
  hits: number;
  created_at: Date;
};

/** A row of refunds. */
export type RefundsRow = {
  id: number;
  order_id: number;
  amount: number;
  method: string;
  reference: string;
  note: string;
  staff_id: number | null;
  created_at: Date;
};

/** A row of research_hosts. */
export type ResearchHostsRow = {
  host: string;
  robots: string;
  fetched_at: Date;
};

/** A row of research_items. */
export type ResearchItemsRow = {
  id: number;
  source_id: number;
  ext_id: string;
  title: string;
  url: string;
  image: string;
  category: string;
  price: number | null;
  regular_price: number | null;
  prev_price: number | null;
  price_changed_at: Date | null;
  in_stock: boolean | null;
  sold_out_count: number;
  rank: number | null;
  rank_ref: number | null;
  rank_ref_at: Date | null;
  best_rank: number | null;
  rating: number | null;
  reviews: number;
  first_seen: Date;
  last_seen: Date;
};

/** A row of research_queue. */
export type ResearchQueueRow = {
  source_id: number;
  url: string;
  kind: string;
  depth: number;
  lastmod: Date | null;
  pos: number | null;
  rank_hint: number | null;
  checked_at: Date | null;
  is_product: boolean | null;
  fails: number;
  added_at: Date;
};

/** A row of research_sources. */
export type ResearchSourcesRow = {
  id: number;
  url: string;
  name: string;
  kind: string;
  segment: string;
  active: boolean;
  last_run: Date | null;
  last_ok: Date | null;
  last_error: string;
  items: number;
  created_at: Date;
  seeded_at: Date | null;
  search_only: boolean;
};

/** A row of return_requests. */
export type ReturnRequestsRow = {
  id: number;
  code: string;
  order_id: number;
  customer_id: number | null;
  phone: string;
  items: unknown;
  reason: string;
  details: string;
  photos: number[];
  want: string;
  refund_method: string;
  refund_number: string;
  status: string;
  admin_note: string;
  reply: string;
  restock: unknown;
  refund_amount: number;
  source: string;
  handled_by: number | null;
  received_at: Date | null;
  refunded_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** A row of reviews. */
export type ReviewsRow = {
  id: number;
  product_id: number;
  customer_id: number | null;
  order_id: number | null;
  name: string;
  phone: string;
  rating: number;
  body: string;
  status: string;
  reply: string;
  verified: boolean;
  ip: string;
  created_at: Date;
  approved_at: Date | null;
  photos: number[];
};

/** A row of search_log. */
export type SearchLogRow = {
  id: number;
  q: string;
  found: number;
  created_at: Date;
};

/** A row of security_events. */
export type SecurityEventsRow = {
  id: number;
  ip: string;
  kind: string;
  detail: string;
  path: string;
  ua: string;
  country: string;
  city: string;
  created_at: Date;
};

/** A row of seo_auto_log. */
export type SeoAutoLogRow = {
  id: number;
  product_id: number;
  field: string;
  old_value: string;
  new_value: string;
  undone: boolean;
  created_at: Date;
};

/** A row of seo_score_history. */
export type SeoScoreHistoryRow = {
  day: string;
  avg: number;
  perfect: number;
  total: number;
};

/** A row of settings. */
export type SettingsRow = {
  key: string;
  value: string | null;
};

/** A row of shop_push_subs. */
export type ShopPushSubsRow = {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  customer_id: number | null;
  device: string;
  fails: number;
  last_ok: Date | null;
  created_at: Date;
};

/** A row of sms_campaigns. */
export type SmsCampaignsRow = {
  id: number;
  audience: string;
  body: string;
  total: number;
  sent: number;
  failed: number;
  staff_id: number | null;
  created_at: Date;
  updated_at: Date;
};

/** A row of sms_log. */
export type SmsLogRow = {
  id: number;
  phone: string;
  body: string;
  kind: string;
  ok: boolean;
  detail: string;
  order_id: number | null;
  staff_id: number | null;
  created_at: Date;
};

/** A row of social_posts. */
export type SocialPostsRow = {
  id: number;
  slot: string;
  channel: string;
  product_id: number | null;
  ok: boolean | null;
  post_id: string;
  message: string;
  created_at: Date;
  kind: string;
  ref: string;
};

/** A row of staff. */
export type StaffRow = {
  id: number;
  name: string;
  username: string;
  phone: string;
  email: string;
  password: string;
  role: string;
  permissions: unknown;
  active: boolean;
  note: string;
  last_login: Date | null;
  created_at: Date;
  totp_secret: string;
  totp_on: boolean;
  totp_last_step: number;
  password_changed_at: Date | null;
  photo_id: number | null;
  designation: string;
  address: string;
  emergency_phone: string;
  joined_on: string | null;
  bio: string;
};

/** A row of stock_alerts. */
export type StockAlertsRow = {
  id: number;
  product_id: number;
  phone: string;
  name: string;
  ip: string;
  created_at: Date;
  notified_at: Date | null;
  result: string;
};

/** A row of stock_movements. */
export type StockMovementsRow = {
  id: number;
  product_id: number;
  change: number;
  balance: number | null;
  reason: string;
  ref_type: string;
  ref_id: number | null;
  note: string;
  staff_id: number | null;
  created_at: Date;
  damaged_change: number;
  unit_cost: number | null;
};

/** A row of suppliers. */
export type SuppliersRow = {
  id: number;
  name: string;
  company: string;
  phone: string;
  email: string;
  address: string;
  note: string;
  opening_due: number;
  active: boolean;
  created_at: Date;
};

/** A row of transactions. */
export type TransactionsRow = {
  id: number;
  tx_date: string;
  type: string;
  category: string;
  amount: number;
  account_id: number | null;
  to_account_id: number | null;
  supplier_id: number | null;
  order_id: number | null;
  purchase_id: number | null;
  vat: number;
  note: string;
  created_by: number | null;
  created_at: Date;
};

/** A row of translations. */
export type TranslationsRow = {
  id: number;
  hash: string;
  src: string;
  en: string;
  origin: string;
  hits: number;
  last_seen: Date;
  created_at: Date;
  updated_at: Date;
};

/** A row of trash. */
export type TrashRow = {
  id: number;
  kind: string;
  ref_id: number | null;
  name: string;
  data: unknown;
  media: number[];
  deleted_by: number | null;
  deleted_by_name: string;
  from_path: string;
  ip: string;
  deleted_at: Date;
};

/** A row of visit_events. */
export type VisitEventsRow = {
  id: number;
  session_id: string;
  visitor_id: string;
  event: string;
  label: string;
  ref: string;
  value: number;
  path: string;
  created_at: Date;
};

/** A row of visit_sessions. */
export type VisitSessionsRow = {
  id: string;
  visitor_id: string;
  started_at: Date;
  last_seen: Date;
  duration: number;
  pageviews: number;
  is_new: boolean;
  ip: string;
  country: string;
  region: string;
  city: string;
  device: string;
  os: string;
  browser: string;
  screen: string;
  lang: string;
  referrer: string;
  ref_host: string;
  source: string;
  medium: string;
  campaign: string;
  landing: string;
  exit_path: string;
  order_code: string;
  brand: string;
  model: string;
  tz: string;
  net: string;
};

/** A row of visitors. */
export type VisitorsRow = {
  id: string;
  first_seen: Date;
  last_seen: Date;
  visits: number;
  pageviews: number;
  orders: number;
  name: string;
  phone: string;
};

/** A row of warehouse_moves. */
export type WarehouseMovesRow = {
  id: number;
  product_id: number;
  from_wh: number | null;
  to_wh: number | null;
  qty: number;
  reason: string;
  ref_id: number | null;
  note: string;
  staff_id: number | null;
  created_at: Date;
};

/** A row of warehouse_stock. */
export type WarehouseStockRow = {
  warehouse_id: number;
  product_id: number;
  qty: number;
};

/** A row of warehouses. */
export type WarehousesRow = {
  id: number;
  name: string;
  address: string;
  phone: string;
  is_shop: boolean;
  active: boolean;
  sort: number;
  note: string;
  created_at: Date;
};

/** Every table's row type by table name. */
export type Tables = {
  accounts: AccountsRow;
  activity_log: ActivityLogRow;
  admin_sessions: AdminSessionsRow;
  autocalls: AutocallsRow;
  backups: BackupsRow;
  banners: BannersRow;
  blocklist: BlocklistRow;
  blog_categories: BlogCategoriesRow;
  blog_posts: BlogPostsRow;
  brands: BrandsRow;
  bundle_items: BundleItemsRow;
  categories: CategoriesRow;
  checkout_drafts: CheckoutDraftsRow;
  checkout_otps: CheckoutOtpsRow;
  cod_settlements: CodSettlementsRow;
  complaint_notes: ComplaintNotesRow;
  complaints: ComplaintsRow;
  coupons: CouponsRow;
  customer_addresses: CustomerAddressesRow;
  customer_email_otps: CustomerEmailOtpsRow;
  customer_otps: CustomerOtpsRow;
  customers: CustomersRow;
  delete_codes: DeleteCodesRow;
  email_campaigns: EmailCampaignsRow;
  email_log: EmailLogRow;
  email_subs: EmailSubsRow;
  error_log: ErrorLogRow;
  fb_comments: FbCommentsRow;
  flash_items: FlashItemsRow;
  flash_sales: FlashSalesRow;
  fraud_checks: FraudChecksRow;
  geo_blocks: GeoBlocksRow;
  gift_card_ledger: GiftCardLedgerRow;
  gift_cards: GiftCardsRow;
  home_rows: HomeRowsRow;
  ik_trash: IkTrashRow;
  integration_logs: IntegrationLogsRow;
  kit_items: KitItemsRow;
  kits: KitsRow;
  live_clicks: LiveClicksRow;
  login_history: LoginHistoryRow;
  login_lock_codes: LoginLockCodesRow;
  loyalty_ledger: LoyaltyLedgerRow;
  media: MediaRow;
  offers: OffersRow;
  order_items: OrderItemsRow;
  orders: OrdersRow;
  owner_faces: OwnerFacesRow;
  owner_passkeys: OwnerPasskeysRow;
  page_views: PageViewsRow;
  pages: PagesRow;
  payments: PaymentsRow;
  price_alerts: PriceAlertsRow;
  price_tiers: PriceTiersRow;
  product_links: ProductLinksRow;
  product_questions: ProductQuestionsRow;
  products: ProductsRow;
  purchase_items: PurchaseItemsRow;
  purchases: PurchasesRow;
  push_campaigns: PushCampaignsRow;
  push_subs: PushSubsRow;
  rate_limits: RateLimitsRow;
  recovery_codes: RecoveryCodesRow;
  redirects: RedirectsRow;
  refunds: RefundsRow;
  research_hosts: ResearchHostsRow;
  research_items: ResearchItemsRow;
  research_queue: ResearchQueueRow;
  research_sources: ResearchSourcesRow;
  return_requests: ReturnRequestsRow;
  reviews: ReviewsRow;
  search_log: SearchLogRow;
  security_events: SecurityEventsRow;
  seo_auto_log: SeoAutoLogRow;
  seo_score_history: SeoScoreHistoryRow;
  settings: SettingsRow;
  shop_push_subs: ShopPushSubsRow;
  sms_campaigns: SmsCampaignsRow;
  sms_log: SmsLogRow;
  social_posts: SocialPostsRow;
  staff: StaffRow;
  stock_alerts: StockAlertsRow;
  stock_movements: StockMovementsRow;
  suppliers: SuppliersRow;
  transactions: TransactionsRow;
  translations: TranslationsRow;
  trash: TrashRow;
  visit_events: VisitEventsRow;
  visit_sessions: VisitSessionsRow;
  visitors: VisitorsRow;
  warehouse_moves: WarehouseMovesRow;
  warehouse_stock: WarehouseStockRow;
  warehouses: WarehousesRow;
};
