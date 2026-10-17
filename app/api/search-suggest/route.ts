// GET /api/search-suggest?q=… — instant results under the search box
import { apiRoute, otherMethods } from '@/lib/next/api';
import { searchSuggest } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(searchSuggest);
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };
