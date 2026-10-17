// /products — all products, a category (?cat=), search (?q=), offers (?sort=offer), filters — drawn by lib/shop/router.tsx (the same code the original router uses).
import { CurrentShopPage, currentMetadata, currentViewport } from '@/lib/next/page';

export const generateMetadata = currentMetadata;
export const generateViewport = currentViewport;
export default CurrentShopPage;
