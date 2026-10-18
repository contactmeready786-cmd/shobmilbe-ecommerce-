// /track?code=…&phone=… (opens an order on this browser; counts tries) — lib/shopx.tsx (track).
// The address has a Next.js page too, so proxy.ts hands these requests here; the address the visitor asked for
// comes with them (x-shop-url), and anything else that arrives here is answered with the shop's 404 page.
import { formRoute } from '@/lib/next/shop-form';
import { track } from '@/lib/shopx';

export const dynamic = 'force-dynamic';
const handle = formRoute(track);
// (the original code answered every way of asking with the same handler)
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };
