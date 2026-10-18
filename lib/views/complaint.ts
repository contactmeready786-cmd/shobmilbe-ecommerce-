// 📮 Customer pages for complaints: the form (/complaint) and "my complaint's status" (/complaint/status).
import { createElement } from 'react';
import * as R from '../../components/shop/Complaint';
import type { Body } from '../types';

// ⚛️ moved to React (components/shop/Complaint.tsx) — same HTML, same callers; returns a React element (usable by Next.js pages too)
function complaintPage(props: Parameters<typeof R.ComplaintPage>[0]) { return createElement(R.ComplaintPage, props); }
function statusPage(props: Parameters<typeof R.StatusPage>[0]) { return createElement(R.StatusPage, props); }

export { complaintPage, statusPage };
