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
        async function login(account, route = '', password = 'Campus2026!') {
            const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
            page.on('pageerror', error => errors.push(error.message));
            const bootstrap = page.waitForResponse(response => response.url() === base + '/api/bootstrap');
            await page.goto(base + '/' + (route || '#login'));
            await bootstrap;
            await page.locator('#account').fill(account);
            await page.locator('#password').fill(password);
            await page.getByRole('button', {name: '进入工作台'}).click();
            try {
                await page.locator('.sidebar').waitFor();
            } catch (error) {
                const message = await page.locator('#login-error').allTextContents();
                throw new Error(`登录 ${account} 后未进入工作台：${[...message, ...errors].join('；')}`, {cause: error});
            }
            assert.equal(await page.getByText(/COURSE PROTOTYPE|设备状态来自业务记录，非实时监测/).count(), 0);
            return page;
        }
        async function openPortal(page) {
            await page.getByRole('button', {name: '行政服务', exact: true}).click();
            await page.getByRole('heading', {name: '最近办理', exact: true}).waitFor();
        }
        async function submit(page, purpose, files = []) {
            await page.locator('#as-purpose').fill(purpose);
            if (files.length) await page.locator('#as-files').setInputFiles(files);
            await page.getByRole('button', {name: '提交申请', exact: true}).click();
            const detail = page.locator('#as-detail-body');
            await detail.getByText('提交申请', {exact: true}).waitFor();
            return detail;
        }
        async function returnToRecords(page) {
            await page.getByRole('link', {name: /^返回(我的申请|审批工作台)$/}).click();
            await page.locator('#as-status').waitFor();
        }
        async function filter(page, {status = '', number = '', type = '', owner = ''} = {}) {
            await page.locator('#as-status').selectOption(status);
            await page.locator('#as-search').fill(number);
            await page.locator('#as-filter-type').selectOption(type);
            if (await page.locator('#as-owner').count()) await page.locator('#as-owner').selectOption(owner);
            await page.getByRole('button', {name: '查询', exact: true}).click();
        }
        async function openRecord(page, id) {
            await page.locator(`[data-as-id="${id}"]`).click();
            const detail = page.locator('#as-detail-body');
            await detail.getByText('办理进度', {exact: true}).waitFor();
            return detail;
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

        const motionVisitor = await browser.newPage({viewport: {width: 1440, height: 960}, reducedMotion: 'no-preference'});
        motionVisitor.on('pageerror', error => errors.push(error.message));
        await motionVisitor.goto(base);
        await motionVisitor.getByRole('heading', {name: '校园服务', exact: true}).waitFor();
        assert.equal(await motionVisitor.locator('#hero').innerText(), '');
        assert.equal(await motionVisitor.locator('#hero').getByRole('button').count(), 0);
        await motionVisitor.locator('.ribbon.motion-revealed').waitFor();
        assert.equal(await motionVisitor.locator('.campus-photo.active').getAttribute('src'), '/gcu-quadrangle.webp');
        await motionVisitor.waitForFunction(() => document.querySelector('.campus-photo.active')?.getAttribute('src') === '/gcu-library-terrace.webp', null, {timeout: 9000});
        const splitFrame = motionVisitor.locator('.split-photo-frame');
        await splitFrame.scrollIntoViewIfNeeded();
        await motionVisitor.locator('.split-img.motion-revealed').waitFor();
        const imageTranslation = image => getComputedStyle(image).translate;
        const splitImage = splitFrame.locator('img');
        const priorShift = await splitImage.evaluate(imageTranslation);
        await motionVisitor.evaluate(() => window.scrollBy({top: 150, behavior: 'instant'}));
        await motionVisitor.waitForFunction(previous => getComputedStyle(document.querySelector('.split-photo')).translate !== previous, priorShift);
        assert.notEqual(await splitImage.evaluate(imageTranslation), 'none');
        assert.ok(await motionVisitor.locator('.scroll-meter').evaluate(meter => Number(meter.style.getPropertyValue('--page-progress'))) > 0);
        const animatedCard = motionVisitor.locator('#public-services .class-card').first();
        await animatedCard.hover();
        await motionVisitor.waitForFunction(() => {
            const image = document.querySelector('#public-services .class-card:hover .class-img');
            return image && getComputedStyle(image).transform !== 'none';
        });
        await motionVisitor.getByRole('button', {name: '暂停首页轮播'}).click();
        assert.equal(await motionVisitor.locator('.public-site.gallery-playing').count(), 0);
        await motionVisitor.close();

        const visitor = await browser.newPage({viewport: {width: 1440, height: 960}, reducedMotion: 'reduce'});
        visitor.on('pageerror', error => errors.push(error.message));
        await visitor.goto(base);
        await visitor.getByRole('heading', {name: '校园服务', exact: true}).waitFor();
        await visitor.getByRole('heading', {name: '校园服务概览', exact: true}).waitFor();
        assert.equal(await visitor.locator('#login-form').count(), 0);
        assert.equal(await visitor.getByText('演示账号说明', {exact: true}).count(), 0);
        assert.equal(await visitor.locator('.motion-revealed').count(), 0);
        assert.equal(await visitor.locator('.scroll-meter').isVisible(), false);
        assert.equal(await visitor.locator('.split-photo').evaluate(imageTranslation), 'none');
        const photos = visitor.locator('.public-site [data-parallax] img');
        const sources = await photos.evaluateAll(images => images.map(image => image.getAttribute('src')));
        assert.equal(sources.length, 13);
        assert.equal(new Set(sources).size, sources.length);
        await photos.evaluateAll(images => Promise.all(images.map(image => {
            image.loading = 'eager';
            return image.decode();
        })));
        await visitor.getByRole('button', {name: '播放首页轮播'}).waitFor();
        assert.equal(await visitor.locator('.public-site.gallery-playing').count(), 0);
        assert.equal(await visitor.locator('.ribbon [data-public-service]').count(), 6);
        await screenshot(visitor, 'campus-portal-public.png');
        await visitor.setViewportSize({width: 390, height: 844});
        assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await visitor.getByRole('button', {name: '打开菜单'}).click();
        await visitor.getByRole('navigation', {name: '网站导航'}).getByRole('link', {name: '校园图景'}).click();
        assert.equal(await visitor.getByRole('button', {name: '打开菜单'}).getAttribute('aria-expanded'), 'false');
        await visitor.getByRole('heading', {name: 'GCU 校园图景', exact: true}).waitFor();
        const photoLink = visitor.getByRole('link', {name: '查看校园步道大图'});
        await photoLink.click();
        const viewer = visitor.getByRole('dialog');
        await viewer.getByRole('heading', {name: '校园步道'}).waitFor();
        await visitor.keyboard.press('ArrowRight');
        await viewer.getByRole('heading', {name: '设计工作室'}).waitFor();
        await visitor.keyboard.press('Escape');
        await viewer.waitFor({state: 'detached'});
        assert.equal(await photoLink.evaluate(link => document.activeElement === link), true);
        await visitor.evaluate(() => window.scrollTo(0, 0));
        await screenshot(visitor, 'campus-portal-public-mobile.png');
        await visitor.getByRole('button', {name: '行政服务', exact: true}).click();
        assert.equal(await visitor.locator('#public-services .class-card').count(), 2);
        await visitor.locator('#public-services article').filter({hasText: '成绩单申请'}).getByRole('button', {name: '办理入口'}).click();
        await visitor.waitForURL(url => url.hash === '#login?service=transcript');
        await visitor.getByText('登录后将打开：成绩单申请', {exact: true}).waitFor();
        assert.equal(await visitor.locator('.public-site').count(), 0);
        assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await screenshot(visitor, 'campus-account-mobile.png');
        await visitor.reload();
        await visitor.getByText('登录后将打开：成绩单申请', {exact: true}).waitFor();
        await visitor.getByRole('link', {name: '忘记密码？'}).click();
        await visitor.getByRole('heading', {name: '找回密码', exact: true}).waitFor();
        await visitor.getByRole('link', {name: '返回登录'}).click();
        await visitor.getByText('登录后将打开：成绩单申请', {exact: true}).waitFor();
        await visitor.getByRole('link', {name: '没有账号？注册'}).click();
        await visitor.getByRole('heading', {name: '创建校园账号', exact: true}).waitFor();
        await visitor.goBack();
        await visitor.getByText('登录后将打开：成绩单申请', {exact: true}).waitFor();
        await visitor.getByRole('link', {name: '返回服务目录'}).click();
        await visitor.waitForURL('**/#service-catalog');
        await visitor.getByRole('heading', {name: '校园服务目录', exact: true}).waitFor();
        assert.equal(await visitor.locator('#login-form').count(), 0);
        await visitor.setViewportSize({width: 1440, height: 960});
        await visitor.getByRole('link', {name: '校园账号登录', exact: true}).click();
        await visitor.getByRole('heading', {name: '校园账号登录', exact: true}).waitFor();
        await visitor.getByRole('button', {name: '管理人员', exact: true}).click();
        await visitor.getByRole('heading', {name: '管理人员登录', exact: true}).waitFor();
        assert.equal(await visitor.locator('#account').inputValue(), 'admin');
        await visitor.goBack();
        await visitor.getByRole('heading', {name: '校园服务目录', exact: true}).waitFor();
        await visitor.locator('#public-services article').filter({hasText: '成绩单申请'}).getByRole('button', {name: '办理入口'}).click();
        await visitor.getByText('登录后将打开：成绩单申请', {exact: true}).waitFor();
        await screenshot(visitor, 'campus-account-desktop.png');
        await visitor.getByRole('button', {name: '进入工作台'}).click();
        assert.equal(await visitor.locator('#as-type').inputValue(), 'transcript');
        await visitor.close();

        const student = await login('student');
        await student.getByRole('heading', {name: '学生服务'}).waitFor();
        await student.locator('#content.motion-page').waitFor();
        await screenshot(student, 'campus-portal-student-home.png');
        await student.keyboard.press('Control+k');
        await student.locator('#command-query').fill('用户管理');
        await student.getByText('没有匹配的服务', {exact: true}).waitFor();
        await student.locator('#command-query').fill('在校证明');
        await student.locator('#command-query').press('Enter');
        assert.equal(await student.locator('#as-type').inputValue(), 'enrollment');
        await student.goBack();
        await student.getByRole('heading', {name: '学生服务'}).waitFor();
        await openPortal(student);
        await student.getByText('暂无办理记录。').waitFor();
        await screenshot(student, 'admin-services-student.png');
        await student.getByRole('link', {name: '查看办理指南', exact: true}).click();
        await student.getByRole('heading', {name: '办理指南', exact: true}).waitFor();
        assert.equal(await student.getByRole('heading', {name: '审批操作清单'}).count(), 0);
        await student.getByText('材料有哪些要求？', {exact: true}).click();
        await student.getByText(/首次提交可按需附加材料/).waitFor();
        assert.match(student.url(), /#admin-services\/guide$/);
        await student.goBack();
        await student.getByRole('link', {name: '申请成绩单', exact: true}).click();
        const number = student.getByLabel('学号 *', {exact: true});
        await number.waitFor();
        assert.equal(await number.inputValue(), 'DEMO-STUDENT-01');
        assert.equal(await student.locator('#as-type').inputValue(), 'transcript');
        assert.match(student.url(), /#admin-services\/apply\?type=transcript$/);
        await screenshot(student, 'admin-services-apply.png');

        const profileEdits = {
            name: '申请人更正', student_no: 'UPDATED-01', class_name: '申请测试班',
            department: '信息学院', email: 'applicant@example.com',
        };
        for (const [field, value] of Object.entries(profileEdits)) {
            await student.locator('#as-profile-' + field).fill(value);
        }
        let dialog = await submit(student, '实习申请 <script>测试</script>', [png]);
        for (const value of Object.values(profileEdits)) {
            await dialog.getByText(value, {exact: true}).waitFor();
        }
        await dialog.getByText('实习申请 <script>测试</script>', {exact: true}).waitFor();
        await dialog.getByText('待审批', {exact: true}).waitFor();
        const rowId = await student.locator('#as-detail-id').textContent();
        assert.match(student.url(), /#admin-services\/detail\/AS-[0-9A-F]+$/);
        await student.reload();
        await student.getByRole('heading', {name: '成绩单申请'}).waitFor();
        await student.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await student.getByRole('button', {name: '复制编号'}).click();
        await student.getByText('申请编号已复制', {exact: true}).waitFor();
        assert.equal(await student.evaluate(() => navigator.clipboard.readText()), rowId);
        await returnToRecords(student);
        await filter(student, {status: 'pending', number: rowId.toLowerCase(), type: 'transcript'});
        dialog = await openRecord(student, rowId);
        await returnToRecords(student);
        assert.equal(await student.locator('#as-search').inputValue(), rowId.toLowerCase());
        assert.equal(await student.locator('#as-filter-type').inputValue(), 'transcript');

        const admin = await login('admin');
        await admin.getByRole('heading', {name: '校园运营总览'}).waitFor();
        await admin.getByRole('button', {name: /待审批申请/}).waitFor();
        await screenshot(admin, 'campus-portal-operations.png');
        const session = await (await admin.request.get(base + '/api/bootstrap')).json();
        const created = await admin.request.post(base + '/api/users', {
            headers: {'X-CSRF-Token': session.user.csrf},
            data: {username: 'second_admin', name: '协作管理员', role: 'admin', password: 'Reviewer2026!'},
        });
        assert.equal(created.status(), 201, await created.text());
        await openPortal(admin);
        await admin.getByRole('link', {name: '待领取 · 1', exact: true}).waitFor();
        await admin.getByRole('link', {name: '查看审批指南', exact: true}).click();
        await admin.getByRole('heading', {name: '审批操作清单', exact: true}).waitFor();
        await admin.getByRole('heading', {name: '怎么选择审批结果', exact: true}).waitFor();
        assert.equal(await admin.getByRole('heading', {name: '常见问题', exact: true}).count(), 0);
        assert.equal(await admin.getByText(/COURSE PROTOTYPE|设备状态来自业务记录，非实时监测/).count(), 0);
        await screenshot(admin, 'admin-services-approval-guide.png');
        await admin.getByRole('link', {name: '打开待领取队列', exact: true}).click();
        assert.equal(await admin.locator('#as-status').inputValue(), 'pending');
        assert.equal(await admin.locator('#as-owner').inputValue(), 'unassigned');
        let review = await openRecord(admin, rowId);
        await review.getByText('账号登记资料', {exact: true}).waitFor();
        await review.getByText('DEMO-STUDENT-01', {exact: true}).waitFor();
        await review.getByText('UPDATED-01', {exact: true}).waitFor();
        await downloadMaterial(admin, review.getByRole('link', {name: /申请材料.png/}), png.name);
        await review.getByRole('button', {name: '领取经办', exact: true}).click();
        await review.getByText('由我经办', {exact: true}).waitFor();
        await review.locator('#as-transfer-to').selectOption('second_admin');
        await review.locator('#as-handoff-note').fill('内部：请重点核对申请用途。');
        await screenshot(admin, 'admin-services-collaboration.png');
        await review.getByRole('button', {name: '转交申请', exact: true}).click();
        await review.getByText(/此申请由其他管理员经办/).waitFor();
        assert.equal(await review.locator('#as-decision').count(), 0);
        await review.getByText('交接记录（2）', {exact: true}).click();
        await review.getByText(/内部：请重点核对申请用途/).waitFor();
        await returnToRecords(admin);
        await admin.getByText('当前没有符合条件的申请。').waitFor();

        const colleague = await login('second_admin', '', 'Reviewer2026!');
        await openPortal(colleague);
        await colleague.getByRole('link', {name: '我负责的 · 1', exact: true}).click();
        assert.equal(await colleague.locator('#as-owner').inputValue(), 'mine');
        await decide(await openRecord(colleague, rowId), 'needs_materials', '请补交用途说明材料。');
        await returnToRecords(colleague);
        await student.getByRole('link', {name: '服务首页', exact: true}).click();
        const supplementMetric = student.getByRole('link', {name: /待补交材料.*查看记录/});
        await supplementMetric.getByText('1', {exact: true}).waitFor();
        await supplementMetric.click();
        assert.equal(await student.locator('#as-status').inputValue(), 'needs_materials');
        dialog = await openRecord(student, rowId);
        await dialog.getByText('请补交用途说明材料。', {exact: true}).waitFor();
        assert.equal(await dialog.getByText(/内部：请重点核对申请用途/).count(), 0);
        assert.equal(await dialog.getByRole('heading', {name: '经办协作'}).count(), 0);
        await student.setViewportSize({width: 390, height: 844});
        await dialog.locator('#as-extra-files').setInputFiles({...png, name: '补交材料.png'});
        await dialog.locator('#as-supplement-note').fill('按审批意见补交。');
        assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth), true);
        await screenshot(student, 'admin-services-mobile.png');
        await dialog.getByRole('button', {name: '提交补充材料'}).click();
        await dialog.getByText('按审批意见补交。', {exact: true}).waitFor();
        await dialog.getByText('待审批', {exact: true}).waitFor();
        await returnToRecords(student);
        assert.equal(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

        await colleague.getByRole('button', {name: '刷新列表'}).click();
        review = await openRecord(colleague, rowId);
        await downloadMaterial(colleague, review.getByRole('link', {name: /补交材料.png/}), '补交材料.png');
        await screenshot(colleague, 'admin-services-review.png');
        await decide(review, 'approved', '材料已核对。');
        await returnToRecords(colleague);
        await filter(student, {status: 'approved'});
        dialog = await openRecord(student, rowId);
        await dialog.getByText('审批通过', {exact: true}).waitFor();
        assert.equal(await dialog.locator('.as-cancel').count(), 0);

        await student.getByRole('link', {name: '服务首页', exact: true}).click();
        await student.getByRole('link', {name: '申请在校证明', exact: true}).click();
        await number.waitFor();
        assert.equal(await number.inputValue(), 'DEMO-STUDENT-01');
        assert.equal(await student.locator('#as-type').inputValue(), 'enrollment');
        dialog = await submit(student, '奖学金申请');
        await student.getByRole('heading', {name: '在校证明申请'}).waitFor();
        const enrollmentId = await student.locator('#as-detail-id').textContent();
        await returnToRecords(student);
        await admin.getByRole('button', {name: '刷新列表'}).click();
        await decide(await openRecord(admin, enrollmentId), 'rejected', '请通过所属学院办理。');
        await filter(student, {status: 'rejected'});
        await (await openRecord(student, enrollmentId)).getByText('请通过所属学院办理。', {exact: true}).waitFor();

        const direct = await login('student', '#admin-services/detail/' + enrollmentId);
        await direct.getByRole('heading', {name: '在校证明申请'}).waitFor();
        await direct.close();

        await student.getByRole('navigation', {name: '行政服务导航'}).getByRole('link', {name: '新建申请'}).click();
        await student.locator('#as-type').selectOption('transcript');
        dialog = await submit(student, '验证取消申请');
        const cancelledId = await student.locator('#as-detail-id').textContent();
        const cancelToggle = dialog.locator('.as-cancel summary');
        await cancelToggle.click();
        await dialog.getByRole('button', {name: '保留申请'}).click();
        assert.equal(await dialog.getByRole('button', {name: '确认取消申请'}).isVisible(), false);
        await dialog.getByText('待审批', {exact: true}).waitFor();
        await cancelToggle.click();
        await dialog.getByRole('button', {name: '确认取消申请'}).click();
        await dialog.getByText('已取消', {exact: true}).waitFor();
        await dialog.getByText('学生取消申请', {exact: true}).waitFor();
        assert.equal(await dialog.locator('.as-cancel').count(), 0);
        await returnToRecords(student);
        await filter(student, {status: 'cancelled'});
        await student.locator(`[data-as-id="${cancelledId}"]`).waitFor();
        await returnToRecords(admin);
        await filter(admin, {status: 'cancelled'});
        review = await openRecord(admin, cancelledId);
        await review.getByText('学生取消申请', {exact: true}).waitFor();
        assert.equal(await review.locator('#as-decision').count(), 0);

        for (const account of ['teacher', 'tech']) {
            const page = await login(account, '#admin-services/detail/' + enrollmentId);
            assert.equal(await page.getByRole('button', {name: '行政服务', exact: true}).count(), 0);
            assert.equal(await page.locator('#as-detail-body').count(), 0);
            await page.close();
        }
        assert.deepEqual(errors, []);
        console.log('Browser checks passed: campus photo gallery, public service directory, role-based home, keyboard search, approval, reviewer collaboration, supplement, cancellation, downloads and mobile layout.');
    } finally {
        if (browser) await browser.close();
        service.kill();
        await stopped;
        await rm(temp, {recursive: true, force: true});
    }
}

await test();
