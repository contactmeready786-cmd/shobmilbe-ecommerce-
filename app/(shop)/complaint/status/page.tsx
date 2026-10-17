// /complaint/status — look up a complaint — drawn by lib/shop/forms.tsx (the same code the original router uses); the form itself is sent to lib/shopx.ts.
import { CurrentShopPage, currentMetadata, currentViewport } from '@/lib/next/page';

export const generateMetadata = currentMetadata;
export const generateViewport = currentViewport;
export default CurrentShopPage;
