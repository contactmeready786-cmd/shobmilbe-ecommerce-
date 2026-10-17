// Customer side: "আমার অ্যাকাউন্ট" (login with e-mail or mobile + a one-time code, my orders, addresses, profile, referral, gift cards),
// the return / refund request form, and the gift card page.
import { createElement } from 'react';
import { toHtml } from '../react/render';
import * as R from '../../components/shop/Account';
import type { Body, Loose } from '../types';

function maskPhone(p?: Loose) { const s = String(p || ''); return s.length > 6 ? s.slice(0, 3) + '•'.repeat(s.length - 6) + s.slice(-3) : '•••'; }

// ⚛️ moved to React (components/shop/Account.tsx) — same HTML, same callers
function loginPage(props: Body) { return toHtml(createElement(R.LoginPage, props)); }
function dashboard(props: Body) { return toHtml(createElement(R.Dashboard, props as Parameters<typeof R.Dashboard>[0])); }
function returnForm(props: Body) { return toHtml(createElement(R.ReturnForm, props as Parameters<typeof R.ReturnForm>[0])); }
function giftPage(props: Body) { return toHtml(createElement(R.GiftPage, props as Parameters<typeof R.GiftPage>[0])); }
const { REASONS, WANTS, RETURN_LABELS } = R;

export { loginPage, dashboard, returnForm, giftPage, REASONS, WANTS, RETURN_LABELS, maskPhone };
