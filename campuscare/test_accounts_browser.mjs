import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'playwright');
const temp=await mkdtemp(join(tmpdir(),'campuscare-auth-'));
const service=spawn(process.env.CAMPUSCARE_TEST_PYTHON || (process.platform === 'win32' ? 'python' : '.venv/bin/python'),['-B','server.py'],{env:{...process.env,HOST:'127.0.0.1',PORT:'8831',CAMPUSCARE_DB:join(temp,'test.db'),CAMPUSCARE_MAIL_CONFIG:join(temp,'mail-settings.json'),CAMPUSCARE_MAIL_MODE:'demo'},stdio:['ignore','pipe','pipe']});
let browser;
try {
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),15000);service.stdout.on('data',data=>{if(data.toString().includes('running')){clearTimeout(timer);resolve();}});service.on('exit',code=>reject(Error('Server exited '+code)));});
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8831');await page.getByRole('button',{name:'没有账号？注册',exact:true}).click();
 await page.locator('#auth-name').fill('注册验收同学');await page.locator('#auth-username').fill('campus_tester');await page.locator('#auth-number').fill('2026883001');await page.locator('#auth-class').fill('CSIT883-01');await page.locator('#auth-department').fill('计算机学院');await page.locator('#auth-email').fill('campus-test@example.com');
 await page.locator('#send-code').click();await page.locator('#demo-code').waitFor();const reg=await page.locator('#demo-code').textContent();await page.locator('#auth-code').fill(reg);await page.locator('#auth-password').fill('RegisterPass2026!');await page.locator('#auth-confirm').fill('RegisterPass2026!');
 await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/registration.png',fullPage:true});
 await page.getByRole('button',{name:'验证并注册',exact:true}).click();await page.locator('#password').fill('RegisterPass2026!');await page.getByRole('button',{name:'进入工作台'}).click();await page.locator('.sidebar').waitFor();
 await page.locator('#profile-button').click();await page.getByText('班级：CSIT883-01',{exact:true}).waitFor();await page.keyboard.press('Escape');
 // Keep an authenticated request context to verify reset revokes its session.
 const cookie=await page.context().cookies();const oldSession=await browser.newContext();await oldSession.addCookies(cookie);
 await page.locator('.topbar [data-action=logout]').click();
 // Log in separate context after logout so reset is the operation that revokes it.
 await oldSession.request.post('http://127.0.0.1:8831/api/login',{data:{id:'campus_tester',password:'RegisterPass2026!'}});
 await page.getByRole('button',{name:'忘记密码？',exact:true}).click();await page.locator('#auth-email').fill('campus-test@example.com');await page.locator('#send-code').click();await page.locator('#demo-code').waitFor();const reset=await page.locator('#demo-code').textContent();await page.locator('#auth-code').fill(reset);await page.locator('#auth-password').fill('ResetPassword2026!');await page.locator('#auth-confirm').fill('ResetPassword2026!');await page.screenshot({path:'artifacts/reset-password.png',fullPage:true});
 await page.getByRole('button',{name:'验证并重置密码',exact:true}).click();await page.locator('#login-form').waitFor();
 if((await oldSession.request.get('http://127.0.0.1:8831/api/bootstrap')).status()!==401)throw Error('Reset did not revoke previous session');
 await page.locator('#password').fill('RegisterPass2026!');await page.getByRole('button',{name:'进入工作台'}).click();await page.getByText('账号或密码不正确',{exact:true}).waitFor();await page.locator('#password').fill('ResetPassword2026!');await page.getByRole('button',{name:'进入工作台'}).click();await page.locator('.sidebar').waitFor();
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({passed:true,checks:['registration with code','profile persisted','email login','reset code','old password rejected','old session revoked','new password works'],errors:errors.length}));
 await oldSession.close();
} finally {if(browser)await browser.close();service.kill('SIGTERM');}
