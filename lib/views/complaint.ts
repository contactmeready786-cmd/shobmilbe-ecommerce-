// 📮 Customer pages for complaints: the form (/complaint) and "my complaint's status" (/complaint/status).
import { createElement } from 'react';
import * as R from '../../components/shop/Complaint';
import type { Body } from '../types';

// ⚛️ moved to React (components/shop/Complaint.tsx) — same HTML, same callers; returns a React element (usable by Next.js pages too)
function complaintPage(props: Body) { return createElement(R.ComplaintPage, props as Parameters<typeof R.ComplaintPage>[0]); }
function statusPage(props: Body) { return createElement(R.StatusPage, props); }

export { complaintPage, statusPage };
