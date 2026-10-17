// /kit/<slug> — one project kit (parts list and steps) — drawn by lib/shop/more.tsx (the same code the original router uses).
import { CurrentShopPage, currentMetadata, currentViewport } from '@/lib/next/page';

export const generateMetadata = currentMetadata;
export const generateViewport = currentViewport;
export default CurrentShopPage;
