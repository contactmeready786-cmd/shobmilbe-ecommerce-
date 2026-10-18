// The admin's forms (POST), /admin/api, its files and exports, and admin addresses the Next.js admin page doesn't
// draw: proxy.ts hands them here with the address asked for (x-shop-url) — lib/next/admin-route.ts answers them.
import { adminAnswer } from '@/lib/next/admin-route';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // big exports and imports

// (the admin's own code answers every way of asking)
export { adminAnswer as GET, adminAnswer as POST, adminAnswer as PUT, adminAnswer as PATCH, adminAnswer as DELETE, adminAnswer as HEAD, adminAnswer as OPTIONS };
