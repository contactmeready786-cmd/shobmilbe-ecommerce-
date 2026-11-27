// /learn/<slug> — one lesson (text, try-it steps, quiz, AI teacher) — drawn by lib/shop/more.tsx.
import { CurrentShopPage, currentMetadata, currentViewport } from '@/lib/next/page';

export const generateMetadata = currentMetadata;
export const generateViewport = currentViewport;
export default CurrentShopPage;
