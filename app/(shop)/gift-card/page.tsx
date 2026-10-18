// /gift-card — buy a gift card — drawn by lib/shop/forms.tsx (the same code the original router uses); the form itself goes to its own route (lib/shopx.tsx).
import { CurrentShopPage, currentMetadata, currentViewport } from '@/lib/next/page';

export const generateMetadata = currentMetadata;
export const generateViewport = currentViewport;
export default CurrentShopPage;
