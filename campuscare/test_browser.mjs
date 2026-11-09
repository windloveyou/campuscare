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
    locale: 'zh-CN'
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
async function login(role, id) {
    await page.goto(base);
    await page.getByRole('button', {
        name: role,
        exact: true
    }).click();
    await page.locator('#account').fill(id);
    await page.getByRole('button', {
        name: '进入工作台'
    }).click();
    await page.locator('.sidebar').waitFor();
}
async function logout() {
    await page.locator('.topbar [data-action=logout]').click();
    await page.locator('#login-form').waitFor();
}
async function nav(name) {
    await page.locator('nav').getByRole('button', {
        name,
        exact: true
    }).click();
}
try {
    await login('管理人员', 'admin');
    await page.getByRole('heading', {name: '校园运营总览'}).waitFor();
    await page.screenshot({
        path: 'artifacts/dashboard-desktop.png',
        fullPage: true
    });
    await nav('设施概览');
    if (await page.locator('.map-svg [data-location=A] text').first().textContent() !== '明理楼 A') throw Error('Map SVG label regression');
    await nav('设施台账');
    await page.locator('#filter-search').fill('A-101-FAN-01');
    await page.getByRole('button', {
        name: '查看档案'
    }).click();
    await page.locator('.qr-box img').waitFor();
    await page.waitForFunction(() => {
        const el = document.querySelector('.qr-box img');
        return el?.complete && el.naturalWidth > 0;
    });
    await page.keyboard.press('Escape');
    await page.getByRole('button', {
        name: '登记新设施',
        exact: true
    }).click();
    await page.locator('#asset-id').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', {
        name: '查看档案'
    }).click();
    await page.getByRole('button', {
        name: '编辑设施档案',
        exact: true
    }).click();
    await page.getByRole('button', {
        name: '保存设施档案',
        exact: true
    }).click();
    await page.getByRole('button', {
        name: '登记新设施',
        exact: true
    }).waitFor();
    await nav('校园地图');
    await page.locator('.map-locations [data-location=D1]').click();
    await page.getByRole('button', {
        name: /公共区域/
    }).click();
    await nav('维护与预测');
    await page.getByRole('button', {
        name: '运行预测实验'
    }).click();
    await page.getByText('测试集模型 AUROC').waitFor();
    await page.screenshot({
        path: 'artifacts/maintenance.png',
        fullPage: true
    });
    await nav('管理助手');
    await page.getByRole('button', {
        name: '哪些设施反复报修？',
        exact: true
    }).click();
    await page.locator('.chat-answer').waitFor();
    await logout();
    await login('学生 / 老师', 'student');
    await nav('智能报修');
    await page.locator('#report-location').selectOption('A');
    await page.locator('#report-asset').selectOption('A-101-FAN-01');
    await page.locator('#report-description').fill('浏览器验收测试：教室吊扇运行时发出异响，位置已确认。');
    await page.locator('#report-photos').setInputFiles('artifacts/dashboard-desktop.png');
    await page.locator('#previews img').waitFor();
    await page.locator('#analyze-btn').click();
    await page.getByText('证据与判断边界').waitFor();
    await page.locator('#report-title').fill('浏览器验收：吊扇异响');
    await page.screenshot({
        path: 'artifacts/report-desktop.png',
        fullPage: true
    });
    await page.locator('#report-confirm').check();
    await page.getByRole('button', {
        name: '提交报修',
        exact: true
    }).click();
    await page.locator('.drawer .mono').waitFor();
    const tid = await page.locator('.drawer-head .mono').textContent();
    await page.keyboard.press('Escape');
    await logout();
    await login('管理人员', 'admin');
    await nav('工单中心');
    await page.locator('#filter-search').fill(tid);
    await page.getByRole('button', {
        name: '浏览器验收：吊扇异响',
        exact: true
    }).click();
    await page.locator('#assign-person').selectOption('tech');
    await page.getByRole('button', {
        name: '确认派单',
        exact: true
    }).click();
    await page.locator('.drawer .badge.blue').filter({
        hasText: '已派单'
    }).waitFor();
    await page.keyboard.press('Escape');
    await logout();
    await login('维修人员', 'tech');
    await nav('我的维修任务');
    await page.locator('#filter-search').fill(tid);
    await page.getByRole('button', {
        name: '浏览器验收：吊扇异响',
        exact: true
    }).click();
    await page.locator('#action-note').fill('浏览器验收模拟：到场检查。');
    await page.getByRole('button', {
        name: '开始检查维修',
        exact: true
    }).click();
    await page.getByRole('button', {
        name: '提交验收',
        exact: true
    }).waitFor();
    await page.locator('#action-note').fill('浏览器验收模拟：处理结束，等待确认。');
    await page.getByRole('button', {
        name: '提交验收',
        exact: true
    }).click();
    await page.locator('.drawer .badge.blue').filter({
        hasText: '待验收'
    }).waitFor();
    await page.keyboard.press('Escape');
    await logout();
    await login('学生 / 老师', 'student');
    await nav('工单中心');
    await page.locator('#filter-search').fill(tid);
    await page.getByRole('button', {
        name: '浏览器验收：吊扇异响',
        exact: true
    }).click();
    await page.getByRole('button', {
        name: '确认验收通过',
        exact: true
    }).click();
    await page.locator('.drawer .badge.green').filter({
        hasText: '已完成'
    }).waitFor();
    await page.screenshot({
        path: 'artifacts/workflow-completed.png',
        fullPage: true
    });
    await page.keyboard.press('Escape');
    await nav('工作台');
    await page.setViewportSize({
        width: 390,
        height: 844
    });
    await page.reload();
    await page.getByRole('heading', {name: '学生服务'}).waitFor();
    await page.screenshot({
        path: 'artifacts/dashboard-mobile.png',
        fullPage: false
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw Error('Mobile horizontal overflow');
    await nav('校园地图');
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
