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
    const png = {name: 'application-material.png', mimeType: 'image/png', buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2EAAAAASUVORK5CYII=', 'base64')};
    let browser;
    try {
        const base = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Server startup timed out')), 15000);
            service.once('error', error => { clearTimeout(timer); reject(error); });
            service.once('close', code => { clearTimeout(timer); reject(new Error('Server exited: ' + code)); });
            let output = '';
            service.stdout.on('data', chunk => {
                output += chunk;
                const port = output.match(/READY (\d+)/)?.[1];
                if (port) { clearTimeout(timer); resolve('http://127.0.0.1:' + port); }
            });
        });
        browser = await chromium.launch({channel: process.env.CAMPUSCARE_BROWSER_CHANNEL || 'chrome', headless: true});
        const errors = [];
        async function checkEnglish(page) {
            assert.equal(await page.locator('html').getAttribute('lang'), 'en-US');
            assert.match(await page.title(), /SmartCampus/);
            assert.doesNotMatch(await page.locator('#app').innerText(), /\p{Script=Han}|CampusCare/u);
        }
        async function login(account, route = '', password = 'Campus2026!') {
            const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
            page.on('pageerror', error => errors.push(error.message));
            const bootstrap = page.waitForResponse(response => response.url() === base + '/api/bootstrap');
            await page.goto(base + '/' + (route || '#login'));
            await bootstrap;
            await page.locator('#account').fill(account);
            await page.locator('#password').fill(password);
            await page.getByRole('button', {name: 'Sign In'}).click();
            try {
                await page.locator('.sidebar').waitFor();
            } catch (error) {
                const message = await page.locator('#login-error').allTextContents();
                throw new Error(`Dashboard did not load for ${account}: ${[...message, ...errors].join('; ')}`, {cause: error});
            }
            assert.equal(await page.getByText(/COURSE PROTOTYPE/).count(), 0);
            return page;
        }
        async function openPortal(page) {
            await page.getByRole('button', {name: 'Administrative Services', exact: true}).click();
            await page.getByRole('heading', {name: 'Recent Applications', exact: true}).waitFor();
        }
        async function submit(page, purpose, files = []) {
            await page.locator('#as-purpose').fill(purpose);
            if (files.length) await page.locator('#as-files').setInputFiles(files);
            await page.getByRole('button', {name: 'Submit Application', exact: true}).click();
            const detail = page.locator('#as-detail-body');
            await detail.getByText('Application Submitted', {exact: true}).waitFor();
            return detail;
        }
        async function returnToRecords(page) {
            await page.getByRole('link', {name: /^Back to (My Applications|Review Workspace)$/}).click();
            await page.locator('#as-status').waitFor();
        }
        async function filter(page, {status = '', number = '', type = '', owner = ''} = {}) {
            await page.locator('#as-status').selectOption(status);
            await page.locator('#as-search').fill(number);
            await page.locator('#as-filter-type').selectOption(type);
            if (await page.locator('#as-owner').count()) await page.locator('#as-owner').selectOption(owner);
            await page.getByRole('button', {name: 'Search', exact: true}).click();
        }
        async function openRecord(page, id) {
            await page.locator(`[data-as-id="${id}"]`).click();
            const detail = page.locator('#as-detail-body');
            await detail.getByText('Application History', {exact: true}).waitFor();
            return detail;
        }
        async function decide(dialog, decision, note) {
            await dialog.locator('#as-decision-value').selectOption(decision);
            await dialog.locator('#as-decision-note').fill(note);
            await dialog.getByRole('button', {name: 'Save Decision'}).click();
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
        await motionVisitor.getByRole('heading', {name: 'Campus Services', exact: true}).waitFor();
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
        await motionVisitor.getByRole('button', {name: 'Pause homepage slideshow'}).click();
        assert.equal(await motionVisitor.locator('.public-site.gallery-playing').count(), 0);
        await motionVisitor.close();

        const visitor = await browser.newPage({viewport: {width: 1440, height: 960}, reducedMotion: 'reduce'});
        visitor.on('pageerror', error => errors.push(error.message));
        await visitor.goto(base);
        await visitor.getByRole('heading', {name: 'Campus Services', exact: true}).waitFor();
        await visitor.getByRole('heading', {name: 'Campus Services Overview', exact: true}).waitFor();
        await checkEnglish(visitor);
        assert.equal(await visitor.locator('#login-form').count(), 0);
        assert.equal(await visitor.getByText('Demo Account Information', {exact: true}).count(), 0);
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
        await visitor.getByRole('button', {name: 'Play homepage slideshow'}).waitFor();
        assert.equal(await visitor.locator('.public-site.gallery-playing').count(), 0);
        assert.equal(await visitor.locator('.ribbon [data-public-service]').count(), 6);
        await screenshot(visitor, 'campus-portal-public.png');
        await visitor.setViewportSize({width: 390, height: 844});
        assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await visitor.getByRole('button', {name: 'Open menu'}).click();
        await visitor.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', {name: 'Campus Gallery'}).click();
        assert.equal(await visitor.getByRole('button', {name: 'Open menu'}).getAttribute('aria-expanded'), 'false');
        await visitor.getByRole('heading', {name: 'GCU Campus Gallery', exact: true}).waitFor();
        const photoLink = visitor.getByRole('link', {name: 'View full-size photo: Campus Walkway'});
        await photoLink.click();
        const viewer = visitor.getByRole('dialog');
        await viewer.getByRole('heading', {name: 'Campus Walkway'}).waitFor();
        await visitor.keyboard.press('ArrowRight');
        await viewer.getByRole('heading', {name: 'Design Studio'}).waitFor();
        await visitor.keyboard.press('Escape');
        await viewer.waitFor({state: 'detached'});
        assert.equal(await photoLink.evaluate(link => document.activeElement === link), true);
        await visitor.evaluate(() => window.scrollTo(0, 0));
        await screenshot(visitor, 'campus-portal-public-mobile.png');
        await visitor.getByRole('button', {name: 'Administrative Services', exact: true}).click();
        assert.equal(await visitor.locator('#public-services .class-card').count(), 2);
        await visitor.locator('#public-services article').filter({hasText: 'Transcript Request'}).getByRole('button', {name: 'Open Service'}).click();
        await visitor.waitForURL(url => url.hash === '#login?service=transcript');
        await visitor.getByText('After signing in: Transcript Request', {exact: true}).waitFor();
        await checkEnglish(visitor);
        assert.equal(await visitor.locator('.public-site').count(), 0);
        assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await screenshot(visitor, 'campus-account-mobile.png');
        await visitor.reload();
        await visitor.getByText('After signing in: Transcript Request', {exact: true}).waitFor();
        await visitor.getByRole('link', {name: 'Forgot your password?'}).click();
        await visitor.getByRole('heading', {name: 'Reset Password', exact: true}).waitFor();
        await visitor.getByRole('link', {name: 'Back to Sign In'}).click();
        await visitor.getByText('After signing in: Transcript Request', {exact: true}).waitFor();
        await visitor.getByRole('link', {name: 'Create an account'}).click();
        await visitor.getByRole('heading', {name: 'Create a Campus Account', exact: true}).waitFor();
        await visitor.goBack();
        await visitor.getByText('After signing in: Transcript Request', {exact: true}).waitFor();
        await visitor.getByRole('link', {name: 'Back to Service Directory'}).click();
        await visitor.waitForURL('**/#service-catalog');
        await visitor.getByRole('heading', {name: 'Campus Service Directory', exact: true}).waitFor();
        assert.equal(await visitor.locator('#login-form').count(), 0);
        await visitor.setViewportSize({width: 1440, height: 960});
        await visitor.getByRole('link', {name: 'Campus Sign In', exact: true}).click();
        await visitor.getByRole('heading', {name: 'Campus Sign In', exact: true}).waitFor();
        await visitor.getByRole('button', {name: 'Administrators', exact: true}).click();
        await visitor.getByRole('heading', {name: 'Administrator Sign In', exact: true}).waitFor();
        assert.equal(await visitor.locator('#account').inputValue(), 'admin');
        await visitor.goBack();
        await visitor.getByRole('heading', {name: 'Campus Service Directory', exact: true}).waitFor();
        await visitor.locator('#public-services article').filter({hasText: 'Transcript Request'}).getByRole('button', {name: 'Open Service'}).click();
        await visitor.getByText('After signing in: Transcript Request', {exact: true}).waitFor();
        await screenshot(visitor, 'campus-account-desktop.png');
        await visitor.getByRole('button', {name: 'Sign In'}).click();
        assert.equal(await visitor.locator('#as-type').inputValue(), 'transcript');
        await visitor.close();

        const student = await login('student');
        await student.getByRole('heading', {name: 'Student Services'}).waitFor();
        await checkEnglish(student);
        await student.locator('#content.motion-page').waitFor();
        await screenshot(student, 'campus-portal-student-home.png');
        await student.keyboard.press('Control+k');
        await student.locator('#command-query').fill('User Management');
        await student.getByText('No matching services', {exact: true}).waitFor();
        await student.locator('#command-query').fill('Proof of Enrollment');
        await student.locator('#command-query').press('Enter');
        assert.equal(await student.locator('#as-type').inputValue(), 'enrollment');
        await student.goBack();
        await student.getByRole('heading', {name: 'Student Services'}).waitFor();
        await openPortal(student);
        await student.getByText('No applications yet.').waitFor();
        await screenshot(student, 'admin-services-student.png');
        await student.getByRole('link', {name: 'View Application Guide', exact: true}).click();
        await student.getByRole('heading', {name: 'Application Guide', exact: true}).waitFor();
        assert.equal(await student.getByRole('heading', {name: 'Review Checklist'}).count(), 0);
        await student.getByText('What documents do I need to upload?', {exact: true}).click();
        await student.getByText(/Attachments are optional when you first apply/).waitFor();
        assert.match(student.url(), /#admin-services\/guide$/);
        await student.goBack();
        await student.getByRole('link', {name: 'Request a Transcript', exact: true}).click();
        const number = student.getByLabel('Student ID *', {exact: true});
        await number.waitFor();
        assert.equal(await number.inputValue(), 'DEMO-STUDENT-01');
        assert.equal(await student.locator('#as-type').inputValue(), 'transcript');
        assert.match(student.url(), /#admin-services\/apply\?type=transcript$/);
        await screenshot(student, 'admin-services-apply.png');

        const profileEdits = {
            name: 'Updated Applicant', student_no: 'UPDATED-01', class_name: 'Application Test Class',
            department: 'School of Information', email: 'applicant@example.com',
        };
        for (const [field, value] of Object.entries(profileEdits)) {
            await student.locator('#as-profile-' + field).fill(value);
        }
        let dialog = await submit(student, 'Internship application <script>test</script>', [png]);
        for (const value of Object.values(profileEdits)) {
            await dialog.getByText(value, {exact: true}).waitFor();
        }
        await dialog.getByText('Internship application <script>test</script>', {exact: true}).waitFor();
        await dialog.getByText('Pending Review', {exact: true}).waitFor();
        const rowId = await student.locator('#as-detail-id').textContent();
        assert.match(student.url(), /#admin-services\/detail\/AS-[0-9A-F]+$/);
        await student.reload();
        await student.getByRole('heading', {name: 'Transcript Request'}).waitFor();
        await student.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await student.getByRole('button', {name: 'Copy Reference'}).click();
        await student.getByText('Application reference copied.', {exact: true}).waitFor();
        assert.equal(await student.evaluate(() => navigator.clipboard.readText()), rowId);
        await returnToRecords(student);
        await filter(student, {status: 'pending', number: rowId.toLowerCase(), type: 'transcript'});
        dialog = await openRecord(student, rowId);
        await returnToRecords(student);
        assert.equal(await student.locator('#as-search').inputValue(), rowId.toLowerCase());
        assert.equal(await student.locator('#as-filter-type').inputValue(), 'transcript');

        const admin = await login('admin');
        await admin.getByRole('heading', {name: 'Campus Operations Overview'}).waitFor();
        await checkEnglish(admin);
        await admin.getByRole('button', {name: /Applications Pending Review/}).waitFor();
        await screenshot(admin, 'campus-portal-operations.png');
        const session = await (await admin.request.get(base + '/api/bootstrap')).json();
        const created = await admin.request.post(base + '/api/users', {
            headers: {'X-CSRF-Token': session.user.csrf},
            data: {username: 'second_admin', name: 'Second Reviewer', role: 'admin', password: 'Reviewer2026!'},
        });
        assert.equal(created.status(), 201, await created.text());
        await openPortal(admin);
        await admin.getByRole('link', {name: 'Unassigned · 1', exact: true}).waitFor();
        await admin.getByRole('link', {name: 'View Review Guide', exact: true}).click();
        await admin.getByRole('heading', {name: 'Review Checklist', exact: true}).waitFor();
        await admin.getByRole('heading', {name: 'Decision Guidance', exact: true}).waitFor();
        assert.equal(await admin.getByRole('heading', {name: 'Frequently Asked Questions', exact: true}).count(), 0);
        assert.equal(await admin.getByText(/COURSE PROTOTYPE/).count(), 0);
        await screenshot(admin, 'admin-services-approval-guide.png');
        await admin.getByRole('link', {name: 'Open Unassigned Queue', exact: true}).click();
        assert.equal(await admin.locator('#as-status').inputValue(), 'pending');
        assert.equal(await admin.locator('#as-owner').inputValue(), 'unassigned');
        let review = await openRecord(admin, rowId);
        await review.getByText('Account Records', {exact: true}).waitFor();
        await review.getByText('DEMO-STUDENT-01', {exact: true}).waitFor();
        await review.getByText('UPDATED-01', {exact: true}).waitFor();
        await downloadMaterial(admin, review.getByRole('link', {name: /application-material.png/}), png.name);
        await review.getByRole('button', {name: 'Claim Application', exact: true}).click();
        await review.getByText('Assigned to Me', {exact: true}).waitFor();
        await review.locator('#as-transfer-to').selectOption('second_admin');
        await review.locator('#as-handoff-note').fill('Internal: verify the stated purpose.');
        await screenshot(admin, 'admin-services-collaboration.png');
        await review.getByRole('button', {name: 'Reassign Application', exact: true}).click();
        await review.getByText(/Another administrator is reviewing this application/).waitFor();
        assert.equal(await review.locator('#as-decision').count(), 0);
        await review.getByText('Assignment History (2)', {exact: true}).click();
        await review.getByText(/Internal: verify the stated purpose/).waitFor();
        await returnToRecords(admin);
        await admin.getByText('No applications match your filters.').waitFor();

        const colleague = await login('second_admin', '', 'Reviewer2026!');
        await openPortal(colleague);
        await colleague.getByRole('link', {name: 'Assigned to Me · 1', exact: true}).click();
        assert.equal(await colleague.locator('#as-owner').inputValue(), 'mine');
        await decide(await openRecord(colleague, rowId), 'needs_materials', 'Please provide evidence of your intended use.');
        await returnToRecords(colleague);
        await student.getByRole('link', {name: 'Services Home', exact: true}).click();
        const supplementMetric = student.getByRole('link', {name: /Awaiting Documents.*View Records/});
        await supplementMetric.getByText('1', {exact: true}).waitFor();
        await supplementMetric.click();
        assert.equal(await student.locator('#as-status').inputValue(), 'needs_materials');
        dialog = await openRecord(student, rowId);
        await dialog.getByText('Please provide evidence of your intended use.', {exact: true}).waitFor();
        assert.equal(await dialog.getByText(/Internal: verify the stated purpose/).count(), 0);
        assert.equal(await dialog.getByRole('heading', {name: 'Reviewer Assignment'}).count(), 0);
        await student.setViewportSize({width: 390, height: 844});
        await dialog.locator('#as-extra-files').setInputFiles({...png, name: 'additional-material.png'});
        await dialog.locator('#as-supplement-note').fill('Documents supplied as requested.');
        assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth), true);
        await screenshot(student, 'admin-services-mobile.png');
        await dialog.getByRole('button', {name: 'Submit Additional Documents'}).click();
        await dialog.getByText('Documents supplied as requested.', {exact: true}).waitFor();
        await dialog.getByText('Pending Review', {exact: true}).waitFor();
        await returnToRecords(student);
        assert.equal(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

        await colleague.getByRole('button', {name: 'Refresh List'}).click();
        review = await openRecord(colleague, rowId);
        await downloadMaterial(colleague, review.getByRole('link', {name: /additional-material.png/}), 'additional-material.png');
        await screenshot(colleague, 'admin-services-review.png');
        await decide(review, 'approved', 'Documents verified.');
        await returnToRecords(colleague);
        await filter(student, {status: 'approved'});
        dialog = await openRecord(student, rowId);
        await dialog.getByText('Application Approved', {exact: true}).waitFor();
        assert.equal(await dialog.locator('.as-cancel').count(), 0);

        await student.getByRole('link', {name: 'Services Home', exact: true}).click();
        await student.getByRole('link', {name: 'Request Proof of Enrollment', exact: true}).click();
        await number.waitFor();
        assert.equal(await number.inputValue(), 'DEMO-STUDENT-01');
        assert.equal(await student.locator('#as-type').inputValue(), 'enrollment');
        dialog = await submit(student, 'Scholarship application');
        await student.getByRole('heading', {name: 'Proof of Enrollment Request'}).waitFor();
        const enrollmentId = await student.locator('#as-detail-id').textContent();
        await returnToRecords(student);
        await admin.getByRole('button', {name: 'Refresh List'}).click();
        await decide(await openRecord(admin, enrollmentId), 'rejected', 'Please contact your school to proceed.');
        await filter(student, {status: 'rejected'});
        await (await openRecord(student, enrollmentId)).getByText('Please contact your school to proceed.', {exact: true}).waitFor();

        const direct = await login('student', '#admin-services/detail/' + enrollmentId);
        await direct.getByRole('heading', {name: 'Proof of Enrollment Request'}).waitFor();
        await direct.close();

        await student.getByRole('navigation', {name: 'Administrative services navigation'}).getByRole('link', {name: 'New Application'}).click();
        await student.locator('#as-type').selectOption('transcript');
        dialog = await submit(student, 'Cancellation test');
        const cancelledId = await student.locator('#as-detail-id').textContent();
        const cancelToggle = dialog.locator('.as-cancel summary');
        await cancelToggle.click();
        await dialog.getByRole('button', {name: 'Keep Application'}).click();
        assert.equal(await dialog.getByRole('button', {name: 'Confirm Cancellation'}).isVisible(), false);
        await dialog.getByText('Pending Review', {exact: true}).waitFor();
        await cancelToggle.click();
        await dialog.getByRole('button', {name: 'Confirm Cancellation'}).click();
        await dialog.getByText('Canceled', {exact: true}).waitFor();
        await dialog.getByText('Canceled by Student', {exact: true}).waitFor();
        assert.equal(await dialog.locator('.as-cancel').count(), 0);
        await returnToRecords(student);
        await filter(student, {status: 'cancelled'});
        await student.locator(`[data-as-id="${cancelledId}"]`).waitFor();
        await returnToRecords(admin);
        await filter(admin, {status: 'cancelled'});
        review = await openRecord(admin, cancelledId);
        await review.getByText('Canceled by Student', {exact: true}).waitFor();
        assert.equal(await review.locator('#as-decision').count(), 0);

        for (const account of ['teacher', 'tech']) {
            const page = await login(account, '#admin-services/detail/' + enrollmentId);
            assert.equal(await page.getByRole('button', {name: 'Administrative Services', exact: true}).count(), 0);
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
