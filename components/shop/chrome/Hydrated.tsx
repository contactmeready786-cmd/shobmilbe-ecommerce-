'use client';
// Tells the shop's own scripts (client/shop, client/i18n) that React has finished taking over the page, so they can
// start changing it (cart count, gallery, language) without React finding something it didn't draw.
import { useEffect } from 'react';

declare global { interface Window { __smHydrated?: boolean } }

export function Hydrated() {
  useEffect(() => {
    window.__smHydrated = true;
    window.dispatchEvent(new Event('sm:hydrated'));
  }, []);
  return null;
}
