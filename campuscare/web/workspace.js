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
    const categories = [['all', '全部服务'], ['documents', '证明与申请'], ['campus', '校园设施'], ['staff', '员工工作区']];
    const photos = [
        ['uow-mckinnon.webp', '麦金农楼', 'JVPurvis', 'Uni_of_Wollongong_McKinnon_building.JPG'],
        ['uow-science.webp', '科学楼群', 'JVPurvis', 'Uni_of_Wollongong_Science_buildings.JPG'],
        ['uow-smart.webp', 'SMART 基础设施研究楼', 'Nikita Sergey', 'UOW_Smart_Infrastructure_Facility.jpg'],
    ];
    const photoSource = file => 'https://commons.wikimedia.org/wiki/File:' + file;
    const demo = {user: 'student', technician: 'tech', admin: 'admin'};
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

    function serviceCards(services, publicMode = false) {
        return services.map(item => `<article class="service-tile tone-${item.group}">
            <div class="service-tile-top"><span class="service-glyph">${icon(item.icon)}</span><span class="service-category">${item.tag}</span></div>
            <h3>${item.title}</h3><p>${item.desc}</p>
            ${publicMode ? `<button type="button" class="service-link" data-public-service="${item.key}">办理入口${linkArrow()}</button>`
                : action(item.target, '办理入口' + linkArrow(), 'service-link')}
        </article>`).join('');
    }

    function publicCatalog(active = 'all') {
        return serviceCards(catalog.filter(item => active === 'all' || item.group === active), true);
    }

    function landing(role, pending) {
        const selected = catalog.find(item => item.key === pending);
        const title = {user: '校园账号登录', admin: '运营人员登录', technician: '维修人员登录'}[role];
        return `<div class="public-site"><header class="public-header"><div class="site-container public-bar">
            <a class="site-brand" href="#site-top" aria-label="CampusCare 校园服务首页">${brand()}</a>
            <nav aria-label="网站导航"><a href="#service-catalog">服务目录</a><a href="#using-campuscare">使用方式</a></nav>
            <button type="button" class="btn secondary public-signin" data-public-focus>校园账号登录 ${icon('arrow')}</button>
        </div></header>
        <main id="site-top" class="public-main">
            <section class="public-story" aria-label="伍伦贡大学校园照片轮播">
                <div class="campus-photo-stack">${photos.map(([file, label], i) => `<img src="/${file}" alt="伍伦贡大学${label}"
                    class="campus-photo ${i === 0 ? 'active' : ''}" aria-hidden="${i !== 0}" ${i === 0 ? 'fetchpriority="high"' : 'decoding="async"'}>`).join('')}</div>
                <div class="site-container public-story-inner"><div class="public-story-copy"><span class="editorial-label"><i></i> SMARTCAMPUS · CAMPUS SERVICES</span>
                    <h1>校园服务，<br>从这里开始。</h1>
                    <p>在线申请校园证明、查找设施和跟进报修。每项事务都有清楚的入口和办理进度。</p>
                    <div class="as-actions"><a class="btn campus-primary" href="#service-catalog">浏览服务目录 ${icon('arrow')}</a>
                        <button type="button" class="btn campus-quiet" data-public-focus>登录办理</button></div></div>
                    <div class="photo-toolbar"><div class="photo-credit" aria-live="polite"><span>伍伦贡大学校园实景</span>
                        <a id="campus-photo-credit" href="${photoSource(photos[0][3])}" target="_blank" rel="noopener">麦金农楼 · JVPurvis</a>
                        <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC BY-SA 3.0</a></div>
                        <div class="photo-controls"><button type="button" data-slide-step="-1" aria-label="上一张校园照片">‹</button>
                            <div class="photo-dots">${photos.map(([, label], i) => `<button type="button" data-slide-index="${i}" aria-label="查看${label}" aria-pressed="${i === 0}"></button>`).join('')}</div>
                            <button type="button" data-slide-step="1" aria-label="下一张校园照片">›</button></div></div>
                </div>
            </section>
            <div class="site-container public-body">
            <div class="public-intro" id="campus-account">
                <section class="public-intro-copy"><span class="editorial-label"><i></i> YOUR CAMPUS, CONNECTED</span>
                    <h2>从校园生活出发，<br>让每件事都有回应。</h2>
                    <p>CampusCare 是 SmartCampus 的课程演示。师生、维修人员和管理人员登录同一入口，按身份进入各自的服务与工作区。</p>
                    <a href="#using-campuscare" class="service-link">了解使用方式 ${icon('arrow')}</a>
                    <p class="public-photo-note">首页实景照片用于展示伍伦贡大学校园。服务、地图和账号为课程演示，与大学官方系统无关。</p>
                </section>
                <section class="login-form sign-in-card" id="campus-signin" aria-label="校园账号登录">
                    <div class="sign-in-mark">${icon('users')}</div>
                    <h2>${title}</h2><p class="subtitle">${selected ? '登录后将打开：' + selected.title : '选择身份，用校园账号进入对应服务。'}</p>
                    <div class="role-pills" role="group" aria-label="选择登录身份">${[['user', '学生 / 老师'], ['technician', '维修人员'], ['admin', '管理人员']].map(([key, label]) => `<button type="button" class="role-pill ${role === key ? 'active' : ''}" data-role="${key}" aria-pressed="${role === key}">${label}</button>`).join('')}</div>
                    <form id="login-form">
                        <label for="account">用户名 / 邮箱</label>
                        <input id="account" list="demo-accounts" value="${demo[role]}" autocomplete="username" placeholder="用户名或注册邮箱" required>
                        <datalist id="demo-accounts">${['student','teacher','tech','plumber','it','admin'].map(id => `<option value="${id}"></option>`).join('')}</datalist>
                        <label for="password">密码</label><div class="sign-in-secret"><input id="password" type="password" value="Campus2026!" autocomplete="current-password" required>
                            <button type="button" id="password-visibility" class="linkbtn" aria-pressed="false">显示</button></div>
                        <p id="login-error" class="error" role="alert"></p>
                        <button class="btn" type="submit">进入工作台 ${icon('arrow')}</button>
                    </form>
                    <div class="sign-in-links"><button type="button" class="linkbtn" id="register-link">没有账号？注册</button><button type="button" class="linkbtn" id="reset-link">忘记密码？</button></div>
                    <details class="demo-access"><summary>演示账号说明</summary><p>学生 student · 教师 teacher · 维修 tech · 管理 admin<br>演示密码：Campus2026!</p></details>
                </section>
            </div>
            <section class="public-directory" id="service-catalog" aria-labelledby="catalog-heading">
                <div class="editorial-head"><div><span class="editorial-label"><i></i> SERVICE DIRECTORY</span><h2 id="catalog-heading">找到你要办的事</h2><p>按类别浏览服务，选择入口后登录即可办理。</p></div>
                <div class="directory-tabs" role="group" aria-label="服务分类">${categories.map(([key, label]) => `<button type="button" data-public-filter="${key}" aria-pressed="${key === 'all'}">${label}</button>`).join('')}</div></div>
                <div class="service-grid" id="public-services" aria-live="polite">${publicCatalog()}</div>
            </section>
            <section class="public-steps" id="using-campuscare"><div><span class="editorial-label"><i></i> HOW IT WORKS</span><h2>从提交到办结</h2><p>登录后会按你的身份展示可办理的服务与记录。</p></div>
                <ol><li><span>01</span><strong>找到服务</strong><p>按类别选择证明、报修或校园导览。</p></li>
                <li><span>02</span><strong>提交事项</strong><p>核对资料，填写用途或问题，按需上传材料。</p></li>
                <li><span>03</span><strong>跟进进度</strong><p>在申请或工单详情中查看处理结果。</p></li></ol>
            </section>
            </div></main></div>`;
    }

    function bindGallery() {
        const root = $('.public-story');
        if (!root) return;
        const pictures = [...root.querySelectorAll('.campus-photo')];
        const dots = [...root.querySelectorAll('[data-slide-index]')];
        const credit = root.querySelector('#campus-photo-credit');
        let current = 0;
        function show(next) {
            current = (next + photos.length) % photos.length;
            pictures.forEach((image, index) => {
                image.classList.toggle('active', index === current);
                image.setAttribute('aria-hidden', index !== current);
                dots[index].setAttribute('aria-pressed', index === current);
            });
            const [, label, author, file] = photos[current];
            credit.textContent = label + ' · ' + author;
            credit.href = photoSource(file);
        }
        root.querySelectorAll('[data-slide-step]').forEach(button => button.onclick = () => show(current + Number(button.dataset.slideStep)));
        dots.forEach((button, index) => button.onclick = () => show(index));
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

    return {allowed, campusUrl, landing, publicCatalog, catalog, shell, bindHome, openCommand, bindGallery,
        home: state => state.user.role === 'admin' ? adminHome(state) : membersHome(state)};
})();
