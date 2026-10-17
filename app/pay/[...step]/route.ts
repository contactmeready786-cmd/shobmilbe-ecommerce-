// /pay/<order code>, /pay/bkash/callback, /pay/ssl/success|fail|cancel|ipn — online payment (lib/api/payments.ts)
import { apiRoute } from '@/lib/next/api';
import { pay } from '@/lib/api/payments';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const answer = apiRoute(pay);
export { answer as GET, answer as POST, answer as PUT, answer as PATCH, answer as DELETE, answer as OPTIONS, answer as HEAD };
