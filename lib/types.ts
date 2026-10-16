// Types shared across the shop code.
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Every admin setting, as stored in the settings table (all values are text; a missing one is undefined). */
export type Settings = Record<string, string | undefined> & { store_name?: string; session_secret?: string };

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
