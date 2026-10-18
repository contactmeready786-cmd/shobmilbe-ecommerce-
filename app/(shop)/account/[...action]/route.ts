// /account/… — the account's forms (log in by SMS or e-mail code, e-mail + password, profile, addresses, log out) and
// any other address under /account/ — lib/shopx.tsx (account). /account itself is the Next.js page next to this.
import { formRoute } from '@/lib/next/shop-form';
import { account } from '@/lib/shopx';

export const dynamic = 'force-dynamic';
const handle = formRoute(account);
// (the original code answered every way of asking with the same handler)
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };
