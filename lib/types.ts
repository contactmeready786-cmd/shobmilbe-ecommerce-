// Types shared across the shop code.
import type { Reply, HeaderMap, ReplyBody } from './reply';
import type { Flash } from './admin/ui';

/** Every admin setting, as stored in the settings table (all values are text; a missing one is undefined). */
export type Settings = Record<string, string | undefined> & { store_name: string; session_secret: string };

/** A request as the shop code sees it: the visitor's headers (lower-case names), the address asked for, the method,
 * the connection it came from and the body text (read once from the Web Request; parseBody in lib/util reads it). */
export type ShopRequest = {
  headers: Record<string, string | undefined>;
  url?: string;
  method?: string;
  socket?: { remoteAddress?: string } | null;
  __body?: string;
};
export type { Reply } from './reply';

/**
 * A parsed form or JSON body. Values come from the visitor, so every field is checked before use
 * (str(), int(), amount(), list() …). Form fields are text or, for repeated names, lists of text.
 */
export type Body = Record<string, unknown>;
/** A sent HTML form: the named fields are text when present (an input sends its value as text); others stay unknown. */
export type Form<K extends string = never> = Body & Partial<Record<K, string>>;

/** A database row whose columns aren't described by a more specific type yet. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- columns vary by query
export type Row = Record<string, any>;


/** Old code that has not been given exact types yet. Searching for "Loose" finds every place still to tighten. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy: type me
export type Loose = any;
// What some admin pages save as JSON in the settings (read with db.jsonSetting<…>)
/** Admin → মেনু: one header menu button or footer link */
export type MenuLink = { label: string; url: string; on?: boolean };
/** a file a search engine or another service asks for, to check the shop is ours */
export type VerificationFile = { path: string; content: string };
/** Admin → পিক্সেল ও ট্র্যাকিং → "যেকোনো স্ক্রিপ্ট বসান" */
export type CustomScript = { name?: string; place: 'head' | 'body' | string; code: string; on?: boolean };
/** What a `catch` receives: an Error (with the database's or a network's `code` when they set one). */
export type Caught = Error & { code?: string; status?: number };
/** A row id as the code passes it around (from the database, a form or the address). */
export type Id = number | string | null | undefined;

/** The address's ?query: get() gives the text or null (oneOf / ifKey in lib/util pick from allowed words). */
export type ShopQuery = URLSearchParams;
/** What every form, admin and fallback handler gets (lib/site.ts, lib/next/admin.ts). */
export type Base = {
  req: ShopRequest; reply: Reply; path: string; method: string; query: ShopQuery; settings: Settings;
  /** a page or text answer (with the shop's security headers) */
  send: (status: number, body: ReplyBody, type?: string, extra?: HeaderMap) => void;
  json: (status: number, data: unknown, extra?: HeaderMap) => void;
  /** 303 to another address */
  redirect: (to: string, extra?: HeaderMap) => void;
  /** Next.js admin pages: receives an admin page's pieces instead of the finished page (lib/next/admin.ts). */
  drawPage?: (p: AdminDrawn) => void;
};
/** An admin page's pieces: the frame around it (bare = no menu) and what goes inside. */
export type AdminDrawn = { bare?: boolean; settings: Settings; user?: StaffUser; title: unknown; body: unknown; active?: string; readOnly?: boolean; path?: string; status: number };
/** A signed-in admin user (a row of the staff table plus the session's marks). */
// (columns: id, name, username, role, permissions[], active …; plus __session, __token, __verified from the login)
export type StaffUser = Row & { id: number; name: string; username: string; role: string; permissions: string[] | null; active: boolean };
/** The parts of the address an admin route matched: [whole path, ...the regex's groups] (lib/admin/index.tsx). */
export type RouteMatch = string[];
/** one admin address a module answers */
export type AdminRoute = { method: string; path: string | RegExp; perm?: string | ((ctx: AdminCtx) => string); handler: (ctx: AdminCtx, m: RouteMatch) => unknown };
/** What every admin page handler gets (built in lib/admin/index.ts). */
export type AdminCtx = Base & {
  user: StaffUser; ip: string; readOnly?: boolean; __err?: string;
  can: (perm: string) => boolean;
  flash: Flash | null;
  /** the sent form; the fields named in K are read as text (what an HTML form sends for one field) */
  body: <K extends string = never>() => Promise<Form<K>>;
  page: (title: string, body: unknown, active?: string, opts?: { status?: number }) => void;
  back: (to: string, msgKey?: string) => void;
  fail: (to: string, text: string) => void;
  log: (action: string, entity?: string, entityId?: number | string | null, detail?: unknown) => Promise<void>;
  trash: (kind: string, id: number | string) => Promise<Loose>;
  markVerified: () => Promise<unknown>;
  newSession: (u: StaffUser) => Promise<string>;
  reloadSettings: () => Promise<Settings>;
};
