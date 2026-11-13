// 📍 "আমার লোকেশন দিয়ে ঠিকানা বসান" (owner, 2026-11-13): the checkout page sends the place the customer's phone gave —
// only after the customer pressed the button and allowed it — and gets back a readable address (road, area, city) and
// the district, from OpenStreetMap (free; asked by the shop's server, a few times a minute at most, answers kept).
// Nothing is saved here: the place is saved with the order only when the customer places it.
import GEO from '../data/bd-geo.json';
import { fetchJson } from '../util';
import { allow, json, tooMany, type ApiCtx } from '../next/api';

/** inside Bangladesh (a little margin)? */
export function inBangladesh(lat: number, lng: number) { return lat >= 20.3 && lat <= 26.8 && lng >= 87.9 && lng <= 92.8; }
export function cleanPoint(latIn: unknown, lngIn: unknown, accIn?: unknown): { lat: number; lng: number; acc: number } | null {
  const lat = Number(latIn), lng = Number(lngIn);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inBangladesh(lat, lng)) return null;
  const acc = Math.round(Number(accIn));
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, acc: Number.isFinite(acc) && acc > 0 ? Math.min(acc, 100000) : 0 };
}

type Osm = { address?: Record<string, string>; display_name?: string };
/** the address line and the district (as in the shop's own list) from OpenStreetMap's answer */
export function readOsm(o: Osm): { address: string; district: string } {
  const a = o.address || {};
  const parts = [a.house_number, a.road || a.pedestrian || a.footway, a.neighbourhood || a.quarter, a.suburb || a.village || a.hamlet, a.city_district || a.town || a.municipality, a.city]
    .map((x) => String(x || '').trim()).filter(Boolean);
  const address = [...new Set(parts)].join(', ').slice(0, 300);
  const hay = [a.state_district, a.county, a.city, a.town, a.state].map((x) => String(x || '').toLowerCase().replace(/\b(district|division|city|zila|metropolitan)\b/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const names = (GEO as unknown as { districts: { en: string }[] }).districts.map((d) => d.en);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  let district = '';
  for (const h of hay) { const hit = names.find((n) => norm(n) === norm(h)); if (hit) { district = hit; break; } }
  return { address, district };
}

const kept = new Map<string, { at: number; v: { address: string; district: string } }>();
export async function geoReverse(ctx: ApiCtx) {
  if (!(await allow(ctx, 'geo:', 12, 600))) return tooMany(ctx);
  const b = await ctx.body();
  const p = cleanPoint(b.lat, b.lng);
  if (!p) return json(400, { error: 'লোকেশনটা বাংলাদেশের বাইরে বা ঠিক নেই।' });
  const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`; // ~11 m
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600e3) return json(200, hit.v);
  const r = await fetchJson<Osm>(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=en&lat=${p.lat}&lon=${p.lng}`,
    { headers: { 'User-Agent': 'shobmilbe.com checkout (support@shobmilbe.com)' } }, 7000);
  if (!r.ok || !r.data) return json(200, { address: '', district: '' }); // the place itself is still kept with the order
  const v = readOsm(r.data);
  if (kept.size > 2000) kept.clear();
  kept.set(key, { at: Date.now(), v });
  return json(200, v);
}
