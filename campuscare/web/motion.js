'use strict';

// Enhance visible sections only. Content remains available before JS or without
// motion support; switching routes never depends on an animation completing.
const portalMotion = (() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const seen = new WeakSet();
    let observer, currentPage, viewportCleanup;

    function leavePublic() {
        observer?.disconnect();
        viewportCleanup?.();
        viewportCleanup = undefined;
    }

    function watchPublic(root) {
        leavePublic();
        if (preference.matches || !root) return;
        if ('IntersectionObserver' in window) {
            observer ||= new IntersectionObserver(entries => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const element = entry.target;
                    observer.unobserve(element);
                    if (!element.isConnected || seen.has(element)) continue;
                    seen.add(element);
                    element.classList.add('motion-revealed');
                }
            }, {threshold: 0.12, rootMargin: '0px 0px -4% 0px'});
            root.querySelectorAll('.ribbon, .split-img, .split-copy, .section-head, .class-card, .login-form, .campus-gallery-card')
                .forEach(element => { if (!seen.has(element)) observer.observe(element); });
        }
        const surfaces = [...root.querySelectorAll('[data-parallax]')];
        const meter = root.querySelector('.scroll-meter');
        const listeners = new AbortController();
        let frame = 0;
        function renderScroll() {
            frame = 0;
            if (!root.isConnected) return;
            const height = window.innerHeight;
            const damping = window.innerWidth < 768 ? 0.62 : 1;
            const maxScroll = Math.max(1, root.offsetHeight - height);
            const progress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
            // Read the visible geometry first, then update transform values.
            const shifts = surfaces.flatMap(element => {
                const rect = element.getBoundingClientRect();
                if (rect.bottom < 0 || rect.top > height) return [];
                const local = Math.max(-1, Math.min(1, (height - rect.height - 2 * rect.top) / (height + rect.height)));
                const travel = Math.min(Number(element.dataset.parallax) * damping, rect.height * .055);
                return [[element, (local * travel).toFixed(2) + 'px']];
            });
            for (const [element, shift] of shifts) element.style.setProperty('--campus-shift', shift);
            meter?.style.setProperty('--page-progress', progress.toFixed(4));
        }
        function schedule() {
            if (!frame) frame = requestAnimationFrame(renderScroll);
        }
        window.addEventListener('scroll', schedule, {passive: true, signal: listeners.signal});
        window.addEventListener('resize', schedule, {signal: listeners.signal});
        viewportCleanup = () => {
            listeners.abort();
            cancelAnimationFrame(frame);
            for (const element of surfaces) element.style.removeProperty('--campus-shift');
            meter?.style.removeProperty('--page-progress');
        };
        schedule();
    }

    preference.addEventListener('change', () => watchPublic(document.querySelector('.public-site')));
    return {
        watchPublic,
        leavePublic,
        enterPage(root, key) {
            if (currentPage !== key && !preference.matches) root.classList.add('motion-page');
            currentPage = key;
        },
        resetPage: () => { currentPage = undefined; },
    };
})();
