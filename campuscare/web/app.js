'use strict';

let state = null;
let page = 'overview';
let loginRole = 'user';
let requestedService = '';

async function api(path, body) {
    const response = await fetch('/api' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {'Content-Type': 'application/json', 'X-CSRF-Token': state?.user.csrf || ''},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    const data = await response.json();
    if (!response.ok) {
        if (response.status === 401 && state && path !== '/login') {
            clearSession();
            renderLogin();
        }
        throw new Error(data.error || '请求失败');
    }
    return data;
}

async function refresh() {
    state = await api('/bootstrap');
}

function clearSession() {
    state = null;
    page = 'overview';
    requestedService = '';
    facilities.reset();
    if (typeof clearUsersView === 'function') clearUsersView();
    $('#service-command')?.close();
    closeDrawer();
}

function routeFor(user, hash = location.hash) {
    if (adminServices.isPortalHash(hash)) return workspace.allowed(user, 'admin-services') ? 'admin-services' : null;
    const match = hash.match(/^#campus\/([a-z-]+)$/);
    return match && workspace.allowed(user, match[1]) ? match[1] : null;
}

function defaultPage() {
    const direct = routeFor(state.user);
    if (direct) return direct;
    const asset = new URLSearchParams(location.search).get('asset');
    if (asset && workspace.allowed(state.user, 'report')) {
        facilities.seedReport(asset);
        return 'report';
    }
    return 'overview';
}

function navigate(hash) {
    if (!state || !routeFor(state.user, hash)) return false;
    if (location.hash === hash) showRoute(false);
    else location.hash = hash;
    return true;
}

function go(id) {
    navigate(id === 'admin-services' ? adminServices.homeHref : workspace.campusUrl(id));
}

function showRoute(focus) {
    if (!state) return;
    if (page === 'report') facilities.captureDraft();
    closeDrawer();
    const next = routeFor(state.user) || 'overview';
    if (page !== next) facilities.resetFilters();
    page = next;
    render();
    window.scrollTo(0, 0);
    if (focus) $('#content h1')?.focus({preventScroll: true});
}

function head(title, subtitle, action = '') {
    return `<div class="page-head"><div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`;
}

function renderLogin() {
    $('#app').innerHTML = workspace.landing(loginRole, requestedService);
    workspace.bindGallery?.();
    $('#register-link').onclick = () => renderAuth('register');
    $('#reset-link').onclick = () => renderAuth('reset');
    $('#password-visibility').onclick = event => {
        const password = $('#password');
        const reveal = password.type === 'password';
        password.type = reveal ? 'text' : 'password';
        event.currentTarget.textContent = reveal ? '隐藏' : '显示';
        event.currentTarget.setAttribute('aria-pressed', reveal);
    };
    const form = $('#login-form');
    form.onsubmit = async event => {
        event.preventDefault();
        const button = event.submitter;
        button.disabled = true;
        try {
            await api('/login', {id: $('#account').value, password: $('#password').value});
            await refresh();
            const target = workspace.catalog.find(item => item.key === requestedService)?.target;
            requestedService = '';
            if (target && navigate(target)) return;
            page = defaultPage();
            render();
            window.scrollTo(0, 0);
        } catch (error) {
            if (form.isConnected) {
                $('#login-error').textContent = error.message;
                button.disabled = false;
            }
        }
    };
}

function openProfile() {
    const user = state.user;
    drawer(`<div class="drawer-head"><h2>个人资料</h2><button class="close" data-action="close" aria-label="关闭">×</button></div>
        <div class="detail-box"><p>姓名：${esc(user.name)}</p><p>账号：${esc(user.id)}</p><p>身份：${esc(user.identity)}</p>
        <p>班级：${esc(user.class_name || '未填写')}</p><p>学号 / 工号：${esc(user.student_no || '未填写')}</p>
        <p>学院 / 院系：${esc(user.department || '未填写')}</p><p>邮箱：${esc(user.email || '演示账号未绑定邮箱')}</p>
        <p class="subtitle">${user.email_verified ? '邮箱已验证，可用于找回密码。' : '尚未绑定验证邮箱，无法使用邮箱找回密码。'}</p></div>`);
}

function render() {
    if (!state) return renderLogin();
    const user = state.user;
    if (!workspace.allowed(user, page)) page = 'overview';
    $('#app').innerHTML = workspace.shell(user, page);
    const content = $('#content');
    if (page === 'overview') {
        content.innerHTML = workspace.home(state);
        workspace.bindHome(user);
    } else if (page === 'admin-services') {
        content.innerHTML = adminServices.view();
        adminServices.bind();
    } else if (page === 'users') {
        content.innerHTML = usersPage();
        bindUsersPage();
    } else {
        content.innerHTML = facilities.views[page]();
        facilities.bind();
    }
    $('#content h1')?.setAttribute('tabindex', '-1');
    $('#profile-button').onclick = openProfile;
    if (user.role === 'admin') $('#mail-settings-button').onclick = openMailSettings;
}

function focusLogin() {
    $('#campus-signin')?.scrollIntoView({block: 'center'});
    $('#account')?.focus({preventScroll: true});
}

document.addEventListener('click', async event => {
    const target = event.target.closest('button,[data-location],[data-ticket],[data-asset],[data-skip]');
    if (!target) return;
    const d = target.dataset;
    try {
        if (d.skip !== undefined) {
            event.preventDefault();
            $('#content')?.focus();
        } else if (d.role) {
            loginRole = d.role;
            if (workspace.catalog.find(item => item.key === requestedService)?.role !== loginRole) requestedService = '';
            renderLogin();
            $(`[data-role="${loginRole}"]`)?.focus({preventScroll: true});
        } else if (d.publicFocus !== undefined) {
            focusLogin();
        } else if (d.publicFilter) {
            $$('[data-public-filter]').forEach(button => button.setAttribute('aria-pressed', button === target));
            $('#public-services').innerHTML = workspace.publicCatalog(d.publicFilter);
        } else if (d.publicService) {
            const service = workspace.catalog.find(item => item.key === d.publicService);
            if (!service) return;
            requestedService = service.key;
            loginRole = service.role;
            renderLogin();
            focusLogin();
        } else if (d.action === 'close') {
            closeDrawer();
        } else if (state) {
            if (d.action === 'logout') {
                await api('/logout', {});
                clearSession();
                history.replaceState(null, '', location.pathname + location.search);
                renderLogin();
                window.scrollTo(0, 0);
            } else if (d.page) {
                go(d.page);
            } else if (d.route) {
                navigate(d.route);
            } else if (d.command !== undefined) {
                workspace.openCommand(state.user, navigate);
            } else if (d.action === 'new') {
                go('report');
            } else {
                await facilities.handle(target);
            }
        }
    } catch (error) {
        toast(error.message);
    }
});

document.addEventListener('keydown', event => {
    if (state && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        workspace.openCommand(state.user, navigate);
    }
    if (event.key === 'Escape' && !$('#service-command')) closeDrawer();
    if (event.key === 'Enter' && !event.target.matches('button') && event.target.matches('[data-location],[data-ticket],[data-asset]')) event.target.click();
});
$('#modal-root').addEventListener('click', event => {
    if (event.target.classList.contains('drawer-backdrop')) closeDrawer();
});
window.addEventListener('hashchange', () => {
    if (state) showRoute(true);
});

(async () => {
    try {
        await refresh();
        page = defaultPage();
        render();
    } catch {
        renderLogin();
    }
})();
