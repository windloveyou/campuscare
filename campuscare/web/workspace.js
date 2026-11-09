'use strict';
const workspace = (function () {
    const items = {
        overview: ['grid', '工作台'],
        'admin-services': ['ticket', '行政服务'],
        report: ['plus', '智能报修'],
        tickets: ['tool', '工单中心'],
        map: ['map', '校园地图'],
        assets: ['box', '设施台账'],
        'facility-overview': ['chart', '设施概览'],
        maintenance: ['clock', '维护与预测'],
        users: ['users', '用户管理'],
        assistant: ['spark', '管理助手'],
    };
    const labels = {user: '师生服务', admin: '校园运营', technician: '维修工作区'};
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
        {key: 'transcript', group: 'documents', icon: 'ticket', tag: '行政服务', title: '成绩单申请', desc: '用于升学、实习或交换申请。在线提交材料并查看进度。', target: paths.transcript, role: 'user'},
        {key: 'enrollment', group: 'documents', icon: 'check', tag: '行政服务', title: '在校证明', desc: '在线申请在校证明，自动带入学生资料。', target: paths.enrollment, role: 'user'},
        {key: 'report', group: 'campus', icon: 'tool', tag: '校园设施', title: '校园报修', desc: '按楼栋和设备定位问题，提交照片并跟进维修。', target: '#campus/report', role: 'user'},
        {key: 'map', group: 'campus', icon: 'map', tag: '校园设施', title: '校园导览', desc: '按区域浏览示例校区、教学楼和宿舍设施。', target: '#campus/map', role: 'user'},
        {key: 'review', group: 'staff', icon: 'grid', tag: '管理人员', title: '审批工作区', desc: '管理待办、领取经办、审批和交接申请。', target: paths.review, role: 'admin'},
        {key: 'maintenance', group: 'staff', icon: 'tool', tag: '维修人员', title: '维修工作区', desc: '查看指派的工单，记录维修进度并提交验收。', target: '#campus/tickets', role: 'technician'},
    ];
    const campusUrl = id => '#campus/' + id;
    const supports = u => u.role === 'admin' || (u.role === 'user' && u.identity === '学生');
    const titleOf = (id, user) => id === 'tickets' && user.role === 'technician' ? '我的维修任务' : items[id]?.[1] || '工作台';

    function nav(user) {
        if (user.role === 'admin') return [
            ['总览', ['overview']],
            ['行政办理', ['admin-services']],
            ['校园设施', ['tickets', 'report', 'map', 'assets', 'facility-overview', 'maintenance']],
            ['系统设置', ['users', 'assistant']],
        ];
        if (user.role === 'technician') return [['服务导航', ['overview', 'tickets', 'map', 'assets']]];
        return [['服务导航', ['overview', ...(supports(user) ? ['admin-services'] : []), 'report', 'tickets', 'map', 'assets']]];
    }
    const allowed = (user, id) => nav(user).some(([, ids]) => ids.includes(id));

    const brand = () => `<span class="site-brand-mark" aria-hidden="true"><svg viewBox="0 0 28 28"><path d="M4 21h20M6 18V9l8-4 8 4v9M10 18v-7m8 7v-7M14 9v9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><strong>CampusCare</strong><span>环球互联大学</span></span>`;
    const commandIcon = () => `${icon('search')} <span>查找服务</span><kbd>Ctrl K</kbd>`;
    const action = (route, title, style = 'btn') => `<button type="button" class="${style}" data-route="${esc(route)}">${title}</button>`;
    const linkArrow = () => ` ${icon('arrow')}`;

    function serviceCards(services) {
        return services.map(item => `<article class="service-tile tone-${item.group}">
            <div class="service-tile-top"><span class="service-glyph">${icon(item.icon)}</span><span class="service-category">${item.tag}</span></div>
            <h3>${item.title}</h3><p>${item.desc}</p>
            ${action(item.target, '办理入口' + linkArrow(), 'service-link')}
        </article>`).join('');
    }

    function shell(user, current) {
        const staff = user.role === 'admin';
        const groups = nav(user);
        const navHtml = groups.map(([group, ids]) => `<div class="workspace-nav-group">${staff ? `<span class="workspace-nav-label">${group}</span>` : ''}${ids.map(id => `<button type="button" class="navitem ${id === current ? 'active' : ''}" data-page="${id}" ${id === current ? 'aria-current="page"' : ''}>${icon(items[id][0])}${titleOf(id, user)}</button>`).join('')}</div>`).join('');
        const profile = `<button type="button" id="profile-button" class="workspace-profile" aria-label="个人资料"><span class="avatar" aria-hidden="true">${esc(user.name?.[0] || '校')}</span><span>${esc(user.name)}</span></button>`;
        const actions = `<div class="top-actions"><button type="button" class="workspace-search" aria-label="查找服务" data-command>${commandIcon()}</button>
            ${staff ? '<button type="button" class="linkbtn" id="mail-settings-button">邮件服务</button>' : ''}${profile}
            <button type="button" class="workspace-logout" data-action="logout" aria-label="退出登录" title="退出登录">${icon('logout')}</button></div>`;
        const sidebar = `<aside class="sidebar"><button type="button" class="site-brand" data-page="overview" aria-label="CampusCare 工作台">${brand()}</button>
            ${staff ? '<div class="workspace-tenant"><span class="workspace-tenant-dot"></span><div><strong>运营工作区</strong><span>GCU 示例校区</span></div></div>' : ''}
            <nav aria-label="${labels[user.role]}导航">${navHtml}</nav>${staff ? '<div class="workspace-sidebar-end">管理人员专用</div>' : ''}</aside>`;
        return `<a href="#content" class="skip-link" data-skip>跳到主要内容</a><div class="shell workspace-shell ${staff ? 'workspace-admin' : 'workspace-member'}">${sidebar}
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
                <span class="editorial-label"><i></i>${tech ? '维修工作区' : 'GCU 校园服务'}</span>
                <h1>${tech ? '维修任务中心' : '你的校园服务门户'}</h1>
                <p>${tech ? '查看已指派的工单，记录维修进度，提交验收。' : '把常用服务、申请进度与报修放在一起。'}</p>
                <div class="as-actions">${student ? action(paths.transcript, '申请成绩单' + linkArrow(), 'btn campus-primary')
                    : action(campusUrl(tech ? 'tickets' : 'report'), (tech ? '查看维修任务' : '发起报修') + linkArrow(), 'btn campus-primary')}
                    ${student ? action(paths.requests, '查看申请', 'btn campus-quiet') : action(campusUrl('map'), '打开校园地图', 'btn campus-quiet')}</div>
            </div><span class="member-hero-stamp">GCU / CAMPUS PLAN</span></section>
            <div class="editorial-head home-section-head"><div><span class="editorial-label"><i></i> SERVICE DIRECTORY</span><h2>${tech ? '维修与定位' : '常用服务'}</h2></div></div>
            <div class="service-grid member-services">${serviceCards(services)}</div>
            <section class="home-activity card"><div class="card-head"><div><h2>${tech ? '维修待办' : '我的办理进度'}</h2><p>来自当前账号可查看的办理记录。</p></div>
                ${action(campusUrl('tickets'), tech ? '全部维修任务' : '查看工单', 'btn secondary')}</div>
                <div class="card-body"><div class="home-activity-grid">
                    <div>${metric(campusUrl('tickets'), tech ? '未完成维修' : '未办结工单', live.length, 'tool')}</div>
                    ${student ? '<div id="workspace-summary" aria-live="polite"><p class="muted">正在读取证明申请进度…</p></div>' : ''}
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
            <h1>校园运营总览</h1><p>把审批、报修和巡检的待办集中到一处。</p></div>
            ${action(paths.review, '进入审批队列' + linkArrow(), 'btn campus-primary')}</section>
            <div class="operations-metrics">
                <div id="workspace-summary" aria-live="polite"><p class="muted">正在读取审批队列…</p></div>
                <div>${metric(campusUrl('tickets'), '待确认报修', unassigned, 'tool')}</div>
                <div>${metric(campusUrl('maintenance'), '待核查巡检', inspections, 'clock')}</div>
            </div>
            <div class="operations-grid">
                <section class="card operations-queue"><div class="card-head"><div><h2>行政办理</h2><p>选择待办范围后，进入对应的审批记录。</p></div></div><div class="card-body">
                    ${operationsLink(paths.unassigned, '领取申请', '打开尚无经办人的待审批记录', 'ticket')}
                    ${operationsLink(paths.mine, '我负责的', '查看由你经办的待审批记录', 'users')}
                    ${operationsLink(paths.guide, '审批指南', '核对资料、补件和转交的操作清单', 'check')}
                </div></section>
                <section class="card operations-queue"><div class="card-head"><div><h2>校园设施</h2><p>${active.length} 条尚未结束的维修工单。</p></div></div><div class="card-body">
                    ${operationsLink(campusUrl('tickets'), '维修工单', '跟进待确认、维修中和待验收记录', 'tool')}
                    ${operationsLink(campusUrl('facility-overview'), '设施运行概览', '查看设施地图、记录状态与区域分布', 'map')}
                    ${operationsLink(campusUrl('users'), '用户管理', '管理角色、账号状态和校园资料', 'users')}
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
                box.innerHTML = metric(paths.review, '待审批申请', data.counts.pending, 'ticket');
            } else {
                box.innerHTML = metric('#admin-services/records?status=needs_materials', '需要补交材料', data.counts.needs_materials, 'ticket');
            }
        } catch (err) {
            if (box.isConnected) {
                box.innerHTML = action(user.role === 'admin' ? paths.review : paths.requests, '打开申请记录' + linkArrow(), 'btn secondary');
            }
        }
    }

    function commandEntries(user) {
        const base = nav(user).flatMap(([, ids]) => ids.map(id => ({
            route: id === 'admin-services' ? '#admin-services' : campusUrl(id),
            title: titleOf(id, user), symbol: items[id][0],
        })));
        const extra = user.role === 'admin' ? [
            {route: paths.review, title: '审批队列', symbol: 'ticket'},
            {route: paths.unassigned, title: '待领取申请', symbol: 'users'},
            {route: paths.mine, title: '我负责的审批', symbol: 'check'},
        ] : supports(user) ? [
            {route: paths.transcript, title: '成绩单申请', symbol: 'ticket'},
            {route: paths.enrollment, title: '在校证明', symbol: 'ticket'},
            {route: paths.requests, title: '我的申请进度', symbol: 'clock'},
        ] : [];
        return [...extra, ...base];
    }

    function openCommand(user, navigate) {
        if ($('#service-command')) return;
        const dialog = document.createElement('dialog');
        dialog.id = 'service-command';
        dialog.className = 'service-command';
        dialog.setAttribute('aria-labelledby', 'command-title');
        dialog.innerHTML = `<div class="command-top"><h2 id="command-title">查找服务</h2><button type="button" class="close" aria-label="关闭搜索">×</button></div>
            <label class="sr-only" for="command-query">搜索服务名称</label><input id="command-query" placeholder="例如：成绩单、报修、用户管理" autocomplete="off">
            <div id="command-results"></div><p class="small muted">↑ ↓ 选择 · Enter 打开 · Esc 关闭</p>`;
        document.body.append(dialog);
        const input = dialog.querySelector('input'), results = dialog.querySelector('#command-results');
        const entries = commandEntries(user);
        let matches = [], active = 0;
        const renderResults = () => {
            results.innerHTML = matches.length ? matches.map((item, i) => `<button type="button" class="command-option ${i === active ? 'active' : ''}" data-command-index="${i}">${icon(item.symbol)}<span>${esc(item.title)}</span>${icon('arrow')}</button>`).join('') : '<p class="empty">没有匹配的服务</p>';
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
