// /account — আমার অ্যাকাউন্ট: the login page, or the customer's orders, addresses, profile, referral and gift cards —
// drawn by lib/shop/forms.tsx (the same code the original router uses); the forms themselves go to their own routes (lib/shopx.tsx).
import { CurrentShopPage, currentMetadata, currentViewport } from '@/lib/next/page';

export const generateMetadata = currentMetadata;
export const generateViewport = currentViewport;
export default CurrentShopPage;
