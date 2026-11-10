'use strict';
// Adapted from Little Wonders by uiuxlabz. Source and license: docs/PORTAL.md.
const publicLanding = (function () {
    const bannerPhotos = [
        ['gcu-quadrangle.webp', 'Students walking across a landscaped academic courtyard'],
        ['gcu-library-terrace.webp', 'Students crossing the garden outside the library terrace'],
        ['gcu-campus-garden.webp', 'A wooden footbridge in a shaded campus garden'],
    ];
    const [overviewFile, overviewDescription] = ['gcu-learning-commons.webp', 'Students collaborating in a light-filled learning commons'];
    const galleryPhotos = [
        ['gcu-campus-walk.webp', 'Campus Walkway', 'Students walking along a tree-lined path between academic buildings'],
        ['gcu-gallery-studio.webp', 'Design Studio', 'Students building architectural models in a design studio'],
        ['gcu-gallery-atrium.webp', 'Academic Atrium', 'A skylit atrium with timber stairs and indoor plants'],
    ];
    const categories = [['all', 'All Subsystems'], ...workspace.subsystems.map(system => [system.key, system.title])];
    const servicePhotos = {
        transcript: 'gcu-service-transcript.webp', enrollment: 'gcu-service-enrollment.webp',
        report: 'gcu-service-repair.webp', map: 'gcu-service-map.webp',
        review: 'gcu-service-review.webp', maintenance: 'gcu-service-maintenance.webp',
        learning: 'gcu-learning-commons.webp', 'academic-risk': 'gcu-gallery-studio.webp',
        bookings: 'gcu-gallery-atrium.webp', 'pre-review': 'gcu-service-review.webp',
    };
    const serviceAudiences = {transcript: 'Students', enrollment: 'Students', report: 'Students and Faculty', map: 'Campus Members', review: 'Administrators', maintenance: 'Technicians', learning: 'Students and Faculty', 'academic-risk': 'Students and Faculty', bookings: 'Students and Faculty', 'pre-review': 'Students and Faculty'};
    const counter = index => String(index + 1).padStart(2, '0');
    let dispose = () => {};

    // Small illustrated badges for the public homepage; functional icons stay shared.
    const welcomeArt = {
        transcript: ['#f9ddd3', '<path fill="#fff9eb" d="M15 8h15l7 7v22a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3V11a3 3 0 0 1 3-3Z"/><path fill="#f8b49c" d="M29 8v8h8Z"/><path d="M18 21h11m-11 6h8"/><path fill="#f5c66f" d="m32 26 2 4 4 .6-3 3 .7 4.3-3.7-2-3.7 2 .7-4.3-3-3 4-.6Z"/>'],
        enrollment: ['#e0eae2', '<rect x="9" y="12" width="31" height="24" rx="5" fill="#fffaee"/><path d="M15 19h12m-12 6h8"/><path fill="#f5b4a6" d="m28 29-1 12 5-3 4 3-1-12Z"/><circle cx="32" cy="27" r="6" fill="#f7ce78"/><path d="m30 27 1.4 1.4 2.7-3"/>'],
        report: ['#fae5c7', '<path fill="#fffaeb" d="M10 17h27v17a4 4 0 0 1-4 4H20l-7 4v-4a4 4 0 0 1-3-4Z"/><path fill="#efaa89" d="M10 18v-4a4 4 0 0 1 4-4h19a4 4 0 0 1 4 4v4Z"/><path d="M23.5 23v5m0 5h.1"/>'],
        map: ['#deede6', '<path fill="#a9d7ba" d="m9 17 10-5 11 5 9-4v22l-9 4-11-5-10 5Z"/><path fill="#fdf4db" d="m19 12 11 5v22l-11-5Z"/><path fill="#f5a997" d="M32 7a7 7 0 0 1 7 7c0 5-7 10-7 10s-7-5-7-10a7 7 0 0 1 7-7Z"/><circle cx="32" cy="14" r="2.2" fill="#fff9ee"/>'],
        review: ['#e5e4f4', '<rect x="12" y="10" width="26" height="32" rx="5" fill="#fffaf1"/><rect x="19" y="7" width="12" height="8" rx="3" fill="#b9b8dc"/><path d="m17 23 2 2 4-5m-6 12 2 2 4-5m4-6h6m-6 9h6"/>'],
        maintenance: ['#fae8c8', '<path fill="#f8c46b" d="M10 31v-4a14 14 0 0 1 28 0v4Z"/><path fill="#ffe7a4" d="M20 24V12a5 5 0 0 1 8 0v12"/><rect x="7" y="30" width="34" height="7" rx="3" fill="#f4ac63"/><path d="M12 33h8"/>'],
        overview: ['#e2eddf', '<path fill="#f7c69d" d="M9 23h30v16H9z"/><path fill="#f09982" d="m7 24 17-12 17 12Z"/><path fill="#fffae9" d="M19 38V28h10v10m-16-9h3v5h-3zm19 0h3v5h-3z"/><path d="M24 12V6"/><path fill="#f5c86c" d="m24 6 8 2-8 3Z"/><path d="M7 39h34"/>'],
        catalog: ['#f7e6d7', '<rect x="9" y="10" width="14" height="13" rx="4" fill="#f8b49c"/><rect x="26" y="10" width="13" height="13" rx="4" fill="#add5be"/><rect x="9" y="26" width="14" height="13" rx="4" fill="#bdbde4"/><rect x="26" y="26" width="13" height="13" rx="4" fill="#f9d480"/><path d="M14 16h4m12 0 2 2 3-4M14 32h4m14-2v5m-2.5-2.5h5"/>'],
        gallery: ['#dcefe6', '<rect x="12" y="9" width="29" height="25" rx="4" fill="#f5be9c" transform="rotate(10 26 21)"/><rect x="7" y="13" width="31" height="26" rx="4" fill="#fff9e9"/><path fill="#afdacc" d="M11 17h23v15H11Z"/><circle cx="27" cy="21" r="2.8" fill="#f8cb75"/><path fill="#74b09a" d="m11 30 7-7 5 5 3-3 8 6v3H11Z"/><path d="M16 36h5"/>'],
    };
    function welcomeIcon(key) {
        const [backdrop, art] = welcomeArt[key] || welcomeArt.catalog;
        return `<svg class="welcome-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
            <path fill="${backdrop}" d="M43 14c6 9 1 21-8 27-8 6-23 5-29-3-6-7-5-22 3-30 9-8 28-4 34 6Z"/>
            <path fill="#fff9ea" d="m41 4 1.2 3.3L45.5 8l-3.3 1L41 12l-1-3-3.3-1L40 7.3Z"/>
            <g stroke="#334744" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${art}</g>
        </svg>`;
    }

    // Adapted from the template's class-card markup and its original tag/image layout.
    function cards(active = 'all') {
        return workspace.subsystems.filter(system => active === 'all' || system.key === active).map(system => {
            const entries = workspace.catalog.filter(item => item.group === system.key || (system.key === 'campus' && item.key === 'maintenance') || (system.key === 'documents' && item.key === 'review'));
            return `<section class="public-subsystem"><header class="public-subsystem-head"><span>${icon(system.icon)}</span><div><h3>${system.title}</h3><p>${system.description}</p></div></header><div class="subsystem-service-grid">${entries.map((item, index) => {
            const file = servicePhotos[item.key] || 'gcu-quadrangle.webp';
            const module = system.modules.find(module => module.pages.some(page => item.target.includes(page))) || system.modules[0];
            return `<article class="class-card" data-service-group="${item.group}">
                <div class="class-img-wrap" data-parallax="13"><img src="/${file}" alt="${item.title} campus service" class="class-img" loading="lazy">
                    <span class="class-tag">${module.title}</span><span class="class-index" aria-hidden="true">${counter(index)}</span></div>
                <div class="class-body"><div class="class-title-row"><span class="class-symbol">${welcomeIcon(item.key)}</span><h3 class="class-name">${item.title}</h3></div>
                    <p class="class-desc">${item.desc}</p>
                    <div class="class-actions"><span class="class-audience">${icon('users')} ${serviceAudiences[item.key]}</span>
                        <button type="button" class="btn btn-primary btn-sm" data-public-service="${item.key}">Open Service ${icon('arrow')}</button></div></div>
            </article>`;
        }).join('')}</div></section>`;
        }).join('');
    }

    const sectionMarker = symbol => `<span class="section-marker">${welcomeIcon(symbol)}</span>`;
    const campusDoodle = `<svg class="campus-doodle" viewBox="0 0 142 76" fill="none" aria-hidden="true" focusable="false">
        <path d="M8 59c21 15 54 4 53-13-1-14-22-9-17 4 4 11 29 9 52-13" stroke="#78a18c" stroke-width="2" stroke-linecap="round" stroke-dasharray="3 5"/>
        <path d="m88 27 37-15-13 36-8-13-10 9 1-13Z" fill="#f5bf70" stroke="#334744" stroke-width="2" stroke-linejoin="round"/>
        <path d="m88 27 37-15-21 23Z" fill="#fff1d3" stroke="#334744" stroke-width="2" stroke-linejoin="round"/>
        <path d="m96 14 1.5-4.5m-8 4 4 3M123 51l3 3m6-7 4 1" stroke="#d27861" stroke-width="2.2" stroke-linecap="round"/>
        <path d="m27 19 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#f4b1a0"/>
        <circle cx="15" cy="43" r="2.5" fill="#e7b562"/>
    </svg>`;

    // Preserves the upstream structure: topbar → site header → hero → ribbon
    // → about split → class grid → gallery. Business actions are ours.
    function render() {
        return `<div class="public-site" id="top">
            <a class="skip-link" href="#main">Skip to main content</a>
            <div class="topbar"><div class="container topbar-inner">
                <p class="topbar-item"><span class="topbar-icon">${icon('map')}</span> GlobalConnect University · Demo Campus</p>
                <p class="topbar-item topbar-mid">SmartCampus Student and Staff Portal</p>
                <p class="topbar-item topbar-end"><a href="#campus-gallery">GCU Campus Gallery</a></p>
            </div></div>
            <header class="site-header"><div class="container nav-wrap">
                <a href="#top" class="brand" aria-label="SmartCampus Home"><span class="brand-mark" aria-hidden="true"></span>
                    <span class="brand-text">Smart<span>Campus</span></span></a>
                <button type="button" class="nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="site-nav">☰</button>
                <nav class="nav-links" id="site-nav" aria-label="Main navigation">
                    <a href="#top" class="nav-link active" aria-current="location">Home</a>
                    <a href="#using-campuscare" class="nav-link">About</a>
                    <a href="#service-catalog" class="nav-link">Service Directory</a>
                    <a href="#campus-gallery" class="nav-link">Campus Gallery</a>
                    <a class="nav-cta" href="#login">Campus Sign In ${icon('arrow')}</a>
                </nav>
            </div><span class="scroll-meter" aria-hidden="true"></span></header>
            <main id="main" tabindex="-1">
                <h1 class="sr-only">Campus Services</h1>
                <section class="hero" id="hero" aria-label="Campus photo slideshow">
                    <div class="hero-bg" data-parallax="32">${bannerPhotos.map(([file, description], i) => `<img src="/${file}" alt="${description}"
                        class="campus-photo ${i === 0 ? 'active' : ''}" aria-hidden="${i !== 0}" ${i === 0 ? 'fetchpriority="high"' : 'decoding="async"'}>`).join('')}</div>
                </section>
                <section class="section ribbon-section" aria-label="Quick services"><div class="container">
                    <div class="ribbon subsystem-ribbon">${workspace.subsystems.map(system => `<a class="ribbon-item" href="#service-catalog" data-subsystem="${system.key}">
                        <span class="ribbon-icon">${icon(system.icon)}</span><span class="ribbon-label">${system.title}<small>Explore modules ${system.modules.map(module => module.title.slice(0, 2)).join(' & ')}</small></span>${icon('arrow')}</a>`).join('')}</div>
                </div></section>
                <section class="section section-cream" id="using-campuscare"><div class="container">
                    <div class="split"><div class="split-img">
                        <div class="split-photo-frame" data-parallax="24"><img src="/${overviewFile}" alt="${overviewDescription}" class="split-photo" loading="lazy"></div>
                    </div><div class="split-copy">
                        ${sectionMarker('overview')}
                        <h2 class="section-title">Campus Services <em>Overview</em></h2>
                        <p>GlobalConnect University (GCU)</p>
                        <ul class="check-list">${workspace.subsystems.map(system => `<li>${system.title}: ${system.description}</li>`).join('')}</ul>
                        <div class="split-footer"><a href="#campus-gallery" class="btn btn-ghost-dark">Browse Campus Gallery ${icon('arrow')}</a>${campusDoodle}</div>
                    </div></div>
                </div></section>
                <section class="section service-directory" id="service-catalog" aria-labelledby="catalog-heading">
                    <div class="container"><div class="section-head">${sectionMarker('catalog')}
                        <h2 class="section-title" id="catalog-heading">Campus <em>Service Directory</em></h2></div>
                        <div class="directory-tabs" role="group" aria-label="Service categories">${categories.map(([key, label]) =>
            `<button type="button" data-public-filter="${key}" aria-pressed="${key === 'all'}">${label}</button>`).join('')}</div>
                        <div class="class-grid" id="public-services" aria-live="polite">${cards()}</div>
                    </div></section>
                <section class="section section-cream" id="campus-gallery"><div class="container">
                    <div class="section-head">${sectionMarker('gallery')}<h2 class="section-title">GCU <em>Campus Gallery</em></h2>
                        <p>Concept images of the fictional campus. Select a photo to enlarge it.</p>
                        <button type="button" class="linkbtn gallery-play" aria-controls="hero">Pause homepage slideshow</button></div>
                    <div class="gallery-grid">${galleryPhotos.map(([file, title, description], index) => `<figure class="campus-gallery-card">
                        <a href="/${file}" class="gallery-item" target="_blank" rel="noopener" data-campus-viewer="${index}" data-parallax="17" aria-label="View full-size photo: ${title}">
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
            <div><p class="viewer-kicker">GCU Campus Gallery</p><h2 id="campus-viewer-title"></h2></div>
            <button type="button" class="viewer-icon viewer-close" aria-label="Close photo">×</button>
        </div>
        <div class="viewer-stage"></div>
        <div class="viewer-bar viewer-footer"><p class="viewer-count" aria-live="polite"></p>
            <div class="viewer-actions"><button type="button" class="viewer-icon viewer-prev" aria-label="Previous photo">‹</button>
                <button type="button" class="viewer-icon viewer-next" aria-label="Next photo">›</button></div>
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
        root.querySelectorAll('[data-subsystem]').forEach(link => link.addEventListener('click', () => {
            const key = link.dataset.subsystem;
            root.querySelectorAll('[data-public-filter]').forEach(button => button.setAttribute('aria-pressed', button.dataset.publicFilter === key));
            root.querySelector('#public-services').innerHTML = cards(key);
            portalMotion.watchPublic(root);
        }, opts));
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
            pause.textContent = playing ? 'Pause homepage slideshow' : 'Play homepage slideshow';
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
            toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
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
