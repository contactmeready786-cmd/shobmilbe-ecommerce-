// Sample settings for the shop's page frame (tests/chrome.test.ts): every switch on, everything off, the live-score page.
/* eslint-disable @typescript-eslint/no-explicit-any -- test data */
import { raw } from '../../lib/util';

export const rich: any = { store_name: 'সবমিলবে', session_secret: 'x', site_url: 'https://shobmilbe.com', phone: '01712345678', whatsapp: '01712345678', email: 'a@b.com', address: 'ঢাকা <১>', ga4_id: 'G-XYZ', fb_pixel_id: '123', gtm_id: 'GTM-1', tiktok_pixel_id: 'TT1', chat_tawk_property: 'abc/def', chat_whatsapp_button: '1', chat_messenger_page: 'shobmilbe', header_menu: '[{"label":"অফার","url":"/products?sort=offer"},{"label":"ব্লগ & টিপস","url":"/blog"}]', footer_links: '[{"label":"নিজের লিংক","url":"/x"}]', acct_on: '1', gift_on: '1', notice: 'ফ্রি ডেলিভারি "আজ"', i18n_on: '1', live_cricket: '1', social_facebook: 'https://fb.com/x', social_youtube: 'https://yt.com/x', email_mkt_on: '1', trade_license: 'TL-1', vat_bin: 'BIN-2', custom_head: '<meta name="x" content="y">', custom_body: '<div id="cb">body code</div>', chat_script: '<script>var c=1;</script>', shoppush_on: '1', push_vapid_public: 'KEY', copy_protect: '1', grid_cols: '5', favicon_id: '9', logo_id: '' };
export const plain: unknown = { store_name: 'Shop', session_secret: 'x' };
export const cats = [{ id: 1, name: 'IC & চিপ', slug: 'ic', parent_id: null, icon: '🔌', total_count: 5, sort: 1 }, { id: 2, name: 'Op-Amp', slug: 'opamp', parent_id: 1, icon: '', total_count: 3, sort: 1 }, { id: 3, name: 'খালি', slug: 'empty', parent_id: 1, icon: '', total_count: 0, sort: 2 }];
export const pages = [{ slug: 'about', title: 'আমাদের কথা', in_footer: true }, { slug: 'x', title: 'X', in_footer: false }];
export const variants: [string, any][] = [
  ['rich', { settings: rich, title: 'Arduino "Uno" & <R3>', description: 'বিবরণ', keywords: 'a,b', body: raw('<main id="x">BODY</main>'), q: 'esp<32>', active: 'blog', canonical: '/p/uno', image: '/media/5', jsonLd: { '@type': 'Product', name: 'Uno</script>' }, type: 'product', categories: cats, pages, popup: { id: 4, link: 'javascript:alert(1)', image_id: 7, title: 'অফার "১"' }, track: { e: 'view' } }],
  ['plain', { settings: plain, title: '', body: raw('<p>x</p>'), categories: [], pages: [] }],
  ['live', { settings: { ...rich, i18n_on: '0', notice: '', live_football: '1' }, title: 'Live', body: raw(''), active: 'live', categories: cats, pages: [], noindex: true }],
];
