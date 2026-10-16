// Types shared across the shop code.
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Every admin setting, as stored in the settings table (all values are text; a missing one is undefined). */
export type Settings = Record<string, string | undefined> & { store_name: string; session_secret: string };

/** A request as the shop code sees it (Node request, plus the body once it has been read). */
export type ShopRequest = IncomingMessage & { __body?: string; body?: unknown };
export type ShopResponse = ServerResponse;

/**
 * A parsed form or JSON body. Values come from the visitor, so every field is checked before use
 * (str(), int(), amount(), list() …). Form fields are text or, for repeated names, lists of text.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- visitor input: always run through str()/int()/list() first
export type Body = Record<string, any>;

/** A database row whose columns aren't described by a more specific type yet. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- columns vary by query
export type Row = Record<string, any>;

/** Anything that can appear inside html`...`: text (escaped), raw HTML, lists of those, or nothing. */
export type HtmlValue = string | number | bigint | boolean | null | undefined | { toString(): string } | HtmlValue[];

/** Old code that has not been given exact types yet. Searching for "Loose" finds every place still to tighten. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy: type me
export type Loose = any;
/** A row id as the code passes it around (from the database, a form or the address). */
export type Id = number | string | null | undefined;

type HeaderMap = Record<string, string | string[] | number | undefined>;
/**
 * The address's ?query. get() really returns text or null; the old code passes the value straight on in many
 * places (where null and "missing" mean the same), so it is Loose until those places are tightened.
 */
export type ShopQuery = Omit<URLSearchParams, 'get'> & { get(name: string): Loose };
/** What every request handler in lib/app.ts gets. */
export type Base = {
  req: ShopRequest; res: ShopResponse; path: string; method: string; query: ShopQuery; settings: Settings;
  send: (res: ShopResponse, status: number, body: string | Buffer, type?: string, extra?: HeaderMap) => void;
  json: (res: ShopResponse, status: number, data: unknown, extra?: HeaderMap) => void;
  redirect: (res: ShopResponse, to: string, extra?: HeaderMap) => void;
};
/** A signed-in admin user (a row of the staff table plus the session's marks). */
export type StaffUser = Row & { id: number; name: string; role: string; permissions: string[]; __session?: Loose; __token?: string; __verified?: boolean };
/** What every admin page handler gets (built in lib/admin/index.ts). */
export type AdminCtx = Base & {
  user: StaffUser; ip: string; readOnly?: boolean; __err?: string;
  can: (perm: string) => boolean;
  flash: Loose;
  body: () => Promise<Body>;
  page: (title: string, body: unknown, active?: string, opts?: { status?: number }) => void;
  back: (to: string, msgKey?: string) => void;
  fail: (to: string, text: string) => void;
  log: (action: string, entity?: string, entityId?: number | string | null, detail?: unknown) => Promise<void>;
  trash: (kind: string, id: number | string) => Promise<Loose>;
  markVerified: () => Promise<unknown>;
  newSession: (u: Loose) => Promise<string>;
  reloadSettings: () => Promise<Settings>;
};
