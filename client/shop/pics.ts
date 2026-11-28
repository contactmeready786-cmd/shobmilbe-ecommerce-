// 🖼️ Product pictures appear sooner and never as a blank white box (owner, 2026-11-28: "pictures come late when I scroll").
//  - A picture still on its way shows a soft moving grey placeholder, so the page never looks empty or broken.
//  - The browser's own "load when near" waits until a picture is about one screen away; on a slow phone that is too
//    late. Here pictures start loading about two screens ahead, and a row of products that slides sideways
//    starts its first pictures as soon as the row comes near (the browser alone waits for each one to slide in).
const AHEAD_PX = 1600;
const ROW_FIRST = 8;

function mark(img: HTMLImageElement) {
  if (img.complete) { img.classList.add('ok'); return; }
  const done = () => img.classList.add('ok');
  img.addEventListener('load', done, { once: true });
  img.addEventListener('error', done, { once: true });
}

function eager(img: HTMLImageElement) {
  if (img.loading === 'lazy') img.loading = 'eager';
}

export function startPics() {
  const pics = () => Array.from(document.querySelectorAll<HTMLImageElement>('.card-pic img'));
  pics().forEach(mark);
  document.documentElement.classList.add('pics');
  if (!('IntersectionObserver' in window)) return;
  const near = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      near.unobserve(e.target);
      const el = e.target as HTMLElement;
      if (el instanceof HTMLImageElement) eager(el);
      else el.querySelectorAll<HTMLImageElement>('.card-pic img').forEach((img, i) => { if (i < ROW_FIRST) eager(img); });
    }
  }, { rootMargin: `${AHEAD_PX}px 0px` });
  const watch = (root: ParentNode) => {
    root.querySelectorAll<HTMLImageElement>('.card-pic img[loading="lazy"]').forEach((img) => near.observe(img));
    root.querySelectorAll<HTMLElement>('.rail').forEach((row) => near.observe(row));
  };
  watch(document);
  // cards added later (more products, search, "load more") get the same treatment
  new MutationObserver((list) => {
    for (const m of list) m.addedNodes.forEach((n) => {
      if (!(n instanceof HTMLElement)) return;
      n.querySelectorAll<HTMLImageElement>('.card-pic img').forEach(mark);
      if (n.matches('.card-pic img')) mark(n as HTMLImageElement);
      watch(n);
    });
  }).observe(document.body, { childList: true, subtree: true });
}
