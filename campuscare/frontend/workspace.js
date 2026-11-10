'use strict';
const workspace = (function () {
    const items = {
        overview: ['grid', 'Dashboard'],
        learning: ['spark', 'Intelligent Q&A'],
        'academic-risk': ['chart', 'Academic Risk'],
        'admin-services': ['ticket', 'Administrative Services'],
        applications: ['file', 'Application Pre-review'],
        report: ['plus', 'Report a Facility Issue'],
        bookings: ['calendar', 'Venue Booking'],
        tickets: ['tool', 'Work Orders'],
        map: ['map', 'Campus Map'],
        assets: ['box', 'Asset Register'],
        'facility-overview': ['chart', 'Facilities Overview'],
        maintenance: ['clock', 'Maintenance and Forecasting'],
        users: ['users', 'User Management'],
        assistant: ['spark', 'Operations Assistant'],
    };
    const labels = {user: 'Student and Faculty Services', admin: 'Campus Operations', technician: 'Maintenance Workspace'};
    const paths = {
        transcript: '#admin-services/apply?type=transcript',
        enrollment: '#admin-services/apply?type=enrollment',
        requests: '#admin-services/records',
        review: '#admin-services/records?status=pending',
        mine: '#admin-services/records?status=pending&owner=mine',
        unassigned: '#admin-services/records?status=pending&owner=unassigned',
        guide: '#admin-services/guide',
    };
    const catalog = [
        {key: 'learning', group: 'learning', icon: 'spark', tag: 'Learning Support', title: 'Intelligent Q&A Assistant', desc: 'Ask campus-service questions and receive answers with cited sources.', target: '#campus/learning', role: 'user'},
        {key: 'academic-risk', group: 'learning', icon: 'chart', tag: 'Learning Support', title: 'Academic Risk Warning', desc: 'Review a transparent engagement indicator based on recent service activity.', target: '#campus/academic-risk', role: 'user'},
        {key: 'transcript', group: 'documents', icon: 'ticket', tag: 'Administrative Services', title: 'Transcript Request', desc: 'Request a transcript for further study, an internship, or an exchange program.', target: paths.transcript, role: 'user'},
        {key: 'enrollment', group: 'documents', icon: 'check', tag: 'Administrative Services', title: 'Proof of Enrollment', desc: 'Request a letter confirming your current enrollment.', target: paths.enrollment, role: 'user'},
        {key: 'pre-review', group: 'documents', icon: 'file', tag: 'Application Services', title: 'Application Pre-review', desc: 'Check requirements, materials, and eligibility before administrative review.', target: '#campus/applications', role: 'user'},
        {key: 'report', group: 'campus', icon: 'tool', tag: 'Campus Facilities', title: 'Report an Issue', desc: 'Report a facility issue, attach photos, and track the repair.', target: '#campus/report', role: 'user'},
        {key: 'bookings', group: 'campus', icon: 'calendar', tag: 'Campus Services', title: 'Venue Booking', desc: 'Check venue availability and submit a booking request.', target: '#campus/bookings', role: 'user'},
        {key: 'map', group: 'campus', icon: 'map', tag: 'Campus Facilities', title: 'Campus Guide', desc: 'Explore campus buildings, residences, and facilities.', target: '#campus/map', role: 'user'},
        {key: 'review', group: 'staff', icon: 'grid', tag: 'Administrators', title: 'Application Review', desc: 'Assign, review, and process student applications.', target: paths.review, role: 'admin'},
        {key: 'maintenance', group: 'staff', icon: 'tool', tag: 'Technicians', title: 'Maintenance Workspace', desc: 'View assigned work orders and submit completed repairs for verification.', target: '#campus/tickets', role: 'technician'},
    ];
    const campusUrl = id => '#campus/' + id;
    const supports = u => u.role === 'admin' || (u.role === 'user' && u.identity === 'Student');
    const titleOf = (id, user) => id === 'tickets' && user.role === 'technician' ? 'My Maintenance Tasks'
        : id === 'applications' && user.role === 'admin' ? 'Application Review'
        : items[id]?.[1] || 'Dashboard';

    function nav(user) {
        if (user.role === 'admin') return [
            ['Overview', ['overview']],
            ['Learning Support', ['learning', 'academic-risk']],
            ['Administrative Services', ['admin-services', 'applications']],
            ['Campus Facilities', ['tickets', 'report', 'bookings', 'map', 'assets', 'facility-overview', 'maintenance']],
            ['System Settings', ['users', 'assistant']],
        ];
        if (user.role === 'technician') return [['Service navigation', ['overview', 'tickets', 'map', 'assets']]];
        return [['Service navigation', ['overview', 'learning', 'academic-risk', ...(supports(user) ? ['admin-services'] : []), 'applications', 'report', 'bookings', 'tickets', 'map', 'assets']]];
    }
    const allowed = (user, id) => nav(user).some(([, ids]) => ids.includes(id));

    const brand = () => `<span class="site-brand-mark" aria-hidden="true"><svg viewBox="0 0 28 28"><path d="M4 21h20M6 18V9l8-4 8 4v9M10 18v-7m8 7v-7M14 9v9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><strong>SmartCampus</strong><span>GlobalConnect University</span></span>`;
    const commandIcon = () => `${icon('search')} <span>Find a Service</span><kbd>Ctrl K</kbd>`;
    const action = (route, title, style = 'btn') => `<button type="button" class="${style}" data-route="${esc(route)}">${title}</button>`;
    const linkArrow = () => ` ${icon('arrow')}`;

    function serviceCards(services) {
        return services.map(item => `<article class="service-tile tone-${item.group}">
            <div class="service-tile-top"><span class="service-glyph">${icon(item.icon)}</span><span class="service-category">${item.tag}</span></div>
            <h3>${item.title}</h3><p>${item.desc}</p>
            ${action(item.target, 'Open Service' + linkArrow(), 'service-link')}
        </article>`).join('');
    }

    function shell(user, current) {
        const staff = user.role === 'admin';
        const groups = nav(user);
        const navHtml = groups.map(([group, ids]) => `<div class="workspace-nav-group">${staff ? `<span class="workspace-nav-label">${group}</span>` : ''}${ids.map(id => `<button type="button" class="navitem ${id === current ? 'active' : ''}" data-page="${id}" ${id === current ? 'aria-current="page"' : ''}>${icon(items[id][0])}${titleOf(id, user)}</button>`).join('')}</div>`).join('');
        const profile = `<button type="button" id="profile-button" class="workspace-profile" aria-label="Profile"><span class="avatar" aria-hidden="true">${esc(user.name?.[0] || 'S')}</span><span>${esc(user.name)}</span></button>`;
        const actions = `<div class="top-actions"><button type="button" class="workspace-search" aria-label="Find a Service" data-command>${commandIcon()}</button>
            ${staff ? '<button type="button" class="linkbtn" id="mail-settings-button">Email Settings</button>' : ''}${profile}
            <button type="button" class="workspace-logout" data-action="logout" aria-label="Sign out" title="Sign out">${icon('logout')}</button></div>`;
        const sidebar = `<aside class="sidebar"><button type="button" class="site-brand" data-page="overview" aria-label="SmartCampus Dashboard">${brand()}</button>
            ${staff ? '<div class="workspace-tenant"><span class="workspace-tenant-dot"></span><div><strong>Operations Workspace</strong><span>GCU Demo Campus</span></div></div>' : ''}
            <nav aria-label="${labels[user.role]} navigation">${navHtml}</nav>${staff ? '<div class="workspace-sidebar-end">Administrators only</div>' : ''}</aside>`;
        return `<a href="#content" class="skip-link" data-skip>Skip to main content</a><div class="shell workspace-shell ${staff ? 'workspace-admin' : 'workspace-member'}">${sidebar}
            <main class="main"><header class="topbar"><div class="breadcrumb"><span>${labels[user.role]}</span><span aria-hidden="true">/</span><strong>${titleOf(current, user)}</strong></div>${actions}</header>
            <div class="content" id="content" tabindex="-1"></div></main></div>`;
    }

    function membersHome(s) {
        const student = supports(s.user);
        const tech = s.user.role === 'technician';
        const services = tech ? ['maintenance', 'map'].map(key => catalog.find(item => item.key === key))
            : catalog.filter(item => item.role === 'user' && (student || item.group === 'campus'));
        const live = s.tickets.filter(item => !['closed', 'cancelled'].includes(item.status));
        return `<div class="member-home">
            <section class="member-hero"><div class="campus-art" aria-hidden="true"></div><div class="member-hero-copy">
                <span class="editorial-label"><i></i>${tech ? 'Maintenance Workspace' : 'GCU Campus Services'}</span>
                <h1>${tech ? 'Maintenance Tasks' : student ? 'Student Services' : 'Faculty Services'}</h1>
                <p>${tech ? 'Work orders, repair progress, and completion checks' : student ? 'Administrative services, maintenance requests, and facilities' : 'Maintenance requests and facilities'}</p>
                <div class="as-actions">${student ? action(paths.transcript, 'Request a Transcript' + linkArrow(), 'btn campus-primary')
                    : action(campusUrl(tech ? 'tickets' : 'report'), (tech ? 'View Maintenance Tasks' : 'Report an Issue') + linkArrow(), 'btn campus-primary')}
                    ${student ? action(paths.requests, 'View Applications', 'btn campus-quiet') : action(campusUrl('map'), 'Open Campus Map', 'btn campus-quiet')}</div>
            </div><span class="member-hero-stamp">GCU / CAMPUS PLAN</span></section>
            <div class="editorial-head home-section-head"><div><span class="editorial-label"><i></i> SERVICE DIRECTORY</span><h2>${tech ? 'Maintenance and Campus Map' : 'Popular Services'}</h2></div></div>
            <div class="service-grid member-services">${serviceCards(services)}</div>
            <section class="home-activity card"><div class="card-head"><div><h2>${tech ? 'Pending Maintenance' : 'My Activity'}</h2><p>Track requests available to your account.</p></div>
                ${action(campusUrl('tickets'), tech ? 'All Maintenance Tasks' : 'View Work Orders', 'btn secondary')}</div>
                <div class="card-body"><div class="home-activity-grid">
                    <div>${metric(campusUrl('tickets'), tech ? 'Open Maintenance Tasks' : 'Open Work Orders', live.length, 'tool')}</div>
                    ${student ? '<div id="workspace-summary" aria-live="polite"><p class="muted">Loading your applications…</p></div>' : ''}
                </div></div></section>
        </div>`;
    }

    function metric(route, title, count, symbol) {
        return action(route, `<span class="workspace-metric-icon">${icon(symbol)}</span><span><span>${title}</span><strong>${count}</strong></span>${icon('arrow')}`, 'workspace-metric');
    }

    function adminHome(s) {
        const active = s.tickets.filter(item => !['closed', 'cancelled'].includes(item.status));
        const unassigned = active.filter(item => item.status === 'pending').length;
        const inspections = s.inspections.filter(item => item.status === 'pending').length;
        return `<div class="operations-home"><section class="operations-hero"><div><span class="editorial-label"><i></i> GCU OPERATIONS</span>
            <h1>Campus Operations Overview</h1><p>Application reviews, work orders, and inspections</p></div>
            ${action(paths.review, 'Open Review Queue' + linkArrow(), 'btn campus-primary')}</section>
            <div class="operations-metrics">
                <div id="workspace-summary" aria-live="polite"><p class="muted">Loading the review queue…</p></div>
                <div>${metric(campusUrl('tickets'), 'Reports Awaiting Review', unassigned, 'tool')}</div>
                <div>${metric(campusUrl('maintenance'), 'Inspections Awaiting Review', inspections, 'clock')}</div>
            </div>
            <div class="operations-grid">
                <section class="card operations-queue"><div class="card-head"><div><h2>Administrative Services</h2><p>Choose a queue to view and process applications.</p></div></div><div class="card-body">
                    ${operationsLink(paths.unassigned, 'Claim Application', 'View pending applications without an assigned reviewer.', 'ticket')}
                    ${operationsLink(paths.mine, 'Assigned to Me', 'View pending applications assigned to you.', 'users')}
                    ${operationsLink(paths.guide, 'Review Guide', 'Review records, request documents, and reassign applications.', 'check')}
                </div></section>
                <section class="card operations-queue"><div class="card-head"><div><h2>Campus Facilities</h2><p>${active.length}  open work orders.</p></div></div><div class="card-body">
                    ${operationsLink(campusUrl('tickets'), 'Maintenance Work Orders', 'Track requests from initial review to completion.', 'tool')}
                    ${operationsLink(campusUrl('facility-overview'), 'Facilities Overview', 'View the campus map and facility records by area.', 'map')}
                    ${operationsLink(campusUrl('users'), 'User Management', 'Manage roles, account status, and campus records.', 'users')}
                </div></section>
            </div></div>`;
    }

    function operationsLink(route, title, desc, symbol) {
        return action(route, `<span class="service-glyph">${icon(symbol)}</span><span><strong>${title}</strong><span>${desc}</span></span>${icon('arrow')}`, 'operations-link');
    }

    async function bindHome(user) {
        const box = $('#workspace-summary');
        if (!box) return;
        try {
            const data = await api('/admin-services/summary');
            if (!box.isConnected) return;
            if (user.role === 'admin') {
                box.innerHTML = metric(paths.review, 'Applications Pending Review', data.counts.pending, 'ticket');
            } else {
                box.innerHTML = metric('#admin-services/records?status=needs_materials', 'Additional Documents Required', data.counts.needs_materials, 'ticket');
            }
        } catch (err) {
            if (box.isConnected) {
                box.innerHTML = action(user.role === 'admin' ? paths.review : paths.requests, 'Open Applications' + linkArrow(), 'btn secondary');
            }
        }
    }

    function commandEntries(user) {
        const base = nav(user).flatMap(([, ids]) => ids.map(id => ({
            route: id === 'admin-services' ? '#admin-services' : campusUrl(id),
            title: titleOf(id, user), symbol: items[id][0],
        })));
        const extra = user.role === 'admin' ? [
            {route: paths.review, title: 'Review Queue', symbol: 'ticket'},
            {route: paths.unassigned, title: 'Unassigned Applications', symbol: 'users'},
            {route: paths.mine, title: 'My Reviews', symbol: 'check'},
        ] : supports(user) ? [
            {route: paths.transcript, title: 'Transcript Request', symbol: 'ticket'},
            {route: paths.enrollment, title: 'Proof of Enrollment', symbol: 'ticket'},
            {route: paths.requests, title: 'Track My Applications', symbol: 'clock'},
        ] : [];
        return [...extra, ...base];
    }

    function openCommand(user, navigate) {
        if ($('#service-command')) return;
        const dialog = document.createElement('dialog');
        dialog.id = 'service-command';
        dialog.className = 'service-command';
        dialog.setAttribute('aria-labelledby', 'command-title');
        dialog.innerHTML = `<div class="command-top"><h2 id="command-title">Find a Service</h2><button type="button" class="close" aria-label="Close search">×</button></div>
            <label class="sr-only" for="command-query">Search by service name</label><input id="command-query" placeholder="e.g., transcript, maintenance, user management" autocomplete="off">
            <div id="command-results"></div><p class="small muted">↑ ↓ Select · Enter Open · Esc Close</p>`;
        document.body.append(dialog);
        const input = dialog.querySelector('input'), results = dialog.querySelector('#command-results');
        const entries = commandEntries(user);
        let matches = [], active = 0;
        const renderResults = () => {
            results.innerHTML = matches.length ? matches.map((item, i) => `<button type="button" class="command-option ${i === active ? 'active' : ''}" data-command-index="${i}">${icon(item.symbol)}<span>${esc(item.title)}</span>${icon('arrow')}</button>`).join('') : '<p class="empty">No matching services</p>';
        };
        const search = () => {
            const q = input.value.trim().toLowerCase();
            matches = entries.filter(item => item.title.toLowerCase().includes(q) || item.route.toLowerCase().includes(q)).slice(0, 8);
            active = 0;
            renderResults();
        };
        function pick(i) {
            if (!matches[i]) return;
            const target = matches[i].route;
            dialog.close();
            navigate(target);
        }
        dialog.querySelector('.close').onclick = () => dialog.close();
        input.oninput = search;
        results.onclick = e => {
            const option = e.target.closest('[data-command-index]');
            if (option) pick(Number(option.dataset.commandIndex));
        };
        input.onkeydown = e => {
            if (!matches.length || e.isComposing) return;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                active = (active + (e.key === 'ArrowUp' ? -1 : 1) + matches.length) % matches.length;
                renderResults();
                results.children[active]?.scrollIntoView({block: 'nearest'});
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                pick(active);
            }
        };
        dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
        dialog.addEventListener('close', () => dialog.remove(), {once: true});
        search();
        dialog.showModal();
        input.focus();
    }

    return {allowed, campusUrl, catalog, shell, bindHome, openCommand,
        home: state => state.user.role === 'admin' ? adminHome(state) : membersHome(state)};
})();
