// District / thana drop-downs (checkout, account addresses, the admin's order form).
import { h, paint } from '../jsx.js';
import { $, loadGeo } from '../dom.js';

export type GeoBoxes = { district: HTMLSelectElement; thana: HTMLSelectElement };

/** labels: the empty thana choice — [district picked, no district yet] (the admin's order form says it shorter) */
export async function fillGeo(form: ParentNode, labels: [string, string] = ['থানা / উপজেলা বাছুন', 'আগে জেলা বাছুন']): Promise<GeoBoxes | null> {
  const dSel = $<HTMLSelectElement>('[data-district]', form);
  const tSel = $<HTMLSelectElement>('[data-thana]', form);
  if (!dSel || !tSel) return null;
  const geo = (await loadGeo()).districts;
  const want = dSel.getAttribute('data-value') || '';
  paint(dSel, <option value="">জেলা বাছুন</option>, geo.map((d) => <option value={d.en} selected={d.en === want}>{d.bn} ({d.en})</option>));
  const fillThana = (selected: string) => {
    const d = geo.find((x) => x.en === dSel.value);
    paint(tSel, <option value="">{d ? labels[0] : labels[1]}</option>,
      d ? d.areas.map((a) => <option value={a[0]} selected={a[0] === selected}>{a[1]}</option>) : null);
  };
  fillThana(tSel.getAttribute('data-value') || '');
  dSel.addEventListener('change', () => fillThana(''));
  return { district: dSel, thana: tSel };
}
