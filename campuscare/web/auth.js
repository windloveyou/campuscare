// Public account forms. Verification codes are never written to localStorage.
const accountRoles = {
    user: {label: '学生 / 教师', title: '校园账号登录', demo: 'student'},
    technician: {label: '维修人员', title: '维修人员登录', demo: 'tech'},
    admin: {label: '管理人员', title: '管理人员登录', demo: 'admin'},
};

function accountShell(title, context, content) {
    return `<div class="account-site">
        <header class="account-header">
            <a href="#top" class="site-brand" aria-label="CampusCare 首页"><span class="site-brand-mark">${icon('grid')}</span><span><strong>CampusCare</strong></span></a>
            <a href="${context.service ? '#service-catalog' : '#top'}" class="account-back">← 返回${context.service ? '服务目录' : '首页'}</a>
        </header>
        <main class="account-main">
            <div class="account-layout">
                <div class="account-panel">
                    <span class="account-emblem">${icon('users')}</span>
                    <p class="account-university">GlobalConnect University</p>
                    <p class="account-portal">校园服务门户</p>
                </div>
                <section class="login-form account-card" aria-labelledby="account-heading">
                    <h1 id="account-heading" tabindex="-1">${title}</h1>
                    ${content}
                </section>
            </div>
        </main>
    </div>`;
}

function loginMarkup(context) {
    const {role, service} = context;
    const info = accountRoles[role];
    return accountShell(info.title, context, `
        ${service ? `<p class="account-destination">${icon(service.icon)} <span>登录后将打开：<strong>${esc(service.title)}</strong></span></p>` : ''}
        <div class="role-pills" role="group" aria-label="选择登录身份">
            ${Object.entries(accountRoles).map(([key, item]) =>
        `<button type="button" class="role-pill ${role === key ? 'active' : ''}" data-login-role="${key}" aria-pressed="${role === key}">${item.label}</button>`).join('')}
        </div>
        <form id="login-form">
            <label for="account">用户名 / 邮箱</label>
            <input id="account" name="username" list="demo-accounts" value="${info.demo}" autocomplete="username" placeholder="用户名或注册邮箱" required>
            <datalist id="demo-accounts">${['student','teacher','tech','plumber','it','admin'].map(id => `<option value="${id}"></option>`).join('')}</datalist>
            <label for="password">密码</label><div class="sign-in-secret">
                <input id="password" name="password" type="password" value="Campus2026!" autocomplete="current-password" required>
                <button type="button" id="password-visibility" class="linkbtn" aria-pressed="false">显示</button>
            </div>
            <p id="login-error" class="error" role="alert"></p><button class="btn account-primary" type="submit">进入工作台 ${icon('arrow')}</button>
        </form>
        <div class="sign-in-links"><a id="register-link" href="${esc(accountHref('register', context))}">没有账号？注册</a>
            <a id="reset-link" href="${esc(accountHref('reset', context))}">忘记密码？</a></div>`);
}

