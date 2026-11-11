'use strict';
/*
 * Module 6 — Intelligent Application Pre-review and Notification.
 * Owner: Zhou Xinyue. Kept in its own file so module 6 can be reviewed and
 * merged on its own; app.js only calls applicationNav / applicationsPage /
 * bindApplicationsPage / mountModule6 / clearApplicationsView.
 */

const APP_STATUS_LABEL = {
    needs_fix: 'Correction Required',
    pre_checked: 'Awaiting Staff Review',
    approved: 'Approved',
    rejected: 'Rejected',
    returned: 'Returned for Correction',
    withdrawn: 'Withdrawn'
};
const APP_STATUS_CLASS = {
    needs_fix: 'orange',
    pre_checked: 'blue',
    approved: 'green',
    rejected: 'red',
    returned: 'orange',
    withdrawn: ''
};
const APP_LEVEL_LABEL = { error: 'Required Item', warning: 'Staff Confirmation', info: 'Passed' };
const APP_EVENT_LABEL = {
    submitted: 'Application Submitted',
    resubmitted: 'Corrections Resubmitted',
    approved: 'Approved by Staff',
    rejected: 'Rejected by Staff',
    returned: 'Returned for Correction',
    withdrawn: 'Withdrawn by Applicant'
};
const APP_ACCEPT = 'image/jpeg,image/png,application/pdf';

let appView = { status: '', type: '', q: '', page: 1, catalog: null, total: 0 };
let appRequest = 0;
let appForm = null;

function clearApplicationsView() {
    appView = { status: '', type: '', q: '', page: 1, catalog: null, total: 0 };
    appForm = null;
    appRequest++;
}

function applicationNav(user) {
    if (user.role === 'technician') return [];
    return [['applications', 'file', user.role === 'admin' ? 'Application Review' : 'Application Pre-review']];
}

const appBadge = s => `<span class="badge ${APP_STATUS_CLASS[s] || ''}">${APP_STATUS_LABEL[s] || esc(s)}</span>`;

function scoreBar(score) {
    const tone = score >= 85 ? '#83ac8d' : score >= 60 ? '#d3ac69' : '#bb6558';
    return `<div class="m6-score"><span class="m6-score-value">${score}<i>%</i></span><span class="m6-score-track"><i style="width:${score}%;background:${tone}"></i></span></div>`;
}

function issueTags(a) {
    const tags = [];
    if (a.errors) tags.push(`<span class="m6-tag red">${a.errors} required</span>`);
    if (a.warnings) tags.push(`<span class="m6-tag orange">${a.warnings} advisory</span>`);
    if (!tags.length) tags.push('<span class="m6-tag green">No Issues</span>');
    return tags.join(' ');
}

/* ------------------------------------------------------------------ page */

