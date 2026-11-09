'use strict';
// Adapted from Little Wonders by uiuxlabz. Source and license: docs/PORTAL.md.
const publicLanding = (function () {
    const photos = [
        ['gcu-quadrangle.webp', '中央庭院', '暖色教学楼环绕绿地，学生沿庭院步行'],
        ['gcu-learning-commons.webp', '共享学习空间', '来自不同背景的学生在明亮的学习空间共同讨论'],
        ['gcu-campus-walk.webp', '校园步道', '学生沿林荫步道穿行于教学楼之间'],
    ];
    const categories = [['all', '全部服务'], ['documents', '行政服务'], ['campus', '设施与资源'], ['staff', '人员工作区']];
    const demo = {user: 'student', technician: 'tech', admin: 'admin'};
    const servicePhotos = {transcript: 0, enrollment: 1, report: 2, map: 1, review: 2, maintenance: 0};
    let dispose = () => {};

    // Adapted from the template's class-card markup and its original tag/image layout.
    function cards(active = 'all') {
        return workspace.catalog.filter(item => active === 'all' || item.group === active).map(item => {
            const [file] = photos[servicePhotos[item.key]];
            return `<article class="class-card">
                <div class="class-img-wrap"><img src="/${file}" alt="" class="class-img" loading="lazy"><span class="class-tag">${item.tag}</span></div>
                <div class="class-body"><h3 class="class-name">${item.title}</h3>
                    <p class="class-desc">${item.desc}</p>
                    <button type="button" class="btn btn-primary btn-sm" data-public-service="${item.key}">办理入口 ${icon('arrow')}</button></div>
            </article>`;
        }).join('');
    }

    function account(role, pending) {
        const selected = workspace.catalog.find(item => item.key === pending);
        const title = {user: '校园账号登录', admin: '运营人员登录', technician: '维修人员登录'}[role];
        return `<section class="section section-coral" id="campus-account">
            <div class="container">
                <div class="section-head"><h2 class="section-title">账号登录</h2></div>
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
            </div></header>
            <main id="main" tabindex="-1">
                <section class="hero" id="hero" aria-label="GCU 校园图景轮播">
                    <div class="hero-bg">${photos.map(([file, , description], i) => `<img src="/${file}" alt="${description}"
                        class="campus-photo ${i === 0 ? 'active' : ''}" aria-hidden="${i !== 0}" ${i === 0 ? 'fetchpriority="high"' : 'decoding="async"'}>`).join('')}</div>
                    <div class="hero-shade" aria-hidden="true"></div>
                    <div class="container hero-copy"><div class="hero-text">
                        <p class="eyebrow">GLOBALCONNECT UNIVERSITY</p>
                        <h1 class="hero-title">GCU <em>校园服务</em></h1>
                        <p class="hero-sub">行政服务 · 设施与资源管理</p>
                        <div class="hero-actions"><a href="#service-catalog" class="btn btn-primary">浏览服务 ${icon('arrow')}</a>
                            <button type="button" class="btn btn-ghost-light" data-public-focus>登录办理</button></div>
                        </div>
                        <div class="hero-badge"><span class="hero-badge-num">GCU</span><span class="hero-badge-label">SmartCampus<br>虚拟示例校区</span></div>
                    </div>
                    <div class="container campus-hero-tools"><div class="photo-caption"><span>GCU 校园概念图</span>
                        <strong id="campus-photo-caption">${photos[0][1]}</strong></div>
                        <div class="photo-controls">
                            <button type="button" data-slide-step="-1" aria-label="上一张校园照片">‹</button>
                            <div class="photo-dots">${photos.map(([, title], i) => `<button type="button" data-slide-index="${i}" aria-label="查看${title}" aria-pressed="${i === 0}"></button>`).join('')}</div>
                            <button type="button" data-slide-step="1" aria-label="下一张校园照片">›</button>
                            <button type="button" class="gallery-play" aria-label="暂停轮播">Ⅱ</button>
                        </div>
                    </div>
                </section>
                <section class="section ribbon-section" aria-label="快捷服务"><div class="container">
                    <div class="ribbon">${workspace.catalog.map(item => `<button type="button" class="ribbon-item" data-public-service="${item.key}">
                        <span class="ribbon-icon" aria-hidden="true">${icon(item.icon)}</span><span class="ribbon-label">${item.title}</span></button>`).join('')}</div>
                </div></section>
                <section class="section section-cream" id="using-campuscare"><div class="container">
                    <div class="split"><div class="split-img">
                        <img src="/${photos[1][0]}" alt="${photos[1][2]}" class="split-photo" loading="lazy">
                        <div class="split-badge"><span class="split-badge-num">GCU</span><span class="split-badge-label">共享学习空间</span></div>
                    </div><div class="split-copy">
                        <h2 class="section-title">校园服务<em>概览</em></h2>
                        <p>GlobalConnect University（GCU）</p>
                        <ul class="check-list"><li>行政服务：成绩单申请、在校证明申请、申请进度查询</li>
                            <li>设施与资源管理：校园地图、设施查询、在线报修</li>
                            <li>运营管理：行政审批、工单派发、设施巡检</li></ul>
                        <a href="#campus-gallery" class="btn btn-ghost-dark">浏览校园图景 ${icon('arrow')}</a>
                    </div></div>
                </div></section>
                <section class="section service-directory" id="service-catalog" aria-labelledby="catalog-heading">
                    <div class="container"><div class="section-head">
                        <h2 class="section-title" id="catalog-heading">校园<em>服务目录</em></h2></div>
                        <div class="directory-tabs" role="group" aria-label="服务分类">${categories.map(([key, label]) =>
            `<button type="button" data-public-filter="${key}" aria-pressed="${key === 'all'}">${label}</button>`).join('')}</div>
                        <div class="class-grid" id="public-services" aria-live="polite">${cards()}</div>
                    </div></section>
                ${account(role, pending)}
                <section class="section section-cream" id="campus-gallery"><div class="container">
                    <div class="section-head"><p class="eyebrow">CAMPUS GALLERY</p><h2 class="section-title">走进<em>GCU 校园</em></h2>
                        <p>为本项目生成的校园概念图。点击图片可放大并切换场景。</p></div>
                    <div class="gallery-grid">${photos.map(([file, title, description], index) => `<figure class="campus-gallery-card">
                        <a href="/${file}" class="gallery-item" target="_blank" rel="noopener" data-campus-viewer="${index}" aria-label="查看${title}大图">
                        <img src="/${file}" alt="${description}" loading="lazy"></a>
                        <figcaption>${title}</figcaption></figure>`).join('')}</div>
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
            index = (index + step + photos.length) % photos.length;
            const [file, title, description] = photos[index];
            viewer.querySelector('h2').textContent = title;
            viewer.querySelector('.viewer-count').textContent = `${index + 1} / ${photos.length}`;
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
        const dots = [...root.querySelectorAll('[data-slide-index]')];
        const caption = root.querySelector('#campus-photo-caption');
        const pause = root.querySelector('.gallery-play');
        const controls = root.querySelector('.photo-controls');
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const toggle = root.querySelector('.nav-toggle');
        const links = root.querySelector('.nav-links');
        let current = 0, playing = !motion.matches, timer;
        function show(next) {
            current = (next + photos.length) % photos.length;
            pictures.forEach((image, index) => {
                image.classList.toggle('active', index === current);
                image.setAttribute('aria-hidden', index !== current);
                dots[index].setAttribute('aria-pressed', index === current);
            });
            caption.textContent = photos[current][1];
        }
        function play(active) {
            playing = active;
            root.classList.toggle('gallery-playing', active);
            clearInterval(timer);
            pause.textContent = playing ? 'Ⅱ' : '▷';
            pause.setAttribute('aria-label', playing ? '暂停轮播' : '播放轮播');
            if (playing) timer = setInterval(() => {
                if (root.isConnected && !document.hidden && !root.querySelector('.campus-viewer[open]')
                    && !controls.matches(':hover') && !controls.contains(document.activeElement)) show(current + 1);
            }, 5500);
        }
        root.querySelectorAll('[data-slide-step]').forEach(button => button.addEventListener('click', () => {
            show(current + Number(button.dataset.slideStep));
            play(playing);
        }, opts));
        dots.forEach((button, index) => button.addEventListener('click', () => { show(index); play(playing); }, opts));
        pause.addEventListener('click', () => play(!playing), opts);
        motion.addEventListener('change', e => { if (e.matches) play(false); }, opts);
        play(playing);
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
