'use strict';
const adminServices = (function () {
    'use strict';
    const root = '/admin-services';
    const applications = root + '/applications';
    const fields = {name: 'Full Name', student_no: 'Student ID', class_name: 'Class', department: 'School or Department', email: 'Email'};
    const profileInputAttributes = {
        name: 'required minlength="2" maxlength="50"',
        student_no: 'required minlength="3" maxlength="30" title="3–30 letters, numbers, or hyphens"',
        class_name: 'maxlength="80"',
        department: 'maxlength="80"',
        email: 'type="email" maxlength="254"',
    };
    const colors = {pending: 'blue', needs_materials: 'orange', approved: 'green', rejected: 'red', cancelled: ''};
    const eventLabels = {submitted: 'Application Submitted', supplemented: 'Documents Submitted', needs_materials: 'Additional Documents Requested', approved: 'Application Approved', rejected: 'Application Rejected', cancelled: 'Canceled by Student'};
    const assignmentLabels = {claimed: 'Application Claimed', released: 'Returned to Queue', transferred: 'Application Reassigned'};
    const requestLabels = {transcript: 'Request a Transcript', enrollment: 'Request Proof of Enrollment'};
    const applicationTitles = {transcript: 'Transcript Request', enrollment: 'Proof of Enrollment Request'};
    const openStatus = status => ['pending', 'needs_materials'].includes(status);
    const visible = user => user.role === 'admin' || (user.role === 'user' && user.identity === 'Student');
    const statusBadge = (catalog, status) => `<span class="badge ${colors[status] || ''}">${esc(catalog.statuses[status])}</span>`;
    const profile = (values, keys = Object.keys(fields)) => `<dl class="as-profile">${keys.map(key =>
        `<div><dt>${fields[key]}</dt><dd>${esc(values[key] || 'Not provided')}</dd></div>`).join('')}</dl>`;

    function profileInputs(values) {
        return `<div class="as-profile as-profile-inputs">${Object.entries(fields).map(([key, label]) =>
            `<div><label for="as-profile-${key}">${label}${['name', 'student_no'].includes(key) ? ' *' : ''}</label>
                <input id="as-profile-${key}" name="profile_${key}" value="${esc(values[key] || '')}" ${profileInputAttributes[key]}></div>`
        ).join('')}</div>`;
    }

    function accountComparison(detail) {
        const registered = detail.account_profile;
        if (!registered) return '';
        const item = detail.application;
        const changed = Object.keys(fields).filter(key => registered[key] !== item.profile[key]);
        return `<p class="small muted">Submitted by: ${esc(item.applicant_id)}</p>
            ${changed.length ? `<h3>Account Records</h3><p class="small muted">These account details differ from the information provided in the application. Review the differences before making a decision.</p>
                ${profile(registered, changed)}` : ''}`;
    }
    const fileHelp = limits => `PDF, PNG, or JPG. Up to ${limits.max_files} files, ${limits.max_bytes / 1048576} MB each.`;
    const sizeLabel = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
    const download = (id, material) => `/api${applications}/${encodeURIComponent(id)}/materials/${encodeURIComponent(material.id)}`;
    const detailPath = id => `${applications}/${encodeURIComponent(id)}`;
    const homeHref = '#admin-services';
    const isPortalHash = (hash = location.hash) => /^#admin-services(?:[/?]|$)/.test(hash);
    const href = (view = '', query = {}) => {
        const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value));
        return homeHref + (view ? '/' + view : '') + (params.size ? '?' + params : '');
    };
    const link = (url, text, style = 'btn secondary') => `<a class="${style}" href="${esc(url)}">${text}</a>`;
    const recordHref = (id, query) => href('detail/' + encodeURIComponent(id), query);
    const docDescriptions = {
        transcript: 'Provides an official record of course grades for further study, exchanges, internships, or scholarships.',
        enrollment: 'Confirms current enrollment for internships, eligibility checks, and other administrative purposes.',
    };

    function currentRoute(reviewer) {
        const [path, search = ''] = location.hash.slice(homeHref.length).split('?');
        const params = new URLSearchParams(search);
        const detail = path.match(/^\/detail\/(AS-[0-9A-F]{16})$/);
        const view = detail ? 'detail'
            : ['/records', '/guide'].includes(path) || (!reviewer && path === '/apply') ? path.slice(1) : 'home';
        const type = params.get('type') || '';
        const status = params.get('status');
        const number = params.get('q') || '';
        const page = params.get('page') || '';
        const owner = params.get('owner') || '';
        return {
            view, id: detail?.[1],
            query: {
                type: ['transcript', 'enrollment'].includes(type) ? type : '',
                status: status === 'all' || Object.prototype.hasOwnProperty.call(colors, status) ? status : '',
                q: /^[a-z0-9-]{1,24}$/i.test(number) ? number : '',
                page: /^[1-9][0-9]{0,8}$/.test(page) && page !== '1' ? page : '',
                owner: reviewer && ['mine', 'unassigned'].includes(owner) ? owner : '',
            },
        };
    }

    function view() {
        const reviewer = state.user.role === 'admin';
        const route = currentRoute(reviewer);
        const [title, subtitle] = {
            home: ['Administrative Services', reviewer ? 'Review transcript and proof-of-enrollment requests from students.' : 'Request transcripts and proof of enrollment, and track each application.'],
            apply: ['New Application', 'Confirm your details, select a document type, and provide a purpose and any supporting documents.'],
            records: reviewer ? ['Review Workspace', 'Search, filter, and review student applications.'] : ['My Applications', 'Find applications by status, type, or reference number.'],
            guide: reviewer ? ['Review Guide', 'Use the checklist to verify applications and record a decision.']
                : ['Application Guide', 'See eligibility, document requirements, and frequently asked questions.'],
            detail: ['Application Details', 'View application details, attachments, and activity history.'],
        }[route.view];
        const tabs = [['home', 'Services Home'], ...(!reviewer ? [['apply', 'New Application']] : []),
            ['records', reviewer ? 'Review Workspace' : 'My Applications'], ['guide', reviewer ? 'Review Guide' : 'Application Guide']];
        return `<div class="page-head"><div><div class="eyebrow">CAMPUS OPERATIONS / ADMIN SERVICES</div>
            <h1 id="as-page-title" tabindex="-1">${title}</h1><p class="subtitle">${subtitle}</p></div></div>
            <nav class="as-nav" aria-label="Administrative services navigation">${tabs.map(([key, label]) => `<a href="${href(key === 'home' ? '' : key)}"
                ${(route.view === key || (route.view === 'detail' && key === 'records')) ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
            <div id="as-portal"><p class="muted" role="status">Loading Administrative Services…</p></div>`;
    }

    function recordRows(items, catalog, query) {
        return `<ul class="as-results">${items.map(item => `<li><a class="as-row" data-as-id="${esc(item.id)}" href="${esc(recordHref(item.id, query))}">
            <span class="ticket-icon">${icon('ticket')}</span><span class="as-row-main">
                <strong>${esc(catalog.types[item.document_type])}</strong>
                <span class="small muted">${esc(item.id)}${catalog.mode === 'student' ? '' : ` · ${esc(item.name)} / ${esc(item.student_no)}`}</span>
                <span class="small muted">Updated  ${date(item.updated)}${catalog.mode === 'reviewer'
                    ? (item.reviewer_id ? ' · Reviewer: ' + esc(item.reviewer_name || item.reviewer_id) : (openStatus(item.status) ? ' · Unassigned' : '')) : ''}</span>
            </span>${statusBadge(catalog, item.status)}${icon('arrow')}
        </a></li>`).join('')}</ul>`;
    }

    function dashboard(catalog, data) {
        const reviewer = catalog.mode === 'reviewer';
        const statusIcons = {pending: 'clock', needs_materials: 'ticket', approved: 'check', rejected: 'box', cancelled: 'logout'};
        return `<section class="as-hero"><div><div class="eyebrow">STUDENT DOCUMENT SERVICES</div>
            <h2>${reviewer ? 'Student Application Review' : 'Academic Document Requests'}</h2>
            <p>${reviewer ? 'Open the review queue to verify application details and record decisions.' : 'Submit requests, upload documents, and check decisions.'}</p>
            <div class="as-actions">${reviewer ? link(href('records', {status: 'pending'}), 'Review Pending Applications ' + icon('arrow'), 'btn')
                : link(href('apply'), icon('plus') + ' New Application', 'btn')}${link(href('guide'), reviewer ? 'View Review Guide' : 'View Application Guide')}</div>
            </div><span class="as-hero-icon" aria-hidden="true">${icon('ticket')}</span></section>
            <div class="as-metrics" aria-label="Application Status Overview">${Object.entries(catalog.statuses).map(([key, label]) =>
                `<a class="stat as-metric" href="${href('records', {status: key})}"><div class="stat-top">${esc(label)}
                <span class="stat-icon">${icon(statusIcons[key])}</span></div><div class="stat-value">${data.counts[key]}</div>
                <div class="stat-foot">View Records ${icon('arrow')}</div></a>`).join('')}</div>
            ${reviewer ? `<section class="card as-queue-overview" aria-label="My Queue">
                <div><h2>My Queue</h2><p class="subtitle">This queue counts pending applications. Resubmitted applications return to the assigned reviewer.</p></div>
                <div class="as-actions">${link(href('records', {status: 'pending', owner: 'mine'}), 'Assigned to Me · ' + data.workload.mine)}
                    ${link(href('records', {status: 'pending', owner: 'unassigned'}), 'Unassigned · ' + data.workload.unassigned)}</div>
                </section>` : `<div class="as-service-grid">${Object.entries(catalog.types).map(([key, title]) =>
                `<section class="card as-service"><div class="card-body"><span class="ticket-icon">${icon('ticket')}</span>
                <h2>${esc(title)}</h2><p class="subtitle">${esc(docDescriptions[key])}</p>
                ${link(href('apply', {type: key}), (requestLabels[key] || 'Start an Application') + ' ' + icon('arrow'))}</div></section>`).join('')}</div>`}
            <section class="card"><div class="card-head"><div><h2>Recent Applications</h2><p>Sorted by most recent update</p></div>
                ${link(href('records', {status: 'all'}), 'View All ' + icon('arrow'), 'linkbtn')}</div>
            <div class="card-body">${data.recent.length ? recordRows(data.recent, catalog, {status: 'all'})
                : '<p class="empty">No applications yet.</p>'}</div></section>`;
    }

    function steps() {
        return `<ol class="as-steps"><li><strong>Submit Application</strong><p>Confirm your details and purpose, and attach documents if needed.</p></li>
            <li><strong>Await Review</strong><p>A reviewer will check your details and may request additional documents.</p></li>
            <li><strong>Check the Decision</strong><p>Open an application to see its status and any reviewer comments.</p></li></ol>`;
    }

    function studentGuide(catalog) {
        const questions = [
            ['What is the difference between a transcript and proof of enrollment?', 'A transcript lists your course grades. Proof of enrollment confirms that you are currently enrolled. Choose the document your recipient requires.'],
            ['What if the details copied from my account are incorrect?', 'You can correct or complete these details in the application. Changes apply only to that request. Reviewers can compare them with your account records.'],
            ['What documents do I need to upload?', fileHelp(catalog.materials) + ' Attachments are optional when you first apply. If a reviewer requests more documents, upload at least one file.'],
            ['How do I submit additional documents?', 'In My Applications, select Awaiting Documents. Open the request, read the reviewer’s instructions, and upload the files to return it to the review queue.'],
            ['Can I cancel an application after submitting it?', 'You can cancel under Current Status while the application is pending review or awaiting documents. The record remains available. Submit a new request to proceed.'],
            ['Can I download the official document after approval?', 'The portal shows application status and reviewer comments. Official documents are issued and collected in accordance with university policy.'],
        ];
        return `<div class="as-layout as-workspace"><section class="card"><div class="card-head"><div><h2>Frequently Asked Questions</h2><p>Select a question to view the answer.</p></div></div>
            <div class="card-body as-faq">${questions.map(([q, a]) => `<details><summary>${q}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>
            <aside class="card"><div class="card-head"><div><h2>Application Process</h2><p>From submission to decision</p></div></div><div class="card-body">${steps()}
                ${link(href('apply'), 'Start an Application', 'btn')}</div></aside></div>`;
    }

    function reviewerGuide(catalog) {
        const checklist = [
            ['clock', 'Claim an Application', 'Open an application in the shared queue and claim it. If a colleague already owns it, ask them to reassign it.'],
            ['search', 'Verify Application Details', 'Verify the account, name, student ID, and document type. Resolve any discrepancies with account records and check that the attachments are readable and complete.'],
            ['check', 'Record a Decision', 'Choose a decision using the guidance provided. When requesting more documents or rejecting an application, explain the reason clearly for the student.'],
            ['users', 'Reassign or Follow Up', 'Add an internal note when reassigning an application. Resubmissions return to the original reviewer’s queue.'],
        ];
        const decisions = [
            ['approved', 'Approve once the details, document type, and attachments have been verified.'],
            ['needs_materials', 'Request more documents when information is missing or needs verification. For example, ask for a document that clearly shows the student ID.'],
            ['rejected', 'Reject ineligible applications. Explain why and, where possible, direct the student to the appropriate department.'],
        ];
        return `<div class="as-layout as-workspace">
            <section class="card"><div class="card-head"><h2>Review Checklist</h2></div>
                <div class="card-body"><ol class="as-review-checklist">${checklist.map(([symbol, title, description]) =>
                    `<li><span class="ticket-icon">${icon(symbol)}</span><div><h3>${title}</h3><p>${description}</p></div></li>`).join('')}</ol>
                    <div class="as-actions">${link(href('records', {status: 'pending', owner: 'unassigned'}), 'Open Unassigned Queue', 'btn')}
                        ${link(href('records', {status: 'pending', owner: 'mine'}), 'View My Queue')}</div></div></section>
            <aside class="card"><div class="card-head"><h2>Decision Guidance</h2></div>
                <div class="card-body"><ul class="as-decision-guide">${decisions.map(([status, description]) =>
                    `<li>${statusBadge(catalog, status)}<p>${description}</p></li>`).join('')}</ul></div></aside>
            </div>`;
    }

    function fileField(id, limits, required = false) {
        return `<label for="${id}">${required ? 'Additional Documents *' : 'Supporting Documents (optional)'}</label>
            <input id="${id}" name="materials" type="file" multiple ${required ? 'required' : ''}
                accept="${limits.extensions.map(ext => '.' + esc(ext)).join(',')}" aria-describedby="${id}-help">
            <p id="${id}-help" class="small muted as-hint">${fileHelp(limits)}</p>`;
    }

    function applyCard(catalog, type) {
        return `<section class="card" aria-labelledby="as-apply-title">
            <div class="card-head"><div><h2 id="as-apply-title">Start an Application</h2><p>Details from your campus account are prefilled. You can edit them for this application.</p></div>${icon('ticket')}</div>
            <div class="card-body">
                <form id="as-apply-form" class="as-form">
                    ${profileInputs(catalog.profile)}
                    <label for="as-type">Document Type *</label>
                    <select id="as-type" name="document_type" required><option value="">Select a document type</option>
                        ${Object.entries(catalog.types).map(([key, title]) => `<option value="${esc(key)}" ${key === type ? 'selected' : ''}>${esc(title)}</option>`).join('')}
                    </select>
                    <p class="small muted as-hint" id="as-type-hint"></p>
                    <label for="as-purpose">Purpose *</label>
                    <textarea id="as-purpose" name="purpose" maxlength="300" rows="3" required placeholder="e.g., required for an internship application"></textarea>
                    ${fileField('as-files', catalog.materials)}
                    <p class="error as-error" role="alert"></p>
                    <button class="btn" type="submit">${icon('plus')} Submit Application</button>
                </form>
            </div></section>`;
    }

    function listCard(catalog, query) {
        const reviewer = catalog.mode === 'reviewer';
        const selected = query.status === 'all' ? '' : query.status || (reviewer ? 'pending' : '');
        return `<section class="card" aria-labelledby="as-list-title">
            <div class="card-head"><div><h2 id="as-list-title">Applications</h2>
            <p>${reviewer ? 'Open an application to verify details and record a decision.' : 'Open an application to view reviewer comments and submitted documents.'}</p></div>
            ${reviewer ? '' : link(href('apply'), icon('plus') + ' New Application', 'btn')}</div>
            <div class="card-body">
                <form class="as-controls" id="as-filters">
                    <div><label for="as-search">Application Reference</label>
                    <input id="as-search" name="q" value="${esc(query.q)}" maxlength="24" placeholder="e.g., AS-4D2…" spellcheck="false"></div>
                    <div><label for="as-status">Application Status</label>
                    <select id="as-status" name="status"><option value="">All Statuses</option>
                        ${Object.entries(catalog.statuses).map(([key, title]) => `<option value="${esc(key)}" ${selected === key ? 'selected' : ''}>${esc(title)}</option>`).join('')}
                    </select></div>
                    <div><label for="as-filter-type">Document Type</label>
                    <select id="as-filter-type" name="type"><option value="">All Types</option>
                        ${Object.entries(catalog.types).map(([key, title]) => `<option value="${esc(key)}" ${query.type === key ? 'selected' : ''}>${esc(title)}</option>`).join('')}
                    </select></div>
                    ${reviewer ? `<div><label for="as-owner">Reviewer</label>
                    <select id="as-owner" name="owner"><option value="">All Reviewers</option>
                        <option value="mine" ${query.owner === 'mine' ? 'selected' : ''}>Assigned to Me</option>
                        <option value="unassigned" ${query.owner === 'unassigned' ? 'selected' : ''}>Unassigned</option>
                    </select></div>` : ''}
                    <button class="btn" type="submit">Search</button>
                    ${link(href('records', {status: 'all'}), 'Clear Filters')}
                    <button class="btn secondary" id="as-refresh" type="button">Refresh List</button>
                </form>
                <p id="as-filter-error" class="error as-error" role="alert"></p>
                <div id="as-results" aria-live="polite"></div>
            </div></section>`;
    }

    function readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({filename: file.name, data: reader.result.split(',')[1]});
            reader.onerror = reader.onabort = () => reject(new Error('Could not read the attachment. Select the file again.'));
            reader.readAsDataURL(file);
        });
    }

    async function selectedFiles(input, limits) {
        const files = [...input.files];
        if (files.length > limits.max_files) throw new Error(`Upload up to  ${limits.max_files}  files`);
        for (const file of files) {
            if (!file.size || file.size > limits.max_bytes) throw new Error(`Choose non-empty files of up to  ${limits.max_bytes / 1048576} MB`);
            if (!limits.extensions.includes(file.name.split('.').pop().toLowerCase())) throw new Error('Attachments must be PDF, PNG, or JPG.');
        }
        return Promise.all(files.map(readFile));
    }

    function bindForm(form, submit) {
        if (!form) return;
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const buttons = [...form.querySelectorAll('[type=submit]')];
            const button = event.submitter || buttons[0];
            if (button.disabled) return;
            const error = form.querySelector('.as-error');
            const owner = $('#as-portal');
            error.textContent = '';
            buttons.forEach(control => { control.disabled = true; });
            try {
                await submit(form.elements, () => owner?.isConnected && form.isConnected, button);
            } catch (err) {
                error.textContent = err.message;
            } finally {
                buttons.forEach(control => { control.disabled = false; });
            }
        });
    }

    function assignmentCard(detail) {
        const {reviewer, inactive, mine} = detail.assignment;
        const open = openStatus(detail.application.status);
        const internalEvents = detail.events.filter(event => Object.prototype.hasOwnProperty.call(assignmentLabels, event.action));
        const choices = detail.reviewers || [];
        return `<section class="detail-box as-detail as-assignment"><h2>Reviewer Assignment</h2>
            <p class="as-assignee">${reviewer ? `<strong>${esc(reviewer.name || reviewer.id)}</strong> <span class="small muted">(${esc(reviewer.id)})</span>
                ${mine ? '<span class="badge green">Assigned to Me</span>' : ''}`
                : '<span class="badge orange">' + (open ? 'Unassigned' : 'No Active Reviewer') + '</span>'}</p>
            ${open && !reviewer ? `<p class="small muted">${inactive ? 'The previous reviewer is no longer available. Another administrator can claim the application.' : 'Claim the application to review it or reassign it to another administrator.'}</p>
                <form class="as-form" id="as-assignment"><p class="error as-error" role="alert"></p>
                    <button type="submit" class="btn secondary" value="claim">${inactive ? 'Reclaim Application' : 'Claim Application'}</button></form>` : ''}
            ${open && mine ? `<form class="as-form" id="as-assignment">
                ${choices.length ? `<label for="as-transfer-to">Assign To</label><select id="as-transfer-to" name="reviewer_id"><option value="">Select an administrator</option>
                    ${choices.map(person => `<option value="${esc(person.id)}">${esc(person.name || person.id)} (${esc(person.id)})</option>`).join('')}</select>` : ''}
                <label for="as-handoff-note">Handoff Note (optional, administrators only)</label>
                <textarea id="as-handoff-note" name="note" maxlength="300" rows="2"></textarea>
                <p class="error as-error" role="alert"></p><div class="as-actions">
                    ${choices.length ? '<button type="submit" class="btn secondary" value="transfer">Reassign Application</button>' : ''}
                    <button type="submit" class="btn secondary" value="release">Return to Unassigned Queue</button>
                </div></form>` : ''}
            ${open && reviewer && !mine ? '<p class="notice">Another administrator is reviewing this application. Contact them if you need it reassigned.</p>' : ''}
            ${internalEvents.length ? `<details class="as-handoff-history"><summary>Assignment History (${internalEvents.length})</summary>
                <ol class="timeline as-timeline">${internalEvents.map(event => `<li class="timeline-item">
                    <strong>${assignmentLabels[event.action]}</strong> <span class="small muted">${esc(event.actor_id)} · ${date(event.created)}</span>
                    <p class="as-note">${esc(event.note)}</p></li>`).join('')}</ol></details>` : ''}</section>`;
    }

    function applicationDetails(panel, detail, catalog, reload) {
        const {application: item, events, materials} = detail;
        const reviewer = catalog.mode === 'reviewer';
        const assignment = detail.assignment;
        const canDecide = reviewer && item.status === 'pending' && (!assignment.reviewer || assignment.mine);
        const publicEvents = events.filter(event => !Object.prototype.hasOwnProperty.call(assignmentLabels, event.action));
        panel.innerHTML = `
            <div class="as-layout as-workspace"><div class="as-stack"><div class="detail-box as-detail">
            <h3>Applicant Details</h3>${profile(item.profile)}${reviewer ? accountComparison(detail) : ''}
            <h3>Purpose</h3><p class="as-note">${esc(item.purpose)}</p></div>
            <section class="detail-box as-detail"><h2>Application History</h2>
                <ol class="timeline as-timeline">${publicEvents.map(event => `<li class="timeline-item">
                    <strong>${eventLabels[event.action] || esc(event.action)}</strong>
                    <div class="small muted">${date(event.created)}</div>
                    ${event.note ? `<p class="as-note">${esc(event.note)}</p>` : ''}
                    ${materials.filter(file => file.event_id === event.id).map(file => `<a class="as-download" href="${download(item.id, file)}">${esc(file.filename)} <span class="small muted">· ${sizeLabel(file.size)}</span></a>`).join('')}
                </li>`).join('')}</ol>
            </section></div><aside class="as-stack"><section class="detail-box as-detail"><h2>Current Status</h2>
                <div class="as-detail-status">${statusBadge(catalog, item.status)}</div>
                <p class="small muted">Submitted  ${date(item.created)} · Updated  ${date(item.updated)}</p>
                <p class="small muted">${esc({
                    pending: reviewer ? 'Verify the application and documents before recording a decision.' : 'Your application is in the review queue. Check back for a decision.',
                    needs_materials: reviewer ? 'Waiting for the student to provide additional documents.' : 'Read the reviewer’s instructions in the application history and upload the requested documents.',
                    approved: 'Your application was approved. The record remains available.',
                    rejected: 'The application was rejected. See the application history for the reason.',
                    cancelled: reviewer ? 'The student canceled this application. No further action is required.' : 'This application was canceled. Submit a new request if needed.',
                }[item.status])}</p>
                ${!reviewer && openStatus(item.status) ? `<details class="as-cancel">
                    <summary class="btn danger">Cancel Application</summary>
                    <form class="as-form" id="as-cancel-form">
                        <p>Canceling stops the review, but the record remains available. Cancel this application?</p>
                        <p class="error as-error" role="alert"></p>
                        <div class="as-actions"><button type="submit" class="btn danger">Confirm Cancellation</button>
                            <button type="button" class="btn secondary" id="as-keep-application">Keep Application</button></div>
                    </form></details>` : ''}
            </section>
            ${reviewer ? assignmentCard(detail) : ''}
            ${canDecide ? `<section class="detail-box as-detail"><h2>Review Decision</h2>
                ${!assignment.reviewer ? '<p class="small muted">Saving a decision also assigns you as the reviewer.</p>' : ''}
                <form class="as-form" id="as-decision">
                    <label for="as-decision-value">Decision *</label>
                    <select id="as-decision-value" name="decision" required><option value="">Select a decision</option>
                        <option value="approved">Approve</option><option value="needs_materials">Request Additional Documents</option><option value="rejected">Reject</option>
                    </select>
                    <label for="as-decision-note">Reviewer Comments (required for document requests or rejection)</label>
                    <textarea id="as-decision-note" name="note" maxlength="500" rows="3"></textarea>
                    <p class="error as-error" role="alert"></p><button type="submit" class="btn">Save Decision</button>
                </form></section>` : ''}
            ${!reviewer && item.status === 'needs_materials' ? `<section class="detail-box as-detail"><h2>Additional Documents</h2>
                <form class="as-form" id="as-supplement">
                    ${fileField('as-extra-files', catalog.materials, true)}
                    <label for="as-supplement-note">Additional Notes (optional)</label>
                    <textarea id="as-supplement-note" name="note" maxlength="500" rows="3"></textarea>
                    <p class="error as-error" role="alert"></p><button type="submit" class="btn">Submit Additional Documents</button>
                </form></section>` : ''}</aside></div>`;
        const decisionForm = panel.querySelector('#as-decision');
        if (decisionForm) {
            decisionForm.elements.decision.onchange = () => {
                decisionForm.elements.note.required = ['rejected', 'needs_materials'].includes(decisionForm.elements.decision.value);
            };
        }
        const update = async (path, payload, message, active) => {
            if (!active()) return;
            await api(detailPath(item.id) + path, {version: item.version, ...payload});
            if (active()) {
                toast(message);
                reload();
            }
        };
        bindForm(decisionForm, (inputs, active) =>
            update('/decision', {decision: inputs.decision.value, note: inputs.note.value}, 'Decision saved.', active));
        bindForm(panel.querySelector('#as-assignment'), (inputs, active, button) => {
            const operation = button.value;
            const reviewerId = inputs.reviewer_id?.value;
            if (operation === 'transfer' && !reviewerId) throw new Error('Select an administrator before reassigning.');
            return update('/assignment', {operation, reviewer_id: reviewerId, note: inputs.note?.value || ''},
                {claim: 'Application claimed.', release: 'Application returned to the unassigned queue.', transfer: 'Application reassigned.'}[operation], active);
        });
        bindForm(panel.querySelector('#as-supplement'), async (inputs, active) =>
            update('/materials', {note: inputs.note.value, materials: await selectedFiles(inputs.materials, catalog.materials)}, 'Documents submitted. The application is back in review.', active));
        const keep = panel.querySelector('#as-keep-application');
        if (keep) {
            keep.onclick = () => {
                const confirmation = keep.closest('details');
                confirmation.open = false;
                confirmation.querySelector('summary').focus();
            };
        }
        bindForm(panel.querySelector('#as-cancel-form'), (_, active) =>
            update('/cancel', {}, 'Application canceled.', active));
    }

    function bindDetail(portal, route, catalog) {
        const id = route.id;
        portal.innerHTML = `<div class="as-detail-bar"><div><span class="eyebrow">APPLICATION NO.</span><div id="as-detail-id" class="mono">${esc(id)}</div></div>
            <div class="as-actions">${link(href('records', route.query), catalog.mode === 'reviewer' ? 'Back to Review Workspace' : 'Back to My Applications')}
            <button type="button" class="btn secondary" id="as-copy-id">Copy Reference</button>
            <button type="button" class="btn secondary" id="as-refresh-detail">Refresh Details</button></div></div>
            <div id="as-detail-body" aria-live="polite"></div>`;
        const panel = portal.querySelector('#as-detail-body');
        const refresh = portal.querySelector('#as-refresh-detail');
        portal.querySelector('#as-copy-id').onclick = async () => {
            try {
                await navigator.clipboard.writeText(id);
                toast('Application reference copied.');
            } catch {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(portal.querySelector('#as-detail-id'));
                selection.removeAllRanges();
                selection.addRange(range);
                toast('The reference is selected. You can copy it manually.');
            }
        };
        async function reload() {
            if (!panel.isConnected) return;
            refresh.disabled = true;
            panel.innerHTML = '<p class="muted">Loading applications…</p>';
            try {
                const detail = await api(detailPath(id));
                if (!panel.isConnected) return;
                $('#as-page-title').textContent = applicationTitles[detail.application.document_type] || 'Application Details';
                applicationDetails(panel, detail, catalog, reload);
            } catch (err) {
                panel.textContent = err.message;
            } finally {
                refresh.disabled = false;
            }
        }
        refresh.onclick = reload;
        reload();
    }

    function bindRecords(portal, route, catalog) {
        portal.innerHTML = listCard(catalog, route.query);
        const results = portal.querySelector('#as-results');
        const form = portal.querySelector('#as-filters');
        const query = {...route.query, status: route.query.status || (catalog.mode === 'reviewer' ? 'pending' : 'all')};
        const pageNumber = Number(query.page || 1);
        let request = 0;

        async function loadList() {
            if (!portal.isConnected) return;
            const current = ++request;
            results.innerHTML = '<p class="muted">Loading applications…</p>';
            try {
                const params = new URLSearchParams({...query, status: query.status === 'all' ? '' : query.status, page: pageNumber});
                const data = await api(applications + '?' + params);
                if (current !== request || !portal.isConnected) return;
                const lastPage = Math.max(1, Math.ceil(data.total / data.page_size));
                if (pageNumber > lastPage) {
                    const target = href('records', {...query, page: lastPage > 1 ? lastPage : ''});
                    // Use replace so an out-of-range page does not trap the Back button.
                    location.replace(target);
                    return;
                }
                results.innerHTML = data.applications.length ? `
                    ${recordRows(data.applications, catalog, query)}
                    <div class="flex between as-pagination"><span class="small muted">Total:  ${data.total}  results · Page  ${pageNumber} / ${lastPage} </span>
                        <div class="flex">${pageNumber > 1 ? link(href('records', {...query, page: pageNumber > 2 ? pageNumber - 1 : ''}), 'Previous') : ''}
                        ${pageNumber < lastPage ? link(href('records', {...query, page: pageNumber + 1}), 'Next') : ''}</div></div>`
                    : '<p class="empty">No applications match your filters.</p>';
            } catch (err) {
                if (current === request && portal.isConnected) results.textContent = err.message;
            }
        }

        form.onsubmit = event => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(form));
            const error = portal.querySelector('#as-filter-error');
            values.q = values.q.trim();
            if (!/^[a-z0-9-]{0,24}$/i.test(values.q)) {
                error.textContent = 'Application references may contain only letters, numbers, and hyphens.';
                return;
            }
            error.textContent = '';
            const next = href('records', {...values, status: values.status || 'all'});
            if (location.hash === next) loadList();
            else location.hash = next;
        };
        portal.querySelector('#as-refresh').onclick = loadList;
        loadList();
    }

    function bindApply(portal, route, catalog) {
        portal.innerHTML = `<div class="as-layout as-workspace">${applyCard(catalog, route.query.type)}
            <aside class="card"><div class="card-head"><div><h2>Application Process</h2><p>Check the requirements before submitting.</p></div></div>
                <div class="card-body">${steps()}${link(href('guide'), 'View Application Guide ' + icon('arrow'))}</div></aside></div>`;
        const form = portal.querySelector('#as-apply-form');
        const typeHint = () => {
            portal.querySelector('#as-type-hint').textContent = docDescriptions[form.elements.document_type.value] || '';
        };
        form.elements.document_type.onchange = typeHint;
        typeHint();
        bindForm(form, async (inputs, active) => {
            const payload = {
                document_type: inputs.document_type.value,
                purpose: inputs.purpose.value,
                profile: Object.fromEntries(Object.keys(fields).map(key => [key, inputs[`profile_${key}`].value])),
                materials: await selectedFiles(inputs.materials, catalog.materials),
            };
            if (!active()) return;
            const result = await api(applications, payload);
            if (!active()) return;
            toast('Application submitted. Track it in My Applications.');
            location.hash = recordHref(result.id);
        });
    }

    async function bind() {
        const portal = $('#as-portal');
        const route = currentRoute(state.user.role === 'admin');
        try {
            const catalog = await api(root + '/catalog');
            if (!portal.isConnected) return;
            if (route.view === 'home') {
                const data = await api(root + '/summary');
                if (portal.isConnected) portal.innerHTML = dashboard(catalog, data);
            } else if (route.view === 'guide') {
                portal.innerHTML = catalog.mode === 'reviewer' ? reviewerGuide(catalog) : studentGuide(catalog);
            }
            else if (route.view === 'apply') bindApply(portal, route, catalog);
            else if (route.view === 'records') bindRecords(portal, route, catalog);
            else bindDetail(portal, route, catalog);
        } catch (err) {
            if (portal.isConnected) {
                portal.innerHTML = '<p class="error" role="alert"></p><button type="button" class="btn secondary">Reload</button>';
                portal.querySelector('p').textContent = err.message;
                portal.querySelector('button').onclick = bind;
            }
        }
    }

    return {visible, view, bind, homeHref, isPortalHash};
})();