function applicationsPage() {
    const admin = state.user.role === 'admin';
    const action = admin ? '' : `<button class="btn" id="app-new">${icon('plus')} New Application</button>`;
    const catalog = appView.catalog || { types: [] };
    return head(
        admin ? 'Application Review' : 'Certificate and Exam Applications',
        admin
            ? 'Use the pre-review findings as evidence, then make the final decision. Every result is traceable.'
            : 'Check requirements and materials before submission, with clear explanations for every issue.',
        action
    ) + `<div class="stats" id="app-stats"></div>
    <div class="notice m6-note">${icon('spark')} Pre-review checks deterministic rules such as required fields, file formats, dates, and duplicate requests. It does not verify authenticity or replace staff review.</div>
    <form class="toolbar" id="app-search-form">
        <input id="app-search" placeholder="Search by reference, applicant, or content" value="${esc(appView.q)}" aria-label="Search applications">
        <select id="app-status" aria-label="Filter by status"><option value="">All Statuses</option>${Object.entries(APP_STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${appView.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select id="app-type" aria-label="Filter by type"><option value="">All Types</option>${catalog.types.map(t => `<option value="${t.id}" ${appView.type === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        <button class="btn secondary" type="submit">Search</button>
    </form>
    <div class="card table-wrap"><table>
        <thead><tr><th>Application</th>${admin ? '<th>Applicant</th>' : ''}<th>Completeness</th><th>Pre-review</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody id="app-rows"><tr><td colspan="${admin ? 6 : 5}" class="muted">Loading applications…</td></tr></tbody>
    </table></div>
    <div class="flex between" style="margin-top:16px">
        <span class="subtitle" id="app-total"></span>
        <div class="flex"><button class="btn secondary" id="app-prev">Previous</button><button class="btn secondary" id="app-next">Next</button></div>
    </div>`;
}

function renderAppStats(summary) {
    const host = $('#app-stats');
    if (!host || !summary) return;
    const admin = state.user.role === 'admin';
    const cards = admin
        ? [
            ['Awaiting Staff Review', summary.waiting_queue || 0, 'clock', 'Pre-review passed'],
            ['Approved', summary.approved || 0, 'check', 'Completed applications'],
            ['Returned', summary.returned || 0, 'ticket', 'Applicant action required'],
            ['Oldest Wait', summary.oldest_wait_hours === null || summary.oldest_wait_hours === undefined ? '—' : summary.oldest_wait_hours + ' hours', 'chart', 'Oldest request in the queue']
        ]
        : [
            ['Action Required', summary.action_needed || 0, 'clock', 'Correction or resubmission needed'],
            ['Under Review', summary.waiting || 0, 'ticket', 'Forwarded to staff'],
            ['Approved', summary.approved || 0, 'check', 'Completed applications'],
            ['Unread Notices', summary.unread || 0, 'bell', 'Pre-review and staff decisions']
        ];
    host.innerHTML = cards.map(([label, value, ico, foot]) => `<div class="stat"><div class="stat-top">${label}<span class="stat-icon">${icon(ico)}</span></div><div class="stat-value">${esc(value)}</div><div class="stat-foot">${foot}</div></div>`).join('');
}

function bindApplicationsPage() {
    $('#app-search-form').onsubmit = e => {
        e.preventDefault();
        appView.q = $('#app-search').value;
        appView.status = $('#app-status').value;
        appView.type = $('#app-type').value;
        appView.page = 1;
        loadApplications();
    };
    $('#app-prev').onclick = () => { appView.page--; loadApplications(); };
    $('#app-next').onclick = () => { appView.page++; loadApplications(); };
    $('#app-new')?.addEventListener('click', () => applicationForm());
    loadApplications();
}

async function loadApplications() {
    const request = ++appRequest;
    const body = $('#app-rows');
    if (!body) return;
    body.innerHTML = `<tr><td colspan="6" class="muted">Loading applications…</td></tr>`;
    try {
        const data = await api('/applications?' + new URLSearchParams(appView));
        if (request !== appRequest || !document.body.contains(body)) return;
        appView.catalog = data.catalog;
        const typeSelect = $('#app-type');
        if (typeSelect && typeSelect.options.length <= 1) {
            typeSelect.insertAdjacentHTML('beforeend', data.catalog.types.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join(''));
            typeSelect.value = appView.type;
        }
        appView.page = data.page;
        appView.total = data.total;
        renderAppStats(data.summary);
        const admin = state.user.role === 'admin';
        const span = admin ? 6 : 5;
        body.innerHTML = data.applications.map(a => `<tr>
            <td><button class="linkbtn" style="font-size:13px;text-align:left" data-app="${a.id}"><strong>${esc(a.type_name)}</strong></button>
                <div class="mono muted" style="margin-top:5px">${a.id}${a.demo ? ' · Demo' : ''}</div></td>
            ${admin ? `<td>${esc(a.applicant_name)}<div class="small muted">${esc(a.applicant_identity || '')} · ${esc(a.applicant)}</div></td>` : ''}
            <td>${scoreBar(a.score)}</td>
            <td>${issueTags(a)}</td>
            <td>${appBadge(a.status)}<div class="tiny muted" style="margin-top:5px">${esc(a.sla || '')}</div></td>
            <td class="small muted">${date(a.updated)}</td>
        </tr>`).join('') || `<tr><td colspan="${span}" class="empty">${admin ? 'No applications match these filters.' : 'No applications yet. Select New Application to begin.'}</td></tr>`;
        body.querySelectorAll('[data-app]').forEach(b => b.onclick = () => openApplication(b.dataset.app));
        const pages = Math.max(1, Math.ceil(data.total / data.page_size));
        $('#app-total').textContent = `${data.total} application(s) · Page ${data.page} of ${pages}`;
        $('#app-prev').disabled = data.page <= 1;
        $('#app-next').disabled = data.page >= pages;
    } catch (e) {
        if (document.body.contains(body)) {
            body.innerHTML = `<tr><td colspan="6" class="empty">Unable to load applications: ${esc(e.message)}</td></tr>`;
        }
    }
}

/* ---------------------------------------------------------------- detail */

function fieldChecks(report) {
    const map = {};
    (report.checks || []).forEach(c => {
        const [kind, key] = c.code.split(':');
        if (key && ['FIELD_OK', 'FIELD_REQUIRED', 'FIELD_FORMAT', 'FIELD_MIN', 'FIELD_LENGTH', 'FIELD_RANGE', 'FIELD_PAST', 'FIELD_OPTION', 'FIELD_MISMATCH'].includes(kind)) {
            map[key] = c;
        }
    });
    return map;
}

function fieldsHTML(a) {
    const checks = fieldChecks(a.report || {});
    const type = a.catalog_type || {};
    return `<div class="m6-fields">${(type.fields || []).map(f => {
        const value = a.fields[f.key];
        const check = checks[f.key];
        const state = !check ? '' : check.ok ? 'ok' : check.level === 'error' ? 'bad' : 'warn';
        return `<div class="m6-field ${state}">
            <div class="m6-field-label">${esc(f.label)}${check ? `<span class="m6-flag ${state}" title="${esc(check.message || 'Passed')}">${state === 'ok' ? '✓' : '!'}</span>` : ''}</div>
            <div class="m6-field-value">${value === undefined || value === '' ? '<span class="muted">Not provided</span>' : esc(value)}</div>
            ${check && !check.ok ? `<div class="m6-field-fix">${esc(check.message)}</div>` : ''}
        </div>`;
    }).join('')}</div>`;
}

function checksHTML(report) {
    const checks = report.checks || [];
    const failed = checks.filter(c => !c.ok);
    const passed = checks.filter(c => c.ok);
    return `<div class="m6-checks">${failed.map(c => `<div class="m6-check ${c.level}">
        <span class="m6-mark">${c.level === 'error' ? '!' : '?'}</span>
        <div><strong>${esc(c.label)}</strong><p>${esc(c.message)}</p>${c.fix ? `<p class="m6-fix">Suggested action: ${esc(c.fix)}</p>` : ''}</div>
    </div>`).join('') || '<div class="m6-check ok"><span class="m6-mark">✓</span><div><strong>All Checks Passed</strong><p>No missing or invalid items were found.</p></div></div>'}</div>
    ${passed.length ? `<details class="m6-passed"><summary>${passed.length} passed check(s)</summary><div class="m6-chips">${passed.map(c => `<span class="m6-chip">✓ ${esc(c.label)}</span>`).join('')}</div></details>` : ''}`;
}

function advisoriesHTML(report) {
    const rules = report.advisories || [];
    const model = report.advisory_model || {};
    const modelItems = model.items || [];
    if (!rules.length && !modelItems.length) return '';
    return `<div class="detail-box"><h3>Wording Suggestions (not used in the decision)</h3>
        ${rules.map(t => `<p class="m6-advice">${esc(t)}</p>`).join('')}
        ${modelItems.map(t => `<p class="m6-advice"><span class="badge">Local Model</span> ${esc(t)}</p>`).join('')}
        <p class="tiny muted" style="margin-top:8px">${esc(model.note || 'Rule-based guidance; no external service is called when a model is not configured.')}</p></div>`;
}

function materialsHTML(a) {
    const declared = (a.catalog_type || {}).materials || [];
    if (!declared.length && !(a.materials || []).length) return '';
    const bySlot = {};
    (a.materials || []).forEach(m => { (bySlot[m.slot] = bySlot[m.slot] || []).push(m); });
    const checks = Object.fromEntries((a.report.checks || []).map(c => [c.code, c]));
    return `<div class="detail-box"><h3>Submitted Materials</h3><div class="m6-materials">${declared.map(spec => {
        const files = bySlot[spec.key] || [];
        const check = checks['MATERIAL_MISSING:' + spec.key] || checks['MATERIAL_OK:' + spec.key] || checks['MATERIAL_OPTIONAL:' + spec.key];
        const state = !files.length ? (spec.required ? 'bad' : 'warn') : 'ok';
        return `<div class="m6-material ${state}">
            <div><strong>${esc(spec.label)}</strong><div class="tiny muted">${esc(spec.hint || '')}${spec.required ? ' · Required' : ' · Optional'}</div></div>
            <div class="m6-material-files">${files.map(f => `<a class="m6-file" href="/api/applications/materials/${f.id}" target="_blank" rel="noopener">${esc(f.name || f.slot)} · ${Math.max(1, Math.round(f.size / 1024))} KB</a>`).join('') || `<span class="m6-tag ${spec.required ? 'red' : 'orange'}">Not Uploaded</span>`}</div>
            ${check && !check.ok ? `<div class="m6-field-fix">${esc(check.message)}</div>` : ''}
        </div>`;
    }).join('')}</div></div>`;
}

async function openApplication(id) {
    let a;
    try {
        a = await api('/applications/' + encodeURIComponent(id));
    } catch (e) {
        return toast(e.message);
    }
    const u = state.user;
    const admin = u.role === 'admin';
    const report = a.report || {};
    const counts = report.counts || {};
    let actions = '';
    if (admin && a.status === 'pre_checked') {
        actions = `<div class="detail-box"><h3>Staff Review</h3>
            <p class="subtitle">Pre-review identifies issues; the final decision remains with staff. A reason is required when returning or rejecting an application.</p>
            <label for="app-note">Review Note</label>
            <textarea id="app-note" maxlength="800" placeholder="For example: The medical evidence matches the course record; deferral approved."></textarea>
            <div class="flex wrap" style="margin-top:12px">
                <button class="btn" data-app-action="approve">Approve and Notify</button>
                <button class="btn secondary" data-app-action="return">Return for Correction</button>
                <button class="btn danger" data-app-action="reject">Reject</button>
            </div>
            <p class="tiny muted" style="margin-top:10px">Application version v${a.version}. A stale action is rejected instead of overwriting another reviewer’s decision.</p></div>`;
    } else if (!admin && ['needs_fix', 'returned'].includes(a.status)) {
        actions = `<div class="detail-box"><h3>Next Step</h3><p class="subtitle">Correct the identified items and resubmit. The system will run pre-review again and notify staff.</p>
            <div class="flex wrap"><button class="btn" data-app-action="revise">Correct and Resubmit</button></div></div>`;
    } else if (!admin && ['needs_fix', 'returned', 'pre_checked'].includes(a.status)) {
        actions = `<div class="detail-box"><h3>Withdraw Application</h3>
            <label for="app-note">Reason (optional)</label>
            <textarea id="app-note" maxlength="300" placeholder="For example: Supporting materials are not ready."></textarea>
            <button class="btn secondary" style="margin-top:12px" data-app-action="withdraw">Withdraw Application</button></div>`;
    }
    drawer(`<div class="drawer-head"><div><div class="eyebrow">APPLICATION ${a.demo ? '· DEMO DATA' : ''}</div>
            <h2 style="font-size:22px">${esc(a.type_name)} Application</h2>
            <div class="mono muted" style="margin-top:8px">${a.id}</div></div>
            <button class="close" data-action="close" aria-label="Close">×</button></div>
        <div class="flex wrap" style="margin-bottom:14px">${appBadge(a.status)}${a.errors ? `<span class="m6-tag red">${a.errors} required item(s)</span>` : ''}${a.warnings ? `<span class="m6-tag orange">${a.warnings} advisory item(s)</span>` : ''}</div>
        <div class="m6-head">
            ${scoreBar(a.score)}
            <div><strong>${esc(report.headline || '')}</strong><p class="small muted">${esc(report.note || '')}</p>
                <p class="tiny muted">Submitted ${date(a.created)} · Updated ${date(a.updated)}${a.decided ? ' · Decided ' + date(a.decided) : ''}</p></div>
        </div>
        <div class="detail-box"><h3>Applicant</h3>
            <p>${esc(a.applicant_name)}（${esc(a.applicant_identity || '')} · ${esc(a.applicant)}）</p>
            <p class="small muted">Student or Staff ID: ${esc(a.student_no || 'Not provided')} · Class: ${esc(a.class_name || 'Not provided')} · Department: ${esc(a.department || 'Not provided')}</p>
            ${a.email ? `<p class="tiny muted">Email: ${esc(a.email)}</p>` : '<p class="tiny muted">This demo account has no verified email; notices remain in the portal.</p>'}
        </div>
        <div class="detail-box"><h3>Application Details</h3>${fieldsHTML(a)}</div>
        ${materialsHTML(a)}
        <div class="detail-box"><h3>Pre-review Checklist</h3>${checksHTML(report)}</div>
        ${advisoriesHTML(report)}
        ${a.review_note ? `<div class="detail-box"><h3>Staff Review Note</h3><p>${esc(a.review_note)}</p><p class="tiny muted">${esc(a.reviewer_name || '')} · ${date(a.decided)}</p></div>` : ''}
        <div class="detail-box"><h3>Activity History</h3><div class="timeline">${(a.events || []).map(e => `<div class="timeline-item">
            <div class="flex between"><strong>${esc(APP_EVENT_LABEL[e.action] || e.action)}</strong><span class="tiny muted">${date(e.created)}</span></div>
            <p>${esc(e.note)}</p><span class="tiny muted">${esc(e.actor_name || 'System')}</span></div>`).join('')}</div></div>
        ${actions}`);

    $$('.drawer [data-app-action]').forEach(btn => btn.onclick = async () => {
        const action = btn.dataset.appAction;
        const note = $('#app-note')?.value || '';
        if (action === 'revise') {
            closeDrawer();
            return applicationForm(a.type, a);
        }
        btn.disabled = true;
        try {
            if (action === 'withdraw') {
                await api('/applications/' + a.id + '/withdraw', { note });
                toast('The application was withdrawn.');
            } else {
                await api('/applications/' + a.id + '/decision', { action, note, version: a.version });
                toast({ approve: 'Approved; the applicant was notified.', return: 'Returned for correction; the applicant was notified.', reject: 'Rejected; the applicant was notified.' }[action]);
            }
            await refresh();
            render();
            await openApplication(a.id);
        } catch (e) {
            toast(e.message);
            if (e.message.toLowerCase().includes('refresh')) {
                await refresh();
                render();
                await openApplication(a.id);
            } else btn.disabled = false;
        }
    });
}

/* ------------------------------------------------------------------ form */

const appEscape = v => esc(v === undefined || v === null ? '' : v);

function appFieldInput(field, value) {
    const common = `data-field="${field.key}" ${field.required ? 'required' : ''}`;
    const hint = field.hint ? `<div class="tiny muted" style="margin-top:5px">${esc(field.hint)}</div>` : '';
    if (field.type === 'select') {
        return `<select ${common}>${field.required ? '' : '<option value="">Not provided</option>'}${field.options.map(o => `<option ${value === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>${hint}`;
    }
    if (field.type === 'textarea') {
        return `<textarea ${common} maxlength="${field.max || 800}" rows="4" placeholder="${esc(field.hint || '')}">${appEscape(value)}</textarea>${hint}`;
    }
    if (field.type === 'number') {
        return `<input type="number" ${common} value="${appEscape(value)}" min="${field.min || 1}" max="${field.max || 99}">${hint}`;
    }
    if (field.type === 'date') {
        return `<input type="date" ${common} value="${appEscape(value)}">${hint}`;
    }
    return `<input type="text" ${common} value="${appEscape(value)}" maxlength="${field.max || 200}" placeholder="${esc(field.hint || '')}" ${field.autofill ? 'data-autofill="1"' : ''}>${hint}`;
}

function applicationForm(typeId, existing) {
    const catalog = appView.catalog;
    if (!catalog || !catalog.types.length) {
        toast('Application types are still loading. Try again in a moment.');
        loadApplications();
        return;
    }
    const type = catalog.types.find(t => t.id === (typeId || catalog.types[0].id));
    const fields = {};
    // Profile keys are not always the form keys: the account stores `name`.
    const autofillValue = key => (key === 'applicant_name' ? state.user.name || '' : state.user[key] || '');
    type.fields.forEach(f => {
        fields[f.key] = existing ? (existing.fields[f.key] ?? '') : (f.autofill ? autofillValue(f.key) : (f.default ?? ''));
    });
    appForm = { type: type.id, existing: existing || null, files: {}, report: null };
    if (existing) {
        (existing.materials || []).forEach(m => {
            // Already stored on the server; the applicant only needs to resend new ones.
            appForm.files[m.slot] = appForm.files[m.slot] || [];
            appForm.files[m.slot].push({ name: m.name, mime: m.mime, size: m.size, id: m.id, stored: true });
        });
    }
    const tabs = existing ? '' : `<div class="m6-tabs">${catalog.types.map(t => `<button type="button" class="m6-tab ${t.id === type.id ? 'active' : ''}" data-app-type="${t.id}">${esc(t.name)}<span class="tiny">${esc(t.sla)}</span></button>`).join('')}</div>`;
    drawer(`<div class="drawer-head"><div><div class="eyebrow">${existing ? 'CORRECT & RESUBMIT' : 'NEW APPLICATION'}</div>
            <h2>${existing ? 'Revise ' : 'New '}${esc(type.name)} Application</h2>
            <div class="small muted" style="margin-top:6px">${esc(type.subtitle)} · Expected time: ${esc(type.sla)} · ${esc(type.fee)}</div></div>
            <button class="close" data-action="close" aria-label="Close">×</button></div>
        ${tabs}
        <form id="app-form">
            <div class="form-grid">${type.fields.map(f => `<div class="${f.type === 'textarea' ? 'm6-full' : ''}">
                <label for="f-${f.key}">${esc(f.label)}${f.required ? ' *' : ''}</label>${appFieldInput(f, fields[f.key])}
                ${f.autofill ? '<div class="tiny muted" style="margin-top:5px">From the campus profile. Update the profile first if this information changed.</div>' : ''}</div>`).join('')}</div>
            <h3 style="margin-top:22px">Upload Materials</h3>
            <p class="subtitle">JPEG, PNG, and PDF files up to 2 MB are accepted. Images are compressed in the browser and stored only in the local database.</p>
            <div class="m6-slots">${type.materials.map(spec => `<div class="m6-slot" data-slot="${spec.key}">
                <div class="m6-slot-head"><div><strong>${esc(spec.label)}</strong><div class="tiny muted">${esc(spec.hint || '')}${spec.required ? ' · Required' : ' · Optional'}</div></div>
                <label class="btn secondary m6-pick">Choose File<input type="file" accept="${APP_ACCEPT}" data-slot-input="${spec.key}" hidden></label></div>
                <div class="m6-slot-files" data-slot-files="${spec.key}"></div></div>`).join('')}</div>
            <div class="flex wrap" style="margin-top:18px">
                <button class="btn soft" type="button" id="app-check-btn">${icon('spark')} Run Pre-review</button>
                <button class="btn" type="submit">${existing ? 'Submit Corrections' : 'Submit Application'}</button>
            </div>
            <p class="tiny muted" style="margin-top:10px">The server runs pre-review again on submission. Incomplete requests require correction and do not enter the staff queue.</p>
        </form>
        <div id="app-report"></div>`);

    const readValues = () => {
        const values = {};
        $$('[data-field]').forEach(el => { values[el.dataset.field] = el.value; });
        return values;
    };
    const payload = () => ({
        type: appForm.type,
        fields: readValues(),
        materials: Object.entries(appForm.files).flatMap(([slot, list]) =>
            list.filter(f => f.data).map(f => ({ slot, name: f.name, mime: f.mime, size: f.size, data: f.data })))
    });
    const metaOnly = () => Object.entries(appForm.files).flatMap(([slot, list]) => list.map(f => ({ slot, mime: f.mime, size: f.size, name: f.name })));

    const paintSlot = slot => {
        const host = document.querySelector(`[data-slot-files="${slot}"]`);
        if (!host) return;
        const files = appForm.files[slot] || [];
        host.innerHTML = files.map((f, i) => `<span class="m6-file ${f.stored ? 'stored' : ''}">${esc(f.name)} · ${Math.max(1, Math.round(f.size / 1024))} KB
            ${f.stored ? '<em>Already submitted</em>' : `<button type="button" class="m6-x" data-remove-file="${slot}:${i}" aria-label="Remove">×</button>`}</span>`).join('');
        host.querySelectorAll('[data-remove-file]').forEach(b => b.onclick = () => {
            const [s, i] = b.dataset.removeFile.split(':');
            appForm.files[s].splice(Number(i), 1);
            appForm.report = null;
            paintSlot(s);
        });
    };
    type.materials.forEach(spec => paintSlot(spec.key));

    $$('[data-slot-input]').forEach(input => input.onchange = async e => {
        const slot = input.dataset.slotInput;
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
            const item = await readMaterial(file);
            // A new pick replaces the stored file for this slot; other slots are untouched.
            appForm.files[slot] = (appForm.files[slot] || []).filter(f => !f.stored);
            if (appForm.files[slot].length >= 3) throw Error('Each material category accepts up to three files.');
            appForm.files[slot].push(item);
            appForm.report = null;
            paintSlot(slot);
        } catch (err) {
            toast(err.message);
        }
    });

    $$('[data-app-type]').forEach(tab => tab.onclick = () => applicationForm(tab.dataset.appType));

    $('#app-check-btn').onclick = async () => {
        const btn = $('#app-check-btn');
        btn.disabled = true;
        btn.textContent = 'Checking…';
        try {
            const report = await api('/applications/check', { type: appForm.type, fields: readValues(), materials: metaOnly() });
            appForm.report = report;
            $('#app-report').innerHTML = `<div class="detail-box" style="margin-top:20px"><h3>Pre-review Result (not yet submitted)</h3>
                <div class="m6-head">${scoreBar(report.score)}<div><strong>${esc(report.headline)}</strong>
                <p class="tiny muted">${esc(report.note)}</p></div></div>
                ${checksHTML(report)}</div>`;
            // The report renders below the upload slots, so bring it into view.
            $('#app-report').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {
            toast(e.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = `${icon('spark')} Run Pre-review`;
        }
    };

    $('#app-form').onsubmit = async e => {
        e.preventDefault();
        const btn = e.submitter;
        btn.disabled = true;
        const body = payload();
        if (existing) body.version = existing.version;
        try {
            const result = existing
                ? await api('/applications/' + existing.id + '/revise', body)
                : await api('/applications', body);
            await refresh();
            render();
            closeDrawer();
            await openApplication(result.id);
            toast(result.status === 'pre_checked' ? 'Pre-review passed; the application entered staff review.' : 'Submitted, but corrections are required before staff review.');
        } catch (err) {
            toast(err.message);
            btn.disabled = false;
        }
    };
}

async function readMaterial(file) {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.type)) throw Error('Only JPEG, PNG, and PDF files are supported.');
    if (file.type === 'application/pdf') {
        if (file.size > 2 * 1024 * 1024) throw Error('PDF files must be no larger than 2 MB.');
        const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(Error('Unable to read the selected file.'));
            reader.readAsDataURL(file);
        });
        return { name: file.name, mime: file.type, size: file.size, data };
    }
    const image = await compressImage(file);
    return { name: file.name, mime: image.mime, size: Math.round(image.data.length * 0.75), data: image.data };
}

