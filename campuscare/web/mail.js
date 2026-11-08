// Only local administrators can access these endpoints. Never read a saved secret.
async function openMailSettings() {
    drawer('<div class="drawer-head"><h2>邮件服务</h2><button class="close" data-action="close" aria-label="关闭">×</button></div><p id="mail-loading">正在读取配置…</p>');
    let saved;
    try { saved = await api('/mail/settings'); }
    catch (e) { if ($('#mail-loading')) $('#mail-loading').textContent = e.message; return; }
    if (!$('#mail-loading')) return;
    drawer(`<div class="drawer-head"><div><div class="eyebrow">EMAIL DELIVERY</div><h2>邮件服务</h2></div><button class="close" data-action="close" aria-label="关闭">×</button></div>
        <p class="subtitle">配置一个发件邮箱，即可向 Gmail、QQ、163 等邮箱发送注册和找回密码的验证码。收件用户无需开启 SMTP。</p>
        <div id="mail-status" class="notice warning" role="status"></div>
        <form id="mail-settings-form" class="mail-settings-form">
            <h3>1. 配置发件邮箱</h3>
            <label for="mail-provider">邮箱服务商</label><select id="mail-provider">${Object.entries(saved.providers).map(([id, p]) => `<option value="${esc(id)}">${esc(p.name)}</option>`).join('')}</select>
            <label for="mail-sender">发件邮箱</label><input id="mail-sender" type="email" autocomplete="off" maxlength="254" placeholder="例如 123456@qq.com" required>
            <label for="mail-password">授权码 / 应用专用密码</label><input id="mail-password" type="password" autocomplete="new-password" maxlength="256" placeholder="填写邮箱服务商生成的授权码">
            <p id="mail-secret-hint" class="subtitle"></p>
            <div id="mail-provider-help" class="detail-box"></div>
            <p class="subtitle">授权码仅保存在这台电脑的私有配置文件中，保存后不会回显。无需发到聊天中。</p>
            <button id="mail-save" class="btn" type="submit">保存并启用邮件发送</button>
        </form>
        <form id="mail-test-form" class="mail-settings-form">
            <h3>2. 发送测试邮件</h3><p class="subtitle">保存后，发送一封测试邮件并到邮箱确认收件。之后用户就可以在注册或找回密码页面获取验证码。</p>
            <label for="mail-recipient">测试收件邮箱</label><input id="mail-recipient" type="email" autocomplete="off" maxlength="254" placeholder="可以填写自己的 Gmail、QQ 或 163 邮箱" required>
            <button id="mail-test" type="submit" class="btn secondary">发送测试邮件</button>
        </form>
        <p id="mail-feedback" role="status" aria-live="polite"></p>
        <details class="detail-box"><summary>没收到邮件怎么办？</summary><p>先检查地址、垃圾邮件和邮箱容量。认证失败时重新获取授权码；连接失败时检查网络和邮箱 SMTP 服务。邮件服务器接受后仍可能延迟或退信，请以实际收件为准。</p></details>
        <button id="mail-disable" class="linkbtn" style="margin-top:20px">停用邮件服务并清除已保存的授权码</button>`);
    const form = $('#mail-settings-form'), testForm = $('#mail-test-form');
    const sender = $('#mail-sender'), provider = $('#mail-provider'), secret = $('#mail-password');
    const feedback = $('#mail-feedback'), status = $('#mail-status');
    let busy = false;
    const changed = () => provider.value !== saved.provider || sender.value.trim().toLowerCase() !== saved.sender || !!secret.value;
    const refresh = () => {
        const reusable = saved.has_password && provider.value === saved.provider && sender.value.trim().toLowerCase() === saved.sender;
        secret.required = !reusable;
        $('#mail-secret-hint').textContent = reusable ? '已保存授权码。留空保持现有授权码；填写新值可更新。' : '使用邮箱授权码或应用专用密码，不是邮箱登录密码。';
        const p = saved.providers[provider.value];
        const guides = {
            qq: '登录 QQ 邮箱，在设置中找到 POP3/IMAP/SMTP 服务，开启 SMTP 并生成授权码。',
            '163': '登录 163 邮箱，在设置中找到 POP3/SMTP/IMAP，开启 SMTP 并设置客户端授权密码。',
            gmail: '先开启 Google 两步验证，再生成应用专用密码。若账号不允许生成，请更换发件邮箱或联系账号管理员。运行服务的网络需要能连接 Google。',
        };
        const links = {qq: ['https://mail.qq.com', '打开 QQ 邮箱'], '163': ['https://mail.163.com', '打开 163 邮箱'], gmail: ['https://myaccount.google.com/apppasswords', '打开 Google 应用密码']};
        const [url, label] = links[provider.value];
        $('#mail-provider-help').innerHTML = `<p>${esc(guides[provider.value])}</p><a href="${url}" target="_blank" rel="noopener noreferrer">${label} ↗</a><p class="subtitle">服务器已自动配置：${esc(p.host)} · 465 · SSL 加密</p>`;
        status.textContent = saved.mode === 'smtp' ? `已配置邮件发送${saved.sender ? ' · ' + saved.sender : ''}。请发送测试邮件确认收件。` : saved.mode === 'demo' ? '当前是本机演示模式，验证码显示在页面，不会发送邮件。保存配置后切换为真实邮件。' : '邮件服务未启用。请先配置发件邮箱。';
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
        setBusy(true); show('正在保存配置…');
        try {
            saved = await api('/mail/settings', body);
            if (!document.body.contains(form)) return;
            secret.value = ''; sender.value = saved.sender;
            if (!$('#mail-recipient').value) $('#mail-recipient').value = saved.sender;
            show('配置已保存并生效，无需重启。请发送测试邮件确认收件。');
        } catch (e) { show(e.message, true); }
        finally { if (document.body.contains(form)) setBusy(false); }
    };
    testForm.onsubmit = async e => {
        e.preventDefault();
        if (changed()) { show('配置已修改，请先保存再测试。', true); return; }
        const recipient = $('#mail-recipient').value;
        setBusy(true); show('正在连接邮箱服务器并发送测试邮件…');
        try { const result = await api('/mail/test', {recipient}); show(result.message); }
        catch (e) { show(e.message, true); }
        finally { if (document.body.contains(form)) setBusy(false); }
    };
    $('#mail-disable').onclick = async () => {
        setBusy(true);
        try { saved = await api('/mail/settings', {mode: 'disabled'}); secret.value = ''; show('邮件服务已停用，已清除保存的授权码；不会退回演示验证码模式。'); }
        catch (e) { show(e.message, true); }
        finally { if (document.body.contains(form)) setBusy(false); }
    };
    refresh();
}
