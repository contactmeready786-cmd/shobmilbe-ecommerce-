// GET /api/search-suggest?q=… — instant results under the search box
import { apiRoute } from '@/lib/next/api';
import { searchSuggest } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(searchSuggest);