/* ---------------------------------------------------------- notifications */

function mountModule6() {
    const host = $('.top-actions');
    if (!host || $('#app-bell')) return;
    const unread = Number(state.unread_notices || 0);
    host.insertAdjacentHTML('afterbegin', `<button class="linkbtn m6-bell" id="app-bell">${icon('bell')} Notices${unread ? `<span class="m6-count">${unread}</span>` : ''}</button>`);
    $('#app-bell').onclick = openNotices;
}

async function openNotices() {
    let data;
    try {
        data = await api('/notices');
    } catch (e) {
        return toast(e.message);
    }
    const state_ = data.notices || [];
    drawer(`<div class="drawer-head"><div><div class="eyebrow">NOTIFICATIONS</div><h2>Campus Notices</h2>
            <div class="small muted" style="margin-top:6px">${data.unread ? data.unread + ' unread' : 'All read'}</div></div>
            <button class="close" data-action="close" aria-label="Close">×</button></div>
        ${data.unread ? '<button class="linkbtn" id="app-read-all">Mark All as Read</button>' : ''}
        <div class="m6-notices">${state_.map(n => `<div class="m6-notice ${n.read_at ? '' : 'unread'}">
            <div class="flex between"><strong>${esc(n.title)}</strong><span class="tiny muted">${date(n.created)}</span></div>
            <p>${esc(n.body)}</p>
            <div class="flex wrap" style="margin-top:8px">
                ${n.application_id ? `<button class="linkbtn" data-notice-app="${esc(n.application_id)}">View Application ↗</button>` : ''}
                <span class="tiny muted">${n.email_state === 'sent' ? 'Email sent' : n.email_state === 'failed' ? 'Email failed; the portal notice remains available' : esc(n.email_note || 'Portal notice only')}</span>
            </div></div>`).join('') || '<div class="empty">No notices yet.</div>'}</div>`);
    $$('.drawer [data-notice-app]').forEach(b => b.onclick = () => openApplication(b.dataset.noticeApp));
    $('#app-read-all')?.addEventListener('click', async () => {
        try {
            await api('/notices/read', {});
            await refresh();
            render();
            await openNotices();
        } catch (e) {
            toast(e.message);
        }
    });
}

