'use strict';
// Adapted from Little Wonders by uiuxlabz. Source and license: docs/PORTAL.md.
const publicLanding = (function () {
    const photos = [
        ['uow-mckinnon.webp', '麦金农楼', 'JVPurvis', 'Uni_of_Wollongong_McKinnon_building.JPG'],
        ['uow-science.webp', '科学楼群', 'JVPurvis', 'Uni_of_Wollongong_Science_buildings.JPG'],
        ['uow-smart.webp', 'SMART 基础设施研究楼', 'Nikita Sergey', 'UOW_Smart_Infrastructure_Facility.jpg'],
    ];
    const categories = [['all', '全部服务'], ['documents', '证明与申请'], ['campus', '校园设施'], ['staff', '员工工作区']];
    const demo = {user: 'student', technician: 'tech', admin: 'admin'};
    const license = 'https://creativecommons.org/licenses/by-sa/3.0/';
    const photoSource = file => 'https://commons.wikimedia.org/wiki/File:' + file;
    const servicePhotos = {transcript: 0, enrollment: 1, report: 2, map: 1, review: 2, maintenance: 0};
    let dispose = () => {};

    function credits([, label, author, source]) {
        return `<a href="${photoSource(source)}" target="_blank" rel="noopener">${label} · ${author}</a>
                <a href="${license}" target="_blank" rel="noopener">CC BY-SA 3.0</a>`;
    }

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
                <div class="section-head"><p class="eyebrow">CAMPUS ACCOUNT</p><h2 class="section-title">用校园账号<em>登录办理</em></h2></div>
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
                    <details class="demo-access"><summary>演示账号说明</summary><p>学生 student · 教师 teacher · 维修 tech · 管理 admin<br>演示密码：Campus2026!</p></details>
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
                <p class="topbar-item topbar-end"><a href="#campus-gallery">伍伦贡大学校园实景</a></p>
            </div></div>
            <header class="site-header"><div class="container nav-wrap">
                <a href="#top" class="brand" aria-label="CampusCare 首页"><span class="brand-mark" aria-hidden="true"></span>
                    <span class="brand-text">Campus<span>Care</span></span></a>
                <button type="button" class="nav-toggle" aria-label="打开菜单" aria-expanded="false" aria-controls="site-nav">☰</button>
                <nav class="nav-links" id="site-nav" aria-label="网站导航">
                    <a href="#top" class="nav-link active" aria-current="location">首页</a>
                    <a href="#using-campuscare" class="nav-link">关于门户</a>
                    <a href="#service-catalog" class="nav-link">服务目录</a>
                    <a href="#campus-gallery" class="nav-link">校园相册</a>
                    <button type="button" class="nav-cta" data-public-focus>校园账号登录 ${icon('arrow')}</button>
                </nav>
            </div></header>
            <main id="main" tabindex="-1">
                <section class="hero" id="hero" aria-label="伍伦贡大学校园照片轮播">
                    <div class="hero-bg">${photos.map(([file, title], i) => `<img src="/${file}" alt="伍伦贡大学${title}"
                        class="campus-photo ${i === 0 ? 'active' : ''}" aria-hidden="${i !== 0}" ${i === 0 ? 'fetchpriority="high"' : 'decoding="async"'}>`).join('')}</div>
                    <div class="hero-shade" aria-hidden="true"></div>
                    <div class="container hero-copy"><div class="hero-text">
                        <p class="eyebrow">SMARTCAMPUS · 校园服务</p>
                        <h1 class="hero-title">校园服务，<br><em>从这里开始。</em></h1>
                        <p class="hero-sub">从成绩单和在校证明，到设施查询和报修，一个入口就能找到要办的事。</p>
                        <div class="hero-actions"><a href="#service-catalog" class="btn btn-primary">浏览服务 ${icon('arrow')}</a>
                            <button type="button" class="btn btn-ghost-light" data-public-focus>登录办理</button></div>
                        </div>
                        <div class="hero-badge"><span class="hero-badge-num">GCU</span><span class="hero-badge-label">SmartCampus<br>虚拟示例校区</span></div>
                    </div>
                    <div class="container campus-hero-tools"><div class="photo-credit"><span>伍伦贡大学校园实景</span>
                        <a id="campus-photo-credit" href="${photoSource(photos[0][3])}" target="_blank" rel="noopener">麦金农楼 · JVPurvis</a>
                        <a href="${license}" target="_blank" rel="noopener">CC BY-SA 3.0</a></div>
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
                        <img src="/uow-science.webp" alt="伍伦贡大学科学楼群与校园绿地" class="split-photo" loading="lazy">
                        <div class="split-badge"><span class="split-badge-num">UOW</span><span class="split-badge-label">伍伦贡大学校园实景</span></div>
                    </div><div class="split-copy">
                        <p class="eyebrow">关于 SmartCampus</p>
                        <h2 class="section-title">把校园事务<em>集中到一个入口</em></h2>
                        <p>CampusCare 是面向虚拟 GCU 校区的课程项目。照片展示真实校园风貌，本站账号、地图和办理记录属于演示系统。</p>
                        <ul class="check-list"><li>学生在线提交证明申请，随时查看审批进度</li>
                            <li>师生按楼栋和设施提交报修，跟进维修结果</li>
                            <li>管理人员和维修人员登录各自的工作区</li></ul>
                        <a href="#campus-gallery" class="btn btn-ghost-dark">浏览校园相册 ${icon('arrow')}</a>
                    </div></div>
                </div></section>
                <section class="section service-directory" id="service-catalog" aria-labelledby="catalog-heading">
                    <div class="container"><div class="section-head"><p class="eyebrow">CAMPUS SERVICES</p>
                        <h2 class="section-title" id="catalog-heading">找到<em>你要办的事</em></h2>
                        <p>按类别筛选，选择服务后登录即可办理。</p></div>
                        <div class="directory-tabs" role="group" aria-label="服务分类">${categories.map(([key, label]) =>
            `<button type="button" data-public-filter="${key}" aria-pressed="${key === 'all'}">${label}</button>`).join('')}</div>
                        <div class="class-grid" id="public-services" aria-live="polite">${cards()}</div>
                    </div></section>
                ${account(role, pending)}
                <section class="section section-cream" id="campus-gallery"><div class="container">
                    <div class="section-head"><p class="eyebrow">CAMPUS GALLERY</p><h2 class="section-title">走进<em>伍伦贡大学</em></h2>
                        <p>点击照片查看大图。</p></div>
                    <div class="gallery-grid">${photos.map(photo => `<figure class="campus-gallery-card">
                        <a href="/${photo[0]}" class="gallery-item" target="_blank" rel="noopener" aria-label="查看${photo[1]}大图">
                        <img src="/${photo[0]}" alt="伍伦贡大学${photo[1]}" loading="lazy"></a>
                        <figcaption>${credits(photo)}</figcaption></figure>`).join('')}</div>
                </div></section>
            </main></div>`;
    }

    function bind() {
        dispose();
        const root = $('.public-site');
        const abort = new AbortController();
        const opts = {signal: abort.signal};
        const pictures = [...root.querySelectorAll('.hero-bg img')];
        const dots = [...root.querySelectorAll('[data-slide-index]')];
        const credit = root.querySelector('#campus-photo-credit');
        const pause = root.querySelector('.gallery-play');
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
            const [, label, author, file] = photos[current];
            credit.textContent = label + ' · ' + author;
            credit.href = photoSource(file);
        }
        function play(active) {
            playing = active;
            clearInterval(timer);
            pause.textContent = playing ? 'Ⅱ' : '▷';
            pause.setAttribute('aria-label', playing ? '暂停轮播' : '播放轮播');
            if (playing) timer = setInterval(() => {
                if (root.isConnected && !document.hidden) show(current + 1);
            }, 7000);
        }
        root.querySelectorAll('[data-slide-step]').forEach(button => button.addEventListener('click', () => {
            play(false);
            show(current + Number(button.dataset.slideStep));
        }, opts));
        dots.forEach((button, index) => button.addEventListener('click', () => { play(false); show(index); }, opts));
        pause.addEventListener('click', () => play(!playing), opts);
        motion.addEventListener('change', e => { if (e.matches) play(false); }, opts);
        play(playing);

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
