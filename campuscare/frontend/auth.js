// Public account forms. Verification codes are never written to localStorage.
const accountRoles = {
    user: {label: 'Students and Faculty', title: 'Campus Sign In', demo: 'student'},
    technician: {label: 'Technicians', title: 'Technician Sign In', demo: 'tech'},
    admin: {label: 'Administrators', title: 'Administrator Sign In', demo: 'admin'},
};

function accountShell(title, context, content) {
    return `<div class="account-site">
        <header class="account-header">
            <a href="#top" class="site-brand" aria-label="SmartCampus Home"><span class="site-brand-mark">${icon('grid')}</span><span><strong>SmartCampus</strong></span></a>
            <a href="${context.service ? '#service-catalog' : '#top'}" class="account-back">← Back to ${context.service ? 'Service Directory' : 'Home'}</a>
        </header>
        <main class="account-main">
            <div class="account-layout">
                <div class="account-panel">
                    <span class="account-emblem">${icon('users')}</span>
                    <p class="account-university">GlobalConnect University</p>
                    <p class="account-portal">Campus Services Portal</p>
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
        ${service ? `<p class="account-destination">${icon(service.icon)} <span>After signing in: <strong>${esc(service.title)}</strong></span></p>` : ''}
        <div class="role-pills" role="group" aria-label="Account type">
            ${Object.entries(accountRoles).map(([key, item]) =>
        `<button type="button" class="role-pill ${role === key ? 'active' : ''}" data-login-role="${key}" aria-pressed="${role === key}">${item.label}</button>`).join('')}
        </div>
        <form id="login-form">
            <label for="account">Username or Email</label>
            <input id="account" name="username" list="demo-accounts" value="${info.demo}" autocomplete="username" placeholder="Username or registered email" required>
            <datalist id="demo-accounts">${['student','teacher','tech','plumber','it','admin'].map(id => `<option value="${id}"></option>`).join('')}</datalist>
            <label for="password">Password</label><div class="sign-in-secret">
                <input id="password" name="password" type="password" value="Campus2026!" autocomplete="current-password" required>
                <button type="button" id="password-visibility" class="linkbtn" aria-pressed="false">Show</button>
            </div>
            <p id="login-error" class="error" role="alert"></p><button class="btn account-primary" type="submit">Sign In ${icon('arrow')}</button>
        </form>
        <div class="sign-in-links"><a id="register-link" href="${esc(accountHref('register', context))}">Create an account</a>
            <a id="reset-link" href="${esc(accountHref('reset', context))}">Forgot your password?</a></div>`);
}

async function renderAuth(kind, context) {
    const registering = kind === 'register';
    $('#app').innerHTML = accountShell(registering ? 'Create a Campus Account' : 'Reset Password', context, `<p class="subtitle">${registering?'Enter your details and verify your email address.':'Use your verified email address to receive a code and set a new password.'}</p><form id="auth-form">
    ${registering?'<div class="form-grid"><div><label for="auth-name">Full Name *</label><input id="auth-name" maxlength="50" autocomplete="name" required></div><div><label for="auth-identity">Campus Affiliation *</label><select id="auth-identity"><option>Student</option><option>Faculty</option></select></div><div><label for="auth-username">Username *</label><input id="auth-username" pattern="[A-Za-z][A-Za-z0-9_]{3,31}" placeholder="4–32 characters, starting with a letter" autocomplete="username" required></div><div><label for="auth-number">Student or Staff ID *</label><input id="auth-number" pattern="[A-Za-z0-9-]{3,30}" maxlength="30" required></div><div><label for="auth-class">Class (required for students)</label><input id="auth-class" maxlength="80" placeholder="e.g., CSIT883-01" required></div><div><label for="auth-department">School or Department</label><input id="auth-department" maxlength="80"></div></div>':''}
    <label for="auth-email">${registering ? 'Email' : 'Verified Email'} *</label><input type="email" id="auth-email" maxlength="254" autocomplete="email" required><label for="auth-code">Email Verification Code *</label><div class="flex"><input id="auth-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="6 digits" required><button class="btn secondary" type="button" id="send-code" style="width:auto;margin:0" disabled>Send Code</button></div><div id="mail-mode" class="notice warning" style="margin-top:12px">Checking email availability…</div><div id="code-result" aria-live="polite"></div>
    <label for="auth-password">${registering ? 'Password' : 'New Password'} *</label><input id="auth-password" type="password" minlength="10" maxlength="128" autocomplete="new-password" placeholder="10–128 characters, including letters and numbers" required><label for="auth-confirm">Confirm Password *</label><input id="auth-confirm" type="password" minlength="10" maxlength="128" autocomplete="new-password" required><p class="error" id="auth-error" role="alert"></p><button class="btn account-primary" type="submit">${registering?'Verify and Register':'Verify and Reset Password'}</button></form><div class="sign-in-links"><a id="back-login" href="${esc(accountHref('login', context))}">← Back to Sign In</a></div><p class="login-foot">Codes expire after 10 minutes and can be used once. ${registering?'Self-registration creates a student or faculty account.':'Resetting your password signs you out of all existing sessions.'}</p>`);
    const form = $('#auth-form');
    let challenge = '', sentEmail = '', timer = null, enabled = false;
    const stop = () => { if (timer) clearInterval(timer); };
    $('#back-login').onclick = stop;
    $('#auth-identity')?.addEventListener('change', e => { $('#auth-class').required = e.target.value === 'Student'; });
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
            if ($('#auth-email').value.trim().toLowerCase() !== email) throw Error('Your email address changed. Request a code for the new address.');
            challenge = response.challenge_id; sentEmail = email;
            const until = Date.now() + response.resend_after * 1000;
            $('#code-result').innerHTML = response.demo_code ? `<div class="notice warning" style="margin-top:10px">Local demo only. No email was sent. Verification code: <strong style="font-size:19px;letter-spacing:3px" id="demo-code">${esc(response.demo_code)}</strong></div>` : `<p class="subtitle">${esc(response.message)}</p>`;
            stop(); timer = setInterval(() => {
                if (!document.body.contains(b)) { stop(); return; }
                const left = Math.ceil((until - Date.now()) / 1000);
                b.textContent = left > 0 ? `${left}s until you can resend` : 'Resend Code'; b.disabled = left > 0 || !enabled;
                if (left <= 0) stop();
            }, 300);
        } catch (e) { if (form.isConnected) $('#auth-error').textContent = e.message; b.disabled = false; }
    };
    form.onsubmit = async e => {
        e.preventDefault(); $('#auth-error').textContent = '';
        const email = $('#auth-email').value.trim().toLowerCase();
        if (!challenge || email !== sentEmail) { $('#auth-error').textContent = 'Request a verification code for this email address first.'; return; }
        if ($('#auth-password').value !== $('#auth-confirm').value) { $('#auth-error').textContent = 'The passwords do not match.'; return; }
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
