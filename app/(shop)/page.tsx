// / — the home page (rows of products, categories, banners, the owner's own rows) — drawn by lib/shop/router.tsx (the same code the original router uses).
import { CurrentShopPage, currentMetadata, currentViewport } from '@/lib/next/page';

export const generateMetadata = currentMetadata;
export const generateViewport = currentViewport;
export default CurrentShopPage;
