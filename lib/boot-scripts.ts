// The few tiny scripts that must sit inside the page itself, because they run before the page is drawn
// (so the visitor never sees a flash of the wrong language or menu) — everything else is in client/ as modules.
// Written once here; the shop frame, the admin frames and the country-lock pages use them.

/** Shop <head>: the visitor's language (?lang= in the link, or the one they chose before) before the page shows. */
export const shopLangBoot = (def: 'bn' | 'en'): string =>
  `(()=>{const d=document.documentElement;let l=${JSON.stringify(def)};try{const q=/[?&]lang=(en|bn)(?:&|$)/.exec(location.search);if(q){l=q[1];localStorage.setItem('sm_lang',l);}else{l=localStorage.getItem('sm_lang')||l;}}catch{}d.setAttribute('data-lang',l);if(l==='en'){d.lang='en';d.classList.add('i18n-wait');setTimeout(()=>d.classList.remove('i18n-wait'),1200);}})();`;

/** Admin <head>: English chosen on this device → hide the page until the words are switched (no Bangla flash). */
export const adminLangBoot = "(()=>{try{if(localStorage.getItem('sm_admin_lang')==='en'){const d=document.documentElement;d.classList.add('admin-i18n-wait');d.setAttribute('data-admin-lang','en');}}catch{}})();";

/** Admin body start: the side menu stays hidden on a big screen when the owner hid it. */
export const adminSideBoot = "try{if(localStorage.getItem('sm_side_hidden')==='1')document.body.classList.add('side-hidden')}catch{}";

/** Tawk.to live chat (Admin → সোশ্যাল ও লাইভ চ্যাট). */
export const tawkLoader = (property: string, widget: string): string =>
  `window.Tawk_API=window.Tawk_API||{};(()=>{const s=document.createElement('script');s.async=true;s.src=${JSON.stringify(`https://embed.tawk.to/${encodeURI(property)}/${encodeURI(widget || 'default')}`)};s.charset='UTF-8';s.setAttribute('crossorigin','*');document.head.appendChild(s);})();`;
