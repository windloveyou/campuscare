// Isolated browser acceptance. SMTP is stubbed in the test process; no real mail.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const temp = await mkdtemp(join(tmpdir(), 'campuscare-mail-'));
const setup = `
import os, json, smtplib
from pathlib import Path
from unittest.mock import patch
import server
def capture(message):
    if message['To'] == 'rejected@example.com':
        raise smtplib.SMTPRecipientsRefused({'rejected@example.com': (550, 'test rejection')})
    Path(os.environ['TEST_OUTBOX']).write_text(json.dumps({'to':message['To'], 'body':message.get_content()}))
    return {}
with patch('mailservice.smtplib.SMTP_SSL') as smtp:
    smtp.return_value.__enter__.return_value.send_message.side_effect = capture
    server.main()
`;
const service = spawn('.venv/bin/python', ['-B', '-c', setup], {
    env: {...process.env, HOST:'127.0.0.1', PORT:'8832', CAMPUSCARE_DB:join(temp,'test.db'), CAMPUSCARE_MAIL_CONFIG:join(temp,'mail-settings.json'), CAMPUSCARE_MAIL_MODE:'demo', TEST_OUTBOX:join(temp,'outbox.json')},
    stdio:['ignore','pipe','pipe'],
});
let browser;
try {
    await new Promise((resolve,reject) => {
        const timer = setTimeout(() => reject(Error('Test server startup timeout')), 15000);
        service.stdout.on('data', data => { if (data.toString().includes('running')) { clearTimeout(timer); resolve(); } });
        service.on('exit', code => { clearTimeout(timer); reject(Error('Test server exited '+code)); });
    });
    browser = await chromium.launch({channel:'chrome', headless:true});
    const page = await browser.newPage({viewport:{width:1440,height:1100}});
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8832');
    await page.locator('#account').fill('admin');
    await page.getByRole('button',{name:'进入工作台'}).click();
    await page.locator('#mail-settings-button').click();
    await page.locator('#mail-settings-form').waitFor();
    assert.equal(await page.locator('#mail-test').isDisabled(), true);
    for (const [provider,host] of [['gmail','smtp.gmail.com'], ['163','smtp.163.com'], ['qq','smtp.qq.com']]) {
        await page.locator('#mail-provider').selectOption(provider);
        assert.match(await page.locator('#mail-provider-help').textContent(), new RegExp(host.replaceAll('.','\\.')));
    }
    await mkdir('artifacts',{recursive:true});
    await page.screenshot({path:'artifacts/mail-settings.png',fullPage:true});
    await page.locator('#mail-sender').fill('test-sender@qq.com');
    await page.locator('#mail-password').fill('test-only-placeholder');
    await page.locator('#mail-save').click();
    await page.getByText('配置已保存并生效，无需重启。请发送测试邮件确认收件。',{exact:true}).waitFor();
    assert.equal(await page.locator('#mail-password').inputValue(), '');
    const settings = await (await page.request.get('http://127.0.0.1:8832/api/mail/settings')).json();
    assert.equal(settings.has_password,true); assert.equal('password' in settings,false);
    await page.locator('#mail-recipient').fill('browser@gmail.com');
    await page.locator('#mail-test').click();
    await page.getByText(/邮件服务器已接受测试邮件/).waitFor();
    assert.equal(JSON.parse(await readFile(join(temp,'outbox.json'),'utf8')).to, 'browser@gmail.com');
    await page.locator('#mail-recipient').fill('rejected@example.com');
    await page.locator('#mail-test').click();
    await page.getByText(/收件邮箱被邮件服务拒绝/).waitFor();
    await page.locator('#mail-sender').fill('changed@qq.com');
    assert.equal(await page.locator('#mail-test').isDisabled(),true);
    assert.equal(await page.locator('#mail-password').getAttribute('required'), '');
    await page.keyboard.press('Escape');
    await page.locator('#mail-settings-button').click();
    await page.locator('#mail-settings-form').waitFor();
    assert.equal(await page.locator('#mail-sender').inputValue(),'test-sender@qq.com');
    assert.equal(await page.locator('#mail-password').inputValue(),'');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('.drawer').evaluate(el => el.scrollWidth <= el.clientWidth),true);
    await page.screenshot({path:'artifacts/mail-settings-mobile.png',fullPage:true});
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.setViewportSize({width:1440,height:1100});
    await page.locator('.topbar [data-action=logout]').click();
    await page.getByRole('button',{name:'没有账号？注册',exact:true}).click();
    await page.getByText(/验证码通过邮件发送/).waitFor();
    await page.locator('#auth-email').fill('browser@163.com');
    await page.locator('#send-code').click();
    await page.getByText(/如邮箱可用于本次操作/).waitFor();
    assert.equal(await page.locator('#demo-code').count(),0);
    const delivered = JSON.parse(await readFile(join(temp,'outbox.json'),'utf8'));
    assert.equal(delivered.to,'browser@163.com');
    assert.match(delivered.body,/\d{6}/);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true, smtp:'stubbed; no real emails', checks:['provider presets','private settings','save without restart','secret not returned','test accepted and rejection feedback','unsaved changes cannot test','mobile layout','SMTP code sent without on-screen code']}));
} finally {
    if (browser) await browser.close();
    const stopped = new Promise(resolve => { service.once('exit',resolve); if(service.exitCode !== null) resolve(); });
    service.kill('SIGTERM'); await stopped;
    await rm(temp,{recursive:true,force:true});
}
