// /order/<code>/edit — the customer changes their own order (a form) — lib/shopx.tsx (orderSelf).
import { formRoute } from '@/lib/next/shop-form';
import { orderSelf } from '@/lib/shopx';

export const dynamic = 'force-dynamic';
const handle = formRoute(orderSelf);
// (the original code answered every way of asking with the same handler)
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };
