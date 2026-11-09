'use strict';

// Enhance visible sections only. Content remains available before JS or without
// motion support; switching routes never depends on an animation completing.
const portalMotion = (() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const seen = new WeakSet();
    let observer, currentPage;

    function watchPublic(root) {
        observer?.disconnect();
        if (preference.matches || !root || !('IntersectionObserver' in window)) return;
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

    preference.addEventListener('change', () => watchPublic(document.querySelector('.public-site')));
    return {
        watchPublic,
        leavePublic: () => observer?.disconnect(),
        enterPage(root, key) {
            if (currentPage !== key && !preference.matches) root.classList.add('motion-page');
            currentPage = key;
        },
        resetPage: () => { currentPage = undefined; },
    };
})();