async function renderAuth(kind, context) {
    const registering = kind === 'register';
    $('#app').innerHTML = accountShell(registering ? '创建校园账号' : '找回密码', context, `<p class="subtitle">${registering?'填写个人资料并验证邮箱。':'通过已验证的注册邮箱接收验证码，设置新密码。'}</p><form id="auth-form">
    ${registering?'<div class="form-grid"><div><label for="auth-name">姓名 *</label><input id="auth-name" maxlength="50" autocomplete="name" required></div><div><label for="auth-identity">身份 *</label><select id="auth-identity"><option>学生</option><option>教师</option></select></div><div><label for="auth-username">用户名 *</label><input id="auth-username" pattern="[A-Za-z][A-Za-z0-9_]{3,31}" placeholder="4–32位，字母开头" autocomplete="username" required></div><div><label for="auth-number">学号 / 工号 *</label><input id="auth-number" pattern="[A-Za-z0-9-]{3,30}" maxlength="30" required></div><div><label for="auth-class">班级（学生必填）</label><input id="auth-class" maxlength="80" placeholder="例如 CSIT883-01" required></div><div><label for="auth-department">学院 / 院系</label><input id="auth-department" maxlength="80"></div></div>':''}
    <label for="auth-email">${registering?'注册':'已验证的注册'}邮箱 *</label><input type="email" id="auth-email" maxlength="254" autocomplete="email" required><label for="auth-code">邮箱验证码 *</label><div class="flex"><input id="auth-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="6位数字" required><button class="btn secondary" type="button" id="send-code" style="width:auto;margin:0" disabled>获取验证码</button></div><div id="mail-mode" class="notice warning" style="margin-top:12px">正在检查邮件配置…</div><div id="code-result" aria-live="polite"></div>
    <label for="auth-password">${registering?'设置':'新'}密码 *</label><input id="auth-password" type="password" minlength="10" maxlength="128" autocomplete="new-password" placeholder="10–128位，包含字母和数字" required><label for="auth-confirm">再次输入密码 *</label><input id="auth-confirm" type="password" minlength="10" maxlength="128" autocomplete="new-password" required><p class="error" id="auth-error" role="alert"></p><button class="btn account-primary" type="submit">${registering?'验证并注册':'验证并重置密码'}</button></form><div class="sign-in-links"><a id="back-login" href="${esc(accountHref('login', context))}">← 返回登录</a></div><p class="login-foot">验证码 10 分钟有效，仅可使用一次。${registering?'注册仅创建普通用户账号。':'重置后所有旧登录会话将退出。'}</p>`);
    const form = $('#auth-form');
    let challenge = '', sentEmail = '', timer = null, enabled = false;
    const stop = () => { if (timer) clearInterval(timer); };
    $('#back-login').onclick = stop;
    $('#auth-identity')?.addEventListener('change', e => { $('#auth-class').required = e.target.value === '学生'; });
    $('#auth-email').addEventListener('input', () => { challenge = ''; $('#code-result').textContent = ''; });
    try {
        const config = await api('/auth/options');
        if (!form.isConnected) return;
        $('#mail-mode').textContent = config.message;
        enabled = config.mail_mode !== 'disabled';
        $('#send-code').disabled = !enabled;
    } catch (e) { if (form.isConnected) $('#mail-mode').textContent = e.message; return; }
    $('#send-code').onclick = async () => {
        if (!$('#auth-email').reportValidity()) return;
        const b = $('#send-code'); b.disabled = true; $('#auth-error').textContent = '';
        try {
            const email = $('#auth-email').value.trim().toLowerCase();
            const response = await api('/auth/code', { email, purpose: kind });
            if (!form.isConnected) return;
            if ($('#auth-email').value.trim().toLowerCase() !== email) throw Error('邮箱已修改，请为当前邮箱重新获取验证码');
            challenge = response.challenge_id; sentEmail = email;
            const until = Date.now() + response.resend_after * 1000;
            $('#code-result').innerHTML = response.demo_code ? `<div class="notice warning" style="margin-top:10px">仅本机演示，未发送邮件。测试验证码：<strong style="font-size:19px;letter-spacing:3px" id="demo-code">${esc(response.demo_code)}</strong></div>` : `<p class="subtitle">${esc(response.message)}</p>`;
            stop(); timer = setInterval(() => {
                if (!document.body.contains(b)) { stop(); return; }
                const left = Math.ceil((until - Date.now()) / 1000);
                b.textContent = left > 0 ? `${left}秒后重发` : '重新获取'; b.disabled = left > 0 || !enabled;
                if (left <= 0) stop();
            }, 300);
        } catch (e) { if (form.isConnected) $('#auth-error').textContent = e.message; b.disabled = false; }
    };
    form.onsubmit = async e => {
        e.preventDefault(); $('#auth-error').textContent = '';
        const email = $('#auth-email').value.trim().toLowerCase();
        if (!challenge || email !== sentEmail) { $('#auth-error').textContent = '请先为当前邮箱获取验证码'; return; }
        if ($('#auth-password').value !== $('#auth-confirm').value) { $('#auth-error').textContent = '两次输入的密码不一致'; return; }
        const body = { email, challenge_id: challenge, code: $('#auth-code').value, password: $('#auth-password').value };
        if (registering) Object.assign(body, { username: $('#auth-username').value, name: $('#auth-name').value, identity: $('#auth-identity').value, student_no: $('#auth-number').value, class_name: $('#auth-class').value, department: $('#auth-department').value });
        const b = e.submitter; b.disabled = true;
        try {
            const response = await api('/auth/' + kind, body);
            if (!form.isConnected) return;
            stop();
            openLogin(context, true);
            $('#account').value = registering ? response.username : email;
            $('#password').value = '';
            toast(response.message);
        } catch (e) { if (form.isConnected) $('#auth-error').textContent = e.message; b.disabled = false; }
    };
}
