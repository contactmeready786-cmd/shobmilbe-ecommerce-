// 📮 What the shop answers one request with: a status, headers and a body, handed to Next.js as a standard Web
// Response. Every form, admin file and fallback handler gets one (ctx.reply) and answers once — through ctx.send /
// ctx.json / ctx.redirect, or reply.answer() for a file. Headers given with the answer replace the same headers set
// earlier with reply.header() (so a page's own Set-Cookie wins over one set before it).
export type HeaderValue = string | number | readonly string[];
export type HeaderMap = Record<string, HeaderValue | undefined>;
export type ReplyBody = string | Buffer | Uint8Array | null | undefined;

export class Reply {
  status = 200;
  answered = false;
  private headers = new Map<string, { name: string; value: HeaderValue }>();
  private body: Uint8Array | null = null;
  private finish!: () => void;
  /** Settles once the request has been answered. */
  readonly done = new Promise<void>((resolve) => { this.finish = resolve; });

  /** Sets one header before the answer (the answer's own headers replace it). */
  header(name: string, value: HeaderValue): this {
    this.headers.set(name.toLowerCase(), { name, value });
    return this;
  }

  /** The answer itself: status, headers and (optionally) the body. Only the first answer counts. */
  answer(status: number, headers: HeaderMap = {}, body?: ReplyBody): void {
    if (this.answered) {
      console.error('reply: answered twice — the first answer stands', status);
      return;
    }
    this.status = status;
    for (const [k, v] of Object.entries(headers)) if (v !== undefined) this.header(k, v);
    if (body !== undefined && body !== null && body !== '') this.body = typeof body === 'string' ? Buffer.from(body) : body;
    this.answered = true;
    this.finish();
  }

  /** What was set so far for a header (undefined if not set). */
  get(name: string): HeaderValue | undefined { return this.headers.get(name.toLowerCase())?.value; }

  toResponse(): Response {
    const h = new Headers();
    for (const { name, value } of this.headers.values()) {
      if (Array.isArray(value)) for (const v of value) h.append(name, String(v));
      else h.set(name, String(value));
    }
    const noBody = this.status === 204 || this.status === 304 || this.status < 200;
    return new Response(noBody ? null : new Uint8Array(this.body || new Uint8Array(0)), { status: this.status, headers: h });
  }
}
