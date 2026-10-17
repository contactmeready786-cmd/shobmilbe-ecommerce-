// 📮 Customer pages for complaints: the form (/complaint) and "my complaint's status" (/complaint/status).
import { createElement } from 'react';
import { toHtml } from '../react/render';
import * as R from '../../components/shop/Complaint';
import type { Body } from '../types';

// ⚛️ moved to React (components/shop/Complaint.tsx) — same HTML, same callers
function complaintPage(props: Body) { return toHtml(createElement(R.ComplaintPage, props as Parameters<typeof R.ComplaintPage>[0])); }
function statusPage(props: Body) { return toHtml(createElement(R.StatusPage, props)); }

export { complaintPage, statusPage };
