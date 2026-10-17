// TEMPORARY probe (removed after one CI run): can an App Router route handler turn React into HTML text?
import { createElement } from 'react';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { renderToStaticMarkup } = await import('react-dom/server');
    return new Response('ok:' + renderToStaticMarkup(createElement('b', { className: 'x' }, 'hi & <you>')), { headers: { 'content-type': 'text/plain' } });
  } catch (e) {
    return new Response('fail:' + (e as Error).message, { status: 500 });
  }
}
