// A shop address that leads nowhere (an article or page that is gone): the shop's own "not found" page.
// (Its title — "পাওয়া যায়নি" — and noindex come from the page's generateMetadata.)
import { NotFound } from '@/components/shop/Pages';

export default function ShopNotFound() {
  return <NotFound />;
}
