// Customer side: "আমার অ্যাকাউন্ট" (login with e-mail or mobile + a one-time code, my orders, addresses, profile, referral, gift cards),
// the return / refund request form, and the gift card page.
import { createElement } from 'react';
import * as R from '../../components/shop/Account';
import type { Body } from '../types';

function maskPhone(p?: unknown) { const s = String(p || ''); return s.length > 6 ? s.slice(0, 3) + '•'.repeat(s.length - 6) + s.slice(-3) : '•••'; }

// ⚛️ moved to React (components/shop/Account.tsx) — same HTML, same callers; returns a React element (usable by Next.js pages too)
function loginPage(props: Parameters<typeof R.LoginPage>[0]) { return createElement(R.LoginPage, props); }
function dashboard(props: Parameters<typeof R.Dashboard>[0]) { return createElement(R.Dashboard, props); }
function returnForm(props: Parameters<typeof R.ReturnForm>[0]) { return createElement(R.ReturnForm, props); }
function giftPage(props: Parameters<typeof R.GiftPage>[0]) { return createElement(R.GiftPage, props); }
const { REASONS, WANTS, RETURN_LABELS } = R;

export { loginPage, dashboard, returnForm, giftPage, REASONS, WANTS, RETURN_LABELS, maskPhone };
