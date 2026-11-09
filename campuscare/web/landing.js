'use strict';
// Adapted from Little Wonders by uiuxlabz. Source and license: docs/PORTAL.md.
const publicLanding = (function () {
    const bannerPhotos = [
        ['gcu-quadrangle.webp', '暖色教学楼环绕绿地，学生沿庭院步行'],
        ['gcu-library-terrace.webp', '学生穿过图书馆露台前的绿植庭院'],
        ['gcu-campus-garden.webp', '树荫、草丛和木桥环绕校园花园'],
    ];
    const [overviewFile, overviewDescription] = ['gcu-learning-commons.webp', '来自不同背景的学生在明亮的学习空间共同讨论'];
    const galleryPhotos = [
        ['gcu-campus-walk.webp', '校园步道', '学生沿林荫步道穿行于教学楼之间'],
        ['gcu-gallery-studio.webp', '设计工作室', '学生在设计工作室的长桌旁制作建筑模型'],
        ['gcu-gallery-atrium.webp', '教学楼中庭', '天窗下的中庭设有多层木质楼梯与绿植'],
    ];
    const categories = [['all', '全部服务'], ['documents', '行政服务'], ['campus', '设施与资源'], ['staff', '人员工作区']];
    const demo = {user: 'student', technician: 'tech', admin: 'admin'};
    const servicePhotos = {
        transcript: 'gcu-service-transcript.webp', enrollment: 'gcu-service-enrollment.webp',
        report: 'gcu-service-repair.webp', map: 'gcu-service-map.webp',
        review: 'gcu-service-review.webp', maintenance: 'gcu-service-maintenance.webp',
    };
    const serviceAudiences = {transcript: '学生', enrollment: '学生', report: '学生 / 教师', map: '校内用户', review: '管理人员', maintenance: '维修人员'};
    const counter = index => String(index + 1).padStart(2, '0');
    let dispose = () => {};

    // Adapted from the template's class-card markup and its original tag/image layout.
    function cards(active = 'all') {
        return workspace.catalog.map((item, index) => ({item, index}))
            .filter(({item}) => active === 'all' || item.group === active).map(({item, index}) => {
            const file = servicePhotos[item.key];
            return `<article class="class-card" data-service-group="${item.group}">
                <div class="class-img-wrap" data-parallax="13"><img src="/${file}" alt="" class="class-img" loading="lazy">
                    <span class="class-tag">${item.group === 'staff' ? '人员工作区' : item.tag}</span><span class="class-index" aria-hidden="true">${counter(index)}</span></div>
                <div class="class-body"><div class="class-title-row"><span class="class-symbol" aria-hidden="true">${icon(item.icon)}</span><h3 class="class-name">${item.title}</h3></div>
                    <p class="class-desc">${item.desc}</p>
                    <div class="class-actions"><span class="class-audience">${icon('users')} ${serviceAudiences[item.key]}</span>
                        <button type="button" class="btn btn-primary btn-sm" data-public-service="${item.key}">办理入口 ${icon('arrow')}</button></div></div>
            </article>`;
        }).join('');
    }

    const sectionMarker = symbol => `<span class="section-marker" aria-hidden="true">${icon(symbol)}</span>`;

    function account(role, pending) {
        const selected = workspace.catalog.find(item => item.key === pending);
        const title = {user: '校园账号登录', admin: '运营人员登录', technician: '维修人员登录'}[role];
        return `<section class="section section-coral" id="campus-account">
            <div class="container">
                <div class="section-head">${sectionMarker('users')}<h2 class="section-title">账号登录</h2></div>
                <div class="form-wrap login-form" id="campus-signin" aria-label="校园账号登录">
                    <h2 class="login-title">${title}</h2><p class="subtitle">${selected ? '登录后将打开：' + selected.title : '选择身份，进入你的服务与工作区。'}</p>
                    <div class="role-pills" role="group" aria-label="选择登录身份">
                        ${[['user', '学生 / 老师'], ['technician', '维修人员'], ['admin', '管理人员']].map(([key, label]) =>
            `<button type="button" class="role-pill ${role === key ? 'active' : ''}" data-role="${key}" aria-pressed="${role === key}">${label}</button>`).join('')}
                    </div>
                    <form id="login-form" class="enroll-form">
                        <div class="form-field"><label for="account">用户名 / 邮箱</label>
                        <input id="account" list="demo-accounts" value="${demo[role]}" autocomplete="username" placeholder="用户名或注册邮箱" required>
                        <datalist id="demo-accounts">${['student','teacher','tech','plumber','it','admin'].map(id => `<option value="${id}"></option>`).join('')}</datalist></div>
                        <div class="form-field"><label for="password">密码</label><div class="sign-in-secret">
                            <input id="password" type="password" value="Campus2026!" autocomplete="current-password" required>
                            <button type="button" id="password-visibility" class="linkbtn" aria-pressed="false">显示</button></div></div>
                        <p id="login-error" class="error" role="alert"></p><button class="btn btn-primary" type="submit">进入工作台 ${icon('arrow')}</button>
                    </form>
                    <div class="sign-in-links"><button type="button" class="linkbtn" id="register-link">没有账号？注册</button>
                    <button type="button" class="linkbtn" id="reset-link">忘记密码？</button></div>
                </div>
            </div></section>`;
    }

    // Preserves the upstream structure: topbar → site header → hero → ribbon
    // → about split → class grid → enrollment → gallery. Business actions are ours.
    function render(role, pending) {
        return `<div class="public-site" id="top">
            <a class="skip-link" href="#main">跳到主要内容</a>
            <div class="topbar"><div class="container topbar-inner">
                <p class="topbar-item"><span class="topbar-icon">${icon('map')}</span> GlobalConnect University · 示例校区</p>
                <p class="topbar-item topbar-mid">SmartCampus 校园服务门户</p>
                <p class="topbar-item topbar-end"><a href="#campus-gallery">GCU 校园图景</a></p>
            </div></div>
            <header class="site-header"><div class="container nav-wrap">
                <a href="#top" class="brand" aria-label="CampusCare 首页"><span class="brand-mark" aria-hidden="true"></span>
                    <span class="brand-text">Campus<span>Care</span></span></a>
                <button type="button" class="nav-toggle" aria-label="打开菜单" aria-expanded="false" aria-controls="site-nav">☰</button>
                <nav class="nav-links" id="site-nav" aria-label="网站导航">
                    <a href="#top" class="nav-link active" aria-current="location">首页</a>
                    <a href="#using-campuscare" class="nav-link">关于门户</a>
                    <a href="#service-catalog" class="nav-link">服务目录</a>
                    <a href="#campus-gallery" class="nav-link">校园图景</a>
                    <button type="button" class="nav-cta" data-public-focus>校园账号登录 ${icon('arrow')}</button>
                </nav>
            </div><span class="scroll-meter" aria-hidden="true"></span></header>
            <main id="main" tabindex="-1">
                <section class="hero" id="hero" aria-labelledby="hero-title">
                    <div class="hero-bg" data-parallax="32">${bannerPhotos.map(([file, description], i) => `<img src="/${file}" alt="${description}"
                        class="campus-photo ${i === 0 ? 'active' : ''}" aria-hidden="${i !== 0}" ${i === 0 ? 'fetchpriority="high"' : 'decoding="async"'}>`).join('')}</div>
                    <div class="container hero-copy"><h1 class="hero-title" id="hero-title">校园服务</h1></div>
                </section>
                <section class="section ribbon-section" aria-label="快捷服务"><div class="container">
                    <div class="ribbon">${workspace.catalog.map(item => `<button type="button" class="ribbon-item" data-public-service="${item.key}">
                        <span class="ribbon-icon" aria-hidden="true">${icon(item.icon)}</span><span class="ribbon-label">${item.title}</span></button>`).join('')}</div>
                </div></section>
                <section class="section section-cream" id="using-campuscare"><div class="container">
                    <div class="split"><div class="split-img">
                        <div class="split-photo-frame" data-parallax="24"><img src="/${overviewFile}" alt="${overviewDescription}" class="split-photo" loading="lazy"></div>
                    </div><div class="split-copy">
                        ${sectionMarker('grid')}
                        <h2 class="section-title">校园服务<em>概览</em></h2>
                        <p>GlobalConnect University（GCU）</p>
                        <ul class="check-list"><li>行政服务：成绩单申请、在校证明申请、申请进度查询</li>
                            <li>设施与资源管理：校园地图、设施查询、在线报修</li>
                            <li>运营管理：行政审批、工单派发、设施巡检</li></ul>
                        <a href="#campus-gallery" class="btn btn-ghost-dark">浏览校园图景 ${icon('arrow')}</a>
                    </div></div>
                </div></section>
                <section class="section service-directory" id="service-catalog" aria-labelledby="catalog-heading">
                    <div class="container"><div class="section-head">${sectionMarker('ticket')}
                        <h2 class="section-title" id="catalog-heading">校园<em>服务目录</em></h2></div>
                        <div class="directory-tabs" role="group" aria-label="服务分类">${categories.map(([key, label]) =>
            `<button type="button" data-public-filter="${key}" aria-pressed="${key === 'all'}">${label}</button>`).join('')}</div>
                        <div class="class-grid" id="public-services" aria-live="polite">${cards()}</div>
                    </div></section>
                ${account(role, pending)}
                <section class="section section-cream" id="campus-gallery"><div class="container">
                    <div class="section-head">${sectionMarker('image')}<h2 class="section-title">GCU <em>校园图景</em></h2>
                        <p>为本项目生成的校园概念图。点击图片可放大并切换场景。</p>
                        <button type="button" class="linkbtn gallery-play" aria-controls="hero">暂停首页轮播</button></div>
                    <div class="gallery-grid">${galleryPhotos.map(([file, title, description], index) => `<figure class="campus-gallery-card">
                        <a href="/${file}" class="gallery-item" target="_blank" rel="noopener" data-campus-viewer="${index}" data-parallax="17" aria-label="查看${title}大图">
                        <img src="/${file}" alt="${description}" loading="lazy"></a>
                        <figcaption><span aria-hidden="true">${counter(index)}</span>${title}</figcaption></figure>`).join('')}</div>
                </div></section>
            </main></div>`;
    }

    function openViewer(root, selected, trigger) {
        if (root.querySelector('.campus-viewer')) return;
        const viewer = document.createElement('dialog');
        viewer.className = 'campus-viewer';
        viewer.setAttribute('aria-labelledby', 'campus-viewer-title');
        viewer.innerHTML = `<div class="viewer-bar">
            <div><p class="viewer-kicker">GCU 校园图景</p><h2 id="campus-viewer-title"></h2></div>
            <button type="button" class="viewer-icon viewer-close" aria-label="关闭大图">×</button>
        </div>
        <div class="viewer-stage"></div>
        <div class="viewer-bar viewer-footer"><p class="viewer-count" aria-live="polite"></p>
            <div class="viewer-actions"><button type="button" class="viewer-icon viewer-prev" aria-label="大图上一张">‹</button>
                <button type="button" class="viewer-icon viewer-next" aria-label="大图下一张">›</button></div>
        </div>`;
        let index = selected;
        const show = step => {
            index = (index + step + galleryPhotos.length) % galleryPhotos.length;
            const [file, title, description] = galleryPhotos[index];
            viewer.querySelector('h2').textContent = title;
            viewer.querySelector('.viewer-count').textContent = `${index + 1} / ${galleryPhotos.length}`;
            const image = new Image();
            image.src = '/' + file;
            image.alt = description;
            viewer.querySelector('.viewer-stage').replaceChildren(image);
        };
        viewer.querySelector('.viewer-close').onclick = () => viewer.close();
        viewer.querySelector('.viewer-prev').onclick = () => show(-1);
        viewer.querySelector('.viewer-next').onclick = () => show(1);
        viewer.addEventListener('keydown', event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                show(event.key === 'ArrowLeft' ? -1 : 1);
            }
        });
        viewer.addEventListener('click', event => {
            if (event.target !== viewer) return;
            const box = viewer.getBoundingClientRect();
            if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) viewer.close();
        });
        viewer.addEventListener('close', () => {
            viewer.remove();
            trigger.focus({preventScroll: true});
        }, {once: true});
        root.append(viewer);
        show(0);
        viewer.showModal();
        viewer.querySelector('.viewer-close').focus();
    }

    function bind() {
        dispose();
        const root = $('.public-site');
        const abort = new AbortController();
        const opts = {signal: abort.signal};
        const pictures = [...root.querySelectorAll('.hero-bg img')];
        const pause = root.querySelector('.gallery-play');
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const toggle = root.querySelector('.nav-toggle');
        const links = root.querySelector('.nav-links');
        let current = 0, playing, timer;
        function show(next) {
            current = (next + pictures.length) % pictures.length;
            pictures.forEach((image, index) => {
                image.classList.toggle('active', index === current);
                image.setAttribute('aria-hidden', index !== current);
            });
        }
        function play(active) {
            playing = active;
            root.classList.toggle('gallery-playing', active);
            clearInterval(timer);
            pause.textContent = playing ? '暂停首页轮播' : '播放首页轮播';
            if (playing) timer = setInterval(() => {
                if (root.isConnected && !document.hidden && !root.querySelector('.campus-viewer[open]')) show(current + 1);
            }, 5500);
        }
        pause.addEventListener('click', () => play(!playing), opts);
        motion.addEventListener('change', e => { if (e.matches) play(false); }, opts);
        play(!motion.matches);
        root.querySelector('#campus-gallery').addEventListener('click', event => {
            const link = event.target.closest('[data-campus-viewer]');
            if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault();
            openViewer(root, Number(link.dataset.campusViewer), link);
        }, opts);

        function setMenu(open) {
            links.classList.toggle('open', open);
            toggle.classList.toggle('open', open);
            toggle.setAttribute('aria-expanded', open);
            toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
        }
        toggle.addEventListener('click', () => setMenu(!links.classList.contains('open')), opts);
        document.addEventListener('click', e => {
            if (!toggle.contains(e.target) && !links.contains(e.target)) setMenu(false);
        }, opts);
        links.addEventListener('click', e => {
            const link = e.target.closest('.nav-link');
            if (link) {
                links.querySelectorAll('.nav-link').forEach(item => {
                    item.classList.toggle('active', item === link);
                    if (item === link) item.setAttribute('aria-current', 'location');
                    else item.removeAttribute('aria-current');
                });
            }
            if (e.target.closest('a,button')) setMenu(false);
        }, opts);
        root.addEventListener('keydown', e => {
            if (e.key === 'Escape' && links.classList.contains('open')) { setMenu(false); toggle.focus(); }
        }, opts);
        dispose = () => { clearInterval(timer); abort.abort(); };
    }

    return {render, cards, bind, unbind: () => dispose()};
})();
