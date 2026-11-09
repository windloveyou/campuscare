import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

async function test() {
    const require = createRequire(import.meta.url);
    const {chromium} = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
    const temp = await mkdtemp(join(tmpdir(), 'campuscare-admin-services-'));
    const python = process.env.CAMPUSCARE_TEST_PYTHON || 'python';
    const boot = `import server
server.seed()
http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
print('READY', http.server_port, flush=True)
http.serve_forever()
`;
    const service = spawn(python, ['-B', '-c', boot], {
        cwd: dirname(fileURLToPath(import.meta.url)),
        env: {...process.env, CAMPUSCARE_DB: join(temp, 'test.sqlite3'), CAMPUSCARE_MAIL_MODE: 'disabled'},
        stdio: ['ignore', 'pipe', 'inherit'],
        windowsHide: true,
    });
    const stopped = new Promise(resolve => service.once('close', resolve));
    const png = {name: '申请材料.png', mimeType: 'image/png', buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2EAAAAASUVORK5CYII=', 'base64')};
    let browser;
    try {
        const base = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('服务启动超时')), 15000);
            service.once('error', error => { clearTimeout(timer); reject(error); });
            service.once('close', code => { clearTimeout(timer); reject(new Error('服务已退出：' + code)); });
            let output = '';
            service.stdout.on('data', chunk => {
                output += chunk;
                const port = output.match(/READY (\d+)/)?.[1];
                if (port) { clearTimeout(timer); resolve('http://127.0.0.1:' + port); }
            });
        });
        browser = await chromium.launch({channel: process.env.CAMPUSCARE_BROWSER_CHANNEL || 'chrome', headless: true});
        const errors = [];
        async function login(account) {
            const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
            page.on('pageerror', error => errors.push(error.message));
            const bootstrap = page.waitForResponse(response => response.url() === base + '/api/bootstrap');
            await page.goto(base);
            await bootstrap;
            await page.locator('#account').fill(account);
            await page.locator('#password').fill('Campus2026!');
            await page.getByRole('button', {name: '进入工作台'}).click();
            try {
                await page.locator('.sidebar').waitFor();
            } catch (error) {
                const message = await page.locator('#login-error').allTextContents();
                throw new Error(`登录 ${account} 后未进入工作台：${[...message, ...errors].join('；')}`, {cause: error});
            }
            return page;
        }
        async function openPortal(page) {
            await page.getByRole('button', {name: '行政服务', exact: true}).click();
            await page.locator('#as-status').waitFor();
        }
        async function submit(page, type, purpose, files = []) {
            await page.locator('#as-type').selectOption(type);
            await page.locator('#as-purpose').fill(purpose);
            if (files.length) await page.locator('#as-files').setInputFiles(files);
            await page.getByRole('button', {name: '提交申请', exact: true}).click();
            const dialog = page.getByRole('dialog');
            await dialog.getByText('提交申请', {exact: true}).waitFor();
            return dialog;
        }
        async function decide(dialog, decision, note) {
            await dialog.locator('#as-decision-value').selectOption(decision);
            await dialog.locator('#as-decision-note').fill(note);
            await dialog.getByRole('button', {name: '保存审批结果'}).click();
            await dialog.getByText(note, {exact: true}).waitFor();
        }
        async function downloadMaterial(page, link, expected) {
            const downloaded = page.waitForEvent('download');
            await link.click();
            const file = await downloaded;
            assert.equal(file.suggestedFilename(), expected);
            assert.deepEqual(await readFile(await file.path()), png.buffer);
        }
        async function screenshot(page, name) {
            if (process.env.CAMPUSCARE_TEST_ARTIFACTS) {
                const folder = process.env.CAMPUSCARE_TEST_ARTIFACTS;
                await mkdir(folder, {recursive: true});
                await page.screenshot({path: join(folder, name), fullPage: true});
            }
        }

        const student = await login('student');
        await openPortal(student);
        const number = student.getByLabel('学号 *', {exact: true});
        await number.waitFor();
        assert.equal(await number.inputValue(), 'DEMO-STUDENT-01');
        await student.getByText('当前没有符合条件的申请。').waitFor();
        await screenshot(student, 'admin-services-student.png');

        const profileEdits = {
            name: '申请人更正', student_no: 'UPDATED-01', class_name: '申请测试班',
            department: '信息学院', email: 'applicant@example.com',
        };
        for (const [field, value] of Object.entries(profileEdits)) {
            await student.locator('#as-profile-' + field).fill(value);
        }
        let dialog = await submit(student, 'transcript', '实习申请 <script>测试</script>', [png]);
        for (const value of Object.values(profileEdits)) {
            await dialog.getByText(value, {exact: true}).waitFor();
        }
        await dialog.getByText('实习申请 <script>测试</script>', {exact: true}).waitFor();
        await dialog.getByText('待审批', {exact: true}).waitFor();
        const rowId = await student.locator('[data-as-id]').first().getAttribute('data-as-id');
        await student.keyboard.press('Escape');
        assert.equal(await number.inputValue(), 'DEMO-STUDENT-01');

        const admin = await login('admin');
        await openPortal(admin);
        assert.equal(await admin.locator('#as-status').inputValue(), 'pending');
        await admin.locator(`[data-as-id="${rowId}"]`).click();
        let review = admin.getByRole('dialog');
        await review.getByText('账号登记资料', {exact: true}).waitFor();
        await review.getByText('DEMO-STUDENT-01', {exact: true}).waitFor();
        await review.getByText('UPDATED-01', {exact: true}).waitFor();
        await downloadMaterial(admin, review.getByRole('link', {name: /申请材料.png/}), png.name);
        await decide(review, 'needs_materials', '请补交用途说明材料。');
        await admin.keyboard.press('Escape');
        await admin.getByText('当前没有符合条件的申请。').waitFor();

        await student.getByRole('button', {name: '刷新列表'}).click();
        await student.getByText('待补交材料', {exact: true}).last().waitFor();
        await student.locator(`[data-as-id="${rowId}"]`).click();
        dialog = student.getByRole('dialog');
        await dialog.getByText('请补交用途说明材料。', {exact: true}).waitFor();
        await student.setViewportSize({width: 390, height: 844});
        await dialog.locator('#as-extra-files').setInputFiles({...png, name: '补交材料.png'});
        await dialog.locator('#as-supplement-note').fill('按审批意见补交。');
        assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth), true);
        await screenshot(student, 'admin-services-mobile.png');
        await dialog.getByRole('button', {name: '提交补充材料'}).click();
        await dialog.getByText('按审批意见补交。', {exact: true}).waitFor();
        await dialog.getByText('待审批', {exact: true}).waitFor();
        await student.keyboard.press('Escape');
        assert.equal(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

        await admin.getByRole('button', {name: '刷新列表'}).click();
        await admin.locator(`[data-as-id="${rowId}"]`).click();
        review = admin.getByRole('dialog');
        await downloadMaterial(admin, review.getByRole('link', {name: /补交材料.png/}), '补交材料.png');
        await screenshot(admin, 'admin-services-review.png');
        await decide(review, 'approved', '材料已核对。');
        await admin.keyboard.press('Escape');
        await student.locator('#as-status').selectOption('approved');
        await student.locator(`[data-as-id="${rowId}"]`).click();
        await student.getByRole('dialog').getByText('审批通过', {exact: true}).waitFor();
        await student.keyboard.press('Escape');

        dialog = await submit(student, 'enrollment', '奖学金申请');
        await dialog.getByRole('heading', {name: '在校证明申请'}).waitFor();
        await student.keyboard.press('Escape');
        await admin.getByRole('button', {name: '刷新列表'}).click();
        await admin.getByRole('button', {name: /在校证明/}).click();
        await decide(admin.getByRole('dialog'), 'rejected', '请通过所属学院办理。');
        await student.locator('#as-status').selectOption('rejected');
        await student.getByRole('button', {name: /在校证明/}).click();
        await student.getByRole('dialog').getByText('请通过所属学院办理。', {exact: true}).waitFor();

        for (const account of ['teacher', 'tech']) {
            const page = await login(account);
            assert.equal(await page.getByRole('button', {name: '行政服务', exact: true}).count(), 0);
            await page.close();
        }
        assert.deepEqual(errors, []);
        console.log('Browser checks passed: editable applicant profile, account comparison, downloads, return, supplement, approval, rejection, role navigation, mobile layout.');
    } finally {
        if (browser) await browser.close();
        service.kill();
        await stopped;
        await rm(temp, {recursive: true, force: true});
    }
}

await test();
