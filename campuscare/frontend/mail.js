// Only local administrators can access these endpoints. Never read a saved secret.
async function openMailSettings() {
    drawer('<div class="drawer-head"><h2>Email Settings</h2><button class="close" data-action="close" aria-label="Close">×</button></div><p id="mail-loading">Loading email settings…</p>');
    let saved;
    try { saved = await api('/mail/settings'); }
    catch (e) { if ($('#mail-loading')) $('#mail-loading').textContent = e.message; return; }
    if (!$('#mail-loading')) return;
    drawer(`<div class="drawer-head"><div><div class="eyebrow">EMAIL DELIVERY</div><h2>Email Settings</h2></div><button class="close" data-action="close" aria-label="Close">×</button></div>
        <p class="subtitle">Set up a sender account for registration and password recovery emails. Recipients do not need SMTP enabled.</p>
        <div id="mail-status" class="notice warning" role="status"></div>
        <form id="mail-settings-form" class="mail-settings-form">
            <h3>1. Sender Settings</h3>
            <label for="mail-provider">Email Provider</label><select id="mail-provider">${Object.entries(saved.providers).map(([id, p]) => `<option value="${esc(id)}">${esc(p.name)}</option>`).join('')}</select>
            <label for="mail-sender">Sender Email</label><input id="mail-sender" type="email" autocomplete="off" maxlength="254" placeholder="e.g., 123456@qq.com" required>
            <label for="mail-password">App Password or Authorization Code</label><input id="mail-password" type="password" autocomplete="new-password" maxlength="256" placeholder="Enter the credential issued by your email provider">
            <p id="mail-secret-hint" class="subtitle"></p>
            <div id="mail-provider-help" class="detail-box"></div>
            <p class="subtitle">The credential is saved in a private configuration file and is not shown again.</p>
            <button id="mail-save" class="btn" type="submit">Save and Enable Email</button>
        </form>
        <form id="mail-test-form" class="mail-settings-form">
            <h3>2. Send Test Email</h3><p class="subtitle">After saving, send a test email and check that it arrives before using registration or password recovery.</p>
            <label for="mail-recipient">Test Recipient Email</label><input id="mail-recipient" type="email" autocomplete="off" maxlength="254" placeholder="Enter an email address you can check" required>
            <button id="mail-test" type="submit" class="btn secondary">Send Test Email</button>
        </form>
        <p id="mail-feedback" role="status" aria-live="polite"></p>
        <details class="detail-box"><summary>What if the message does not arrive?</summary><p>Check the address, spam folder, and mailbox storage. For authentication errors, generate a new credential. For connection errors, check your network and provider settings. Accepted messages may still be delayed or returned.</p></details>
        <button id="mail-disable" class="linkbtn" style="margin-top:20px">Disable Email and Remove Saved Credential</button>`);
    const form = $('#mail-settings-form'), testForm = $('#mail-test-form');
    const sender = $('#mail-sender'), provider = $('#mail-provider'), secret = $('#mail-password');
    const feedback = $('#mail-feedback'), status = $('#mail-status');
    let busy = false;
    const changed = () => provider.value !== saved.provider || sender.value.trim().toLowerCase() !== saved.sender || !!secret.value;
    const refresh = () => {
        const reusable = saved.has_password && provider.value === saved.provider && sender.value.trim().toLowerCase() === saved.sender;
        secret.required = !reusable;
        $('#mail-secret-hint').textContent = reusable ? 'A credential is saved. Leave this blank to keep it, or enter a new one to replace it.' : 'Use an app password or authorization code issued by your provider.';
        const p = saved.providers[provider.value];
        const guides = {
            qq: 'In QQ Mail settings, open POP3/IMAP/SMTP, enable SMTP, and generate an authorization code.',
            '163': 'In 163 Mail settings, open POP3/SMTP/IMAP, enable SMTP, and generate a client credential.',
            gmail: 'Enable Google two-step verification and generate an app password. If your account does not allow it, use a different sender or contact your account administrator. The server must be able to reach Google.',
        };
        const links = {qq: ['https://mail.qq.com', 'Open QQ Mail'], '163': ['https://mail.163.com', 'Open 163 Mail'], gmail: ['https://myaccount.google.com/apppasswords', 'Open Google App Passwords']};
        const [url, label] = links[provider.value];
        $('#mail-provider-help').innerHTML = `<p>${esc(guides[provider.value])}</p><a href="${url}" target="_blank" rel="noopener noreferrer">${label} ↗</a><p class="subtitle">Server configured automatically: ${esc(p.host)} · 465 · SSL Encryption</p>`;
        status.textContent = saved.mode === 'smtp' ? `Email is configured${saved.sender ? ' · ' + saved.sender : ''}.Send a test email to verify delivery.` : saved.mode === 'demo' ? 'Local demo mode displays codes on screen. Save sender settings to enable real email delivery.' : 'Email is disabled. Configure a sender account first.';
        $('#mail-test').disabled = busy || saved.mode !== 'smtp' || changed();
    };
    provider.value = saved.provider || 'qq'; sender.value = saved.sender || '';
    provider.onchange = () => { secret.value = ''; refresh(); };
    sender.oninput = refresh; secret.oninput = refresh;
    const setBusy = value => {
        busy = value;
        for (const el of [...form.elements, ...testForm.elements, $('#mail-disable')]) el.disabled = value;
        if (!value) refresh();
    };
    const show = (text, error = false) => { feedback.textContent = text; feedback.className = error ? 'notice warning' : 'notice'; };
    form.onsubmit = async e => {
        e.preventDefault();
        const body = {provider: provider.value, sender: sender.value, password: secret.value};
        setBusy(true); show('Saving settings…');
        try {
            saved = await api('/mail/settings', body);
            if (!document.body.contains(form)) return;
            secret.value = ''; sender.value = saved.sender;
            if (!$('#mail-recipient').value) $('#mail-recipient').value = saved.sender;
            show('Settings saved. Send a test email to verify delivery.');
        } catch (e) { show(e.message, true); }
        finally { if (document.body.contains(form)) setBusy(false); }
    };
    testForm.onsubmit = async e => {
        e.preventDefault();
        if (changed()) { show('Save your changes before sending a test.', true); return; }
        const recipient = $('#mail-recipient').value;
        setBusy(true); show('Sending the test email…');
        try { const result = await api('/mail/test', {recipient}); show(result.message); }
        catch (e) { show(e.message, true); }
        finally { if (document.body.contains(form)) setBusy(false); }
    };
    $('#mail-disable').onclick = async () => {
        setBusy(true);
        try { saved = await api('/mail/settings', {mode: 'disabled'}); secret.value = ''; show('Email is disabled and the saved credential has been removed.'); }
        catch (e) { show(e.message, true); }
        finally { if (document.body.contains(form)) setBusy(false); }
    };
    refresh();
}
