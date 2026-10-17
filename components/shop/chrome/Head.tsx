// ⚛️ What goes in every shop page's <head> besides the title/description tags (those come from lib/next/meta.ts):
// the visitor-clock country check, fonts and the shop's style sheet with its two colours, the Bangla/English
// start-up, page data for Google (JSON-LD), the tracking tags (Google, Facebook, TikTok) and the owner's own head code.
import * as $services_imagekit from '../../../lib/services/imagekit';
import * as $services_geolock from '../../../lib/services/geolock';
import { HeadHtml } from '../../../lib/react/head-html';
import type { Settings } from '../../../lib/types';
import { ASSET_V, customScripts } from './Chrome';

const inline = (code: string, key?: string) => <script key={key} dangerouslySetInnerHTML={{ __html: code }} />;

export function colors(s: Settings) {
  const primary = /^#[0-9a-f]{6}$/i.test(s.color_primary || '') ? s.color_primary! : '#0866D6';
  const accent = /^#[0-9a-f]{6}$/i.test(s.color_accent || '') ? s.color_accent! : '#F5A524';
  return { primary, accent };
}

/** Google / Facebook / TikTok tags, in the order they must load. */
function Tracking({ s }: { s: Settings }) {
  const out = [];
  // Google consent mode: this shop sells in Bangladesh (no EU cookie-consent rule), so measurement is allowed by default.
  // Without this, Google's tag can start in "denied" mode and GA4/Ads count almost nothing.
  if (s.gtm_id || s.ga4_id) out.push(inline("window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{ad_storage:'granted',analytics_storage:'granted',ad_user_data:'granted',ad_personalization:'granted'});", 'consent'));
  if (s.gtm_id) out.push(inline(`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(s.gtm_id)});`, 'gtm'));
  if (s.ga4_id) {
    out.push(<script key="ga4src" async src={`https://www.googletagmanager.com/gtag/js?id=${s.ga4_id}`}></script>);
    out.push(inline(`gtag('js',new Date());gtag('config',${JSON.stringify(s.ga4_id)});`, 'ga4'));
  }
  if (s.fb_pixel_id) out.push(inline(`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(s.fb_pixel_id)});fbq('track','PageView');`, 'fb'));
  if (s.tiktok_pixel_id) out.push(inline(`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};ttq.load(${JSON.stringify(s.tiktok_pixel_id)});ttq.page();}(window,document,'ttq');`, 'tt'));
  return <>{out}</>;
}

// বাংলা / English: before the page is drawn, pick the visitor's language (their last choice, a ?lang= link,
// or the shop's default). An English visitor's page stays invisible for the split second it takes to switch,
// so Bangla never flashes (at most 1.2 s, then it shows anyway).
function LangBoot({ s }: { s: Settings }) {
  const def = s.i18n_default === 'en' ? 'en' : 'bn';
  return (
    <>
      {inline(`(function(){var d=document.documentElement,l=${JSON.stringify(def)};try{var q=/[?&]lang=(en|bn)(?:&|$)/.exec(location.search);if(q){l=q[1];localStorage.setItem('sm_lang',l);}else{l=localStorage.getItem('sm_lang')||l;}}catch(e){}d.setAttribute('data-lang',l);if(l==='en'){d.lang='en';d.className+=' i18n-wait';setTimeout(function(){d.className=d.className.replace(' i18n-wait','');},1200);}})();`)}
      <style dangerouslySetInnerHTML={{ __html: 'html.i18n-wait body{visibility:hidden}' }} />
    </>
  );
}

/** Data for Google about this page (product, article, shop …). */
export function JsonLd({ data }: { data: unknown[] }) {
  return <>{data.filter(Boolean).map((j, i) => <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(j).replace(/</g, '\\u003c') }} />)}</>;
}

/** Everything in <head> except the tags Next.js writes from the page's metadata. */
function imageOrigin(): string {
  try { return $services_imagekit.configured() ? new URL($services_imagekit.endpoint()).origin : ''; } catch { return ''; }
}

export function ShopHeadExtras({ settings: s }: { settings: Settings }) {
  const { primary, accent } = colors(s);
  const tz = $services_geolock.headScript(s).replace(/^<script>|<\/script>$/g, '');
  // the product pictures come from ImageKit: the browser opens that connection while the page is still arriving
  const ik = imageOrigin();
  return (
    <>
      {tz ? inline(tz) : null}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      {ik ? <link rel="preconnect" href={ik} /> : null}
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <link rel="stylesheet" href={`/css/style.css?v=${ASSET_V}`} />
      <style dangerouslySetInnerHTML={{ __html: `:root{--blue:${primary};--amber:${accent}}` }} />
      {s.i18n_on === '1' ? <LangBoot s={s} /> : null}
      <Tracking s={s} />
      <HeadHtml html={(s.custom_head || '') + customScripts(s, 'head')} />
    </>
  );
}
