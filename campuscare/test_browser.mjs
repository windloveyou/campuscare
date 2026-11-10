// UI acceptance test; uses a fresh browser profile, never a personal Chrome session.
import {
    createRequire
} from 'node:module';
import {
    mkdir
} from 'node:fs/promises';
const require = createRequire(import.meta.url);
const {
    chromium
} = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const base = process.env.CAMPUSCARE_TEST_URL || 'http://127.0.0.1:8830';
await mkdir('artifacts', {
    recursive: true
});
const browser = await chromium.launch({
    channel: 'chrome',
    headless: true
});
const context = await browser.newContext({
    viewport: {
        width: 1440,
        height: 1100
    },
    locale: 'en-US'
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
async function login(role, id) {
    await page.goto(base + '/#login');
    await page.getByRole('button', {
        name: role,
        exact: true
    }).click();
    await page.locator('#account').fill(id);
    await page.getByRole('button', {
        name: 'Sign In'
    }).click();
    await page.locator('.sidebar').waitFor();
}
async function logout() {
    await page.locator('.topbar [data-action=logout]').click();
    await page.getByRole('link', {name: 'Campus Sign In'}).waitFor();
}
async function nav(name) {
    await page.locator('nav').getByRole('button', {
        name,
        exact: true
    }).click();
}
try {
    await login('Administrators', 'admin');
    await page.getByRole('heading', {name: 'Campus Operations Overview'}).waitFor();
    await page.screenshot({
        path: 'artifacts/dashboard-desktop.png',
        fullPage: true
    });
    await nav('Facilities Overview');
    if (await page.locator('.map-svg [data-location=A] text').first().textContent() !== 'Academic Building A') throw Error('Map SVG label regression');
    await nav('Asset Register');
    await page.locator('#filter-search').fill('A-101-FAN-01');
    await page.getByRole('button', {
        name: 'View Record'
    }).click();
    await page.locator('.qr-box img').waitFor();
    await page.waitForFunction(() => {
        const el = document.querySelector('.qr-box img');
        return el?.complete && el.naturalWidth > 0;
    });
    await page.keyboard.press('Escape');
    await page.getByRole('button', {
        name: 'Register an Asset',
        exact: true
    }).click();
    await page.locator('#asset-id').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', {
        name: 'View Record'
    }).click();
    await page.getByRole('button', {
        name: 'Edit Asset Record',
        exact: true
    }).click();
    await page.getByRole('button', {
        name: 'Save Asset Record',
        exact: true
    }).click();
    await page.getByRole('button', {
        name: 'Register an Asset',
        exact: true
    }).waitFor();
    await nav('Campus Map');
    await page.locator('.map-locations [data-location=D1]').click();
    await page.getByRole('button', {
        name: /Public Area/
    }).click();
    await nav('Maintenance and Forecasting');
    await page.getByRole('button', {
        name: 'Run Forecasting Experiment'
    }).click();
    await page.getByText('Model AUROC on Test Set').waitFor();
    await page.screenshot({
        path: 'artifacts/maintenance.png',
        fullPage: true
    });
    await nav('Operations Assistant');
    await page.getByRole('button', {
        name: 'Which assets have repeated reports?',
        exact: true
    }).click();
    await page.locator('.chat-answer').waitFor();
    await logout();
    await login('Students and Faculty', 'student');
    await nav('Report a Facility Issue');
    await page.locator('#report-location').selectOption('A');
    await page.locator('#report-asset').selectOption('A-101-FAN-01');
    await page.locator('#report-description').fill('The classroom ceiling fan makes a loud noise during operation.');
    await page.locator('#report-photos').setInputFiles('artifacts/dashboard-desktop.png');
    await page.locator('#previews img').waitFor();
    await page.locator('#analyze-btn').click();
    await page.getByText('Evidence and Limitations').waitFor();
    await page.locator('#report-title').fill('Ceiling fan making an unusual noise');
    await page.screenshot({
        path: 'artifacts/report-desktop.png',
        fullPage: true
    });
    await page.locator('#report-confirm').check();
    await page.getByRole('button', {
        name: 'Submit Report',
        exact: true
    }).click();
    await page.locator('.drawer .mono').waitFor();
    const tid = await page.locator('.drawer-head .mono').textContent();
    await page.keyboard.press('Escape');
    await logout();
    await login('Administrators', 'admin');
    await nav('Work Orders');
    await page.locator('#filter-search').fill(tid);
    await page.getByRole('button', {
        name: 'Ceiling fan making an unusual noise',
        exact: true
    }).click();
    await page.locator('#assign-person').selectOption('tech');
    await page.getByRole('button', {
        name: 'Confirm Assignment',
        exact: true
    }).click();
    await page.locator('.drawer .badge.blue').filter({
        hasText: 'Assigned'
    }).waitFor();
    await page.keyboard.press('Escape');
    await logout();
    await login('Technicians', 'tech');
    await nav('My Maintenance Tasks');
    await page.locator('#filter-search').fill(tid);
    await page.getByRole('button', {
        name: 'Ceiling fan making an unusual noise',
        exact: true
    }).click();
    await page.locator('#action-note').fill('Inspected the fan on site.');
    await page.getByRole('button', {
        name: 'Start Repair',
        exact: true
    }).click();
    await page.getByRole('button', {
        name: 'Submit for Verification',
        exact: true
    }).waitFor();
    await page.locator('#action-note').fill('Repair complete; awaiting verification.');
    await page.getByRole('button', {
        name: 'Submit for Verification',
        exact: true
    }).click();
    await page.locator('.drawer .badge.blue').filter({
        hasText: 'Awaiting Verification'
    }).waitFor();
    await page.keyboard.press('Escape');
    await logout();
    await login('Students and Faculty', 'student');
    await nav('Work Orders');
    await page.locator('#filter-search').fill(tid);
    await page.getByRole('button', {
        name: 'Ceiling fan making an unusual noise',
        exact: true
    }).click();
    await page.getByRole('button', {
        name: 'Confirm Completion',
        exact: true
    }).click();
    await page.locator('.drawer .badge.green').filter({
        hasText: 'Completed'
    }).waitFor();
    await page.screenshot({
        path: 'artifacts/workflow-completed.png',
        fullPage: true
    });
    await page.keyboard.press('Escape');
    await nav('Dashboard');
    await page.setViewportSize({
        width: 390,
        height: 844
    });
    await page.reload();
    await page.getByRole('heading', {name: 'Student Services'}).waitFor();
    await page.screenshot({
        path: 'artifacts/dashboard-mobile.png',
        fullPage: false
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw Error('Mobile horizontal overflow');
    await nav('Campus Map');
    await page.screenshot({
        path: 'artifacts/map-mobile.png',
        fullPage: false
    });
    if (errors.length) throw Error(errors.join('\n'));
    console.log(JSON.stringify({
        passed: true,
        workflow_ticket: tid,
        consoleErrors: errors.length,
        checks: ['desktop dashboard', 'asset QR', 'map location drilldown', 'forecast', 'management query', 'report analysis', 'student submission', 'admin assignment', 'technician repair', 'student acceptance', 'mobile layout']
    }, null, 2));
} finally {
    await browser.close();
}
