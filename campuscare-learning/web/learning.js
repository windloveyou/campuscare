'use strict';

/* ============================================================================
   CampusCare · 学习支持（Module 1 智能问答 / Module 2 学业风险）
   视觉与主系统 campuscare/web/app.js 一致：深色侧栏、eyebrow 标题、卡片布局。
   五类用户彼此独立：学生看自己，教师看名下学生，系统管理员只看后台。
   ========================================================================== */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const icons = {
    grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    spark: 'm12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8z',
    chart: 'M4 20V10 M11 20V4 M18 20v-8 M2 21h20',
    box: 'm12 3 9 5-9 5-9-5z M3 8v10l9 5 9-5V8 M12 13v10',
    bell: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 21h4',
    alert: 'M12 4 2 20h20z M12 10v5 M12 17.5h.01',
    check: 'm5 12 4 4 10-10',
    clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2',
    logout: 'M10 4H4v16h6 M9 12h12 m-4-4 4 4-4 4',
    arrow: 'M5 12h14 m-5-5 5 5-5 5',
    doc: 'M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6',
    download: 'M12 4v11 m-4-4 4 4 4-4 M5 20h14'
};
const icon = (name, size) => {
    const style = size ? ` style="width:${size}px;height:${size}px"` : '';
    return `<span class="icon"${style} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${icons[name] || icons.box}"/></svg></span>`;
};

const LEVEL = { high: 'red', watch: 'orange', low: 'green', unknown: 'plain' };
const levelBadge = (level, label) =>
    `<span class="badge ${LEVEL[level] || 'plain'}">${esc(label || level)}</span>`;
const PAGE_LABEL = { qa: 'QA', risk: 'RISK', admin: 'ADMIN' };

/* ------------------------------------------------------------------ 状态 */

let state = null;
let page = 'qa';
let messages = [];
let lastResult = null;
let history = [];
let suggestions = [];
let teacherData = null;
let selfData = null;
let adminData = null;
let busy = false;
let loading = { teacher: false, self: false, admin: false };
let loginRole = 'student';

/* ------------------------------------------------------------------ 请求 */

async function api(path, body) {
    const response = await fetch('/api' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': state?.user.csrf || ''
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    let data = {};
    try { data = await response.json(); } catch (e) { data = {}; }
    if (!response.ok) {
        if (response.status === 401 && path !== '/login') {
            state = null;
            messages = [];
            lastResult = null;
            closeModal();
            renderLogin();
        }
        throw new Error(data.error || '请求失败');
    }
    return data;
}

function toast(text) {
    const node = $('#toast');
    node.textContent = text;
    node.classList.add('show');
    clearTimeout(window.__toast);
    window.__toast = setTimeout(() => node.classList.remove('show'), 3200);
}

/* ------------------------------------------------------------------ 弹窗 */

function openModal(html) {
    $('#modal-root').innerHTML =
        `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true">${html}</section></div>`;
    document.body.style.overflow = 'hidden';
    $$('.modal-backdrop').forEach(node => {
        node.onclick = e => { if (e.target === node) closeModal(); };
    });
    $$('[data-close-modal]').forEach(b => b.onclick = closeModal);
}

function closeModal() {
    $('#modal-root').innerHTML = '';
    document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
});

/* ------------------------------------------------------------------ 登录 */

function renderLogin(error = '') {
    const groups = {
        student: ['s2023001', 's2023005'],
        teacher: ['teacher'],
        sysadmin: ['sysadmin']
    };
    const accounts = groups[loginRole] || groups.student;
    $('#app').innerHTML = `
    <div class="login">
      <section class="login-hero">
        <div>
          <div class="brand"><span class="brand-mark">↗</span> CampusCare</div>
          <div class="brand-sub">GLOBALCONNECT UNIVERSITY</div>
        </div>
        <div class="login-copy">
          <div class="eyebrow">LEARNING SUPPORT</div>
          <h1>把制度问清楚，<br>把风险早发现。</h1>
          <p>制度问题给出原文出处，检索不到时直接说明；学业风险按四项指标计分，
             达到阈值自动通知学生与导师。</p>
          <div class="flex" style="margin-top:30px;color:#b8cdab;font-size:11px">
            ${icon('doc', 16)} 7 份校级文件 ${icon('chart', 16)} 四项风险指标 ${icon('bell', 16)} 自动预警
          </div>
        </div>
        <div class="small" style="color:#688d7b">CSIT883 · Module 01 / Module 02</div>
      </section>
      <section class="login-form">
        <div class="eyebrow">WELCOME BACK</div>
        <h1>进入学习支持</h1>
        <p class="subtitle">选择演示身份，教师与系统管理员是两类账号。</p>
        <div class="role-pills">
          ${[['student', '学生'], ['teacher', '教师'], ['sysadmin', '系统管理员']].map(([k, n]) =>
            `<button class="role-pill ${k === loginRole ? 'active' : ''}" data-role="${k}">${n}</button>`).join('')}
        </div>
        <form id="login-form">
          <label for="account">用户名</label>
          <input id="account" value="${accounts[0]}" autocomplete="username" required>
          <label for="password">密码</label>
          <input id="password" type="password" value="Campus2026!" autocomplete="current-password" required>
          <p class="error" id="login-error">${esc(error)}</p>
          <button class="btn" type="submit">进入工作台 ${icon('arrow')}</button>
        </form>
        <div class="login-foot">
          演示密码：Campus2026!<br>
          演示账号：${accounts.map(id => `<button class="linkbtn" data-fill="${id}">${esc(id)}</button>`).join(' · ')}<br>
          学生成绩与行为记录为课程模拟数据。
        </div>
      </section>
    </div>`;

    $$('.role-pill').forEach(b => b.onclick = () => { loginRole = b.dataset.role; renderLogin(); });
    $$('[data-fill]').forEach(b => b.onclick = () => { $('#account').value = b.dataset.fill; });

    $('#login-form').onsubmit = async e => {
        e.preventDefault();
        const btn = e.submitter || $('#login-form button[type="submit"]');
        btn.disabled = true;
        try {
            await api('/login', { id: $('#account').value, password: $('#password').value });
            await refresh();
            await loadSuggestions();
            page = state.capabilities.qa ? 'qa' : 'admin';
            render();
        } catch (err) {
            $('#login-error').textContent = err.message;
            btn.disabled = false;
        }
    };
}

async function refresh() {
    state = await api('/bootstrap');
}

/* ------------------------------------------------------------------ 骨架 */

function head(title, subtitle, action = '') {
    return `<div class="page-head">
        <div><div class="eyebrow">LEARNING SUPPORT / ${PAGE_LABEL[page] || 'WORKSPACE'}</div>
        <h1>${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p></div>${action}</div>`;
}

function render() {
    if (!state) return renderLogin();
    const u = state.user;
    const caps = state.capabilities;
    const nav = [
        caps.qa ? ['qa', 'spark', '智能问答'] : null,
        caps.risk_advisor ? ['risk', 'chart', '学业风险'] : caps.risk_self ? ['risk', 'chart', '我的学业画像'] : null,
        caps.admin ? ['admin', 'grid', '后台管理'] : null
    ].filter(Boolean);

    const allowed = new Set(nav.map(n => n[0]));
    if (!allowed.has(page)) page = nav[0]?.[0] || 'qa';

    $('#app').innerHTML = `<div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">↗</span> CampusCare</div>
        <div class="brand-sub">LEARNING SUPPORT</div>
        <div class="campus-tag">GLOBALCONNECT UNIVERSITY<br><span style="color:#779a86">GCU · 示例校区</span></div>
        <div class="nav-label">WORKSPACE</div>
        <nav>${nav.map(([k, i, n]) => `<button class="navitem ${page === k ? 'active' : ''}" data-page="${k}">${icon(i)}${n}</button>`).join('')}</nav>
        <div class="sidebar-bottom">
          <div class="model-indicator">${icon('spark')} ${state.model.configured ? '生成模型已连接' : '检索抽取模式'}<br>
            <span style="color:#729485">${state.model.configured ? esc(state.model.name) : '证据不足时拒答，不编造条款'}</span></div>
          <div class="profile">
            <div class="avatar">${esc(u.name.slice(0, 1))}</div>
            <div style="flex:1"><div style="font-size:12px;color:#e5ede0">${esc(u.name)}</div>
              <div style="font-size:9px;margin-top:4px">${esc(u.identity)}</div></div>
            <button data-action="logout" aria-label="退出登录">${icon('logout')}</button>
          </div>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="breadcrumb">学习支持 <span>/</span>
            <span style="color:#4d6659">${nav.find(n => n[0] === page)?.[2] || ''}</span></div>
          <div class="top-actions">
            <span><span class="demo-dot"></span>示例校区 · 模拟数据</span>
            ${state.unread ? `<span class="badge orange">${state.unread} 条未读通知</span>` : ''}
            <span>${new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</span>
            <button data-action="logout" title="退出登录">${icon('logout')}</button>
          </div>
        </header>
        <div class="content" id="content"></div>
      </main>
    </div>`;

    const views = { qa: qaPage, risk: riskPage, admin: adminPage };
    $('#content').innerHTML = (views[page] || qaPage)() +
        `<footer class="footer"><span>CampusCare / GlobalConnect University</span>
         <span>COURSE PROTOTYPE · 成绩与行为记录均为合成数据</span></footer>`;

    $$('[data-page]').forEach(b => b.onclick = () => {
        page = b.dataset.page;
        render();
        window.scrollTo(0, 0);
    });
    $$('[data-action="logout"]').forEach(b => b.onclick = logout);

    if (page === 'qa') bindQA();
    if (page === 'risk') state.capabilities.risk_advisor ? bindRisk() : bindSelf();
    if (page === 'admin') bindAdmin();
}

async function logout() {
    try { await api('/logout', {}); } catch (e) { /* 会话可能已过期 */ }
    state = null;
    messages = [];
    lastResult = null;
    teacherData = selfData = adminData = null;
    closeModal();
    renderLogin();
}

/* ============================================================ Module 1 */

function qaPage() {
    return head('智能问答', '覆盖 7 份校级文件。回答标注原文章节，检索不到依据时直接说明；引用文件可查看原文并下载。') + `
    <div class="qa-layout">
      <section class="card chat">
        <div class="card-head">
          <div><h2>学业事务问答</h2><p>${state.model.configured ? 'RETRIEVAL-AUGMENTED · 本地模型' : 'EXTRACTIVE · 只引用原文句子'}</p></div>
          <span class="badge ${state.model.configured ? 'green' : 'blue'}">${state.model.configured ? '检索增强生成' : '检索抽取'}</span>
        </div>
        <div class="chat-log" id="chat-log">${chatLogHTML()}</div>
        <div class="compose">
          ${messages.length === 0 && suggestions.length ? `<div class="suggests">${suggestions.slice(0, 5).map(q =>
            `<button class="chip" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : ''}
          <form id="ask-form">
            <textarea id="ask-input" rows="1" maxlength="300" placeholder="例如：作业晚交几天会扣多少分？" required></textarea>
            <button class="btn" type="submit" ${busy ? 'disabled' : ''}>提问</button>
          </form>
        </div>
      </section>
      <aside class="card" id="evidence-card">${evidenceHeader()}${evidenceHTML()}</aside>
    </div>`;
}

function chatLogHTML() {
    if (!messages.length) {
        return `<div class="empty" style="padding-top:34px">输入问题开始。系统先在知识库中检索，再决定能否回答。<br>
          <span class="small">检索不到依据时不会推测；每个结论都能点开原文核对。</span></div>`;
    }
    return messages.map(m => m.role === 'user'
        ? `<div class="msg me"><div class="bubble">${esc(m.text)}</div><div class="avatar">我</div></div>`
        : botBubble(m.result)).join('');
}

function citeify(text) {
    return esc(text).replace(/\[(\d)\]/g, (all, n) =>
        `<button class="cite-ref" data-cite="${n}">[${n}]</button>`);
}

const LONG_ANSWER = 180;

function botBubble(r) {
    const denied = r.mode === 'guardrail';
    const text = String(r.answer || '');
    const paragraphs = text.split('\n\n');

    // 长答案先给前 180 字，其余折叠；展开后显示全文，不隐藏任何信息
    let used = 0;
    const preview = [];
    for (const part of paragraphs) {
        if (used >= LONG_ANSWER) break;
        const remain = LONG_ANSWER - used;
        if (part.length <= remain) {
            preview.push(part);
            used += part.length;
        } else {
            preview.push(part.slice(0, remain).replace(/[，。；、]$/, '') + '……');
            used = LONG_ANSWER;
            break;
        }
    }
    const long = text.length > used + 2;
    const render = list => list.map(p => `<p>${citeify(p)}</p>`).join('');

    const cites = (r.citations || []).map(c => `
      <div class="cite">
        <b>[${c.n}]</b>
        <div>
          <div class="src">《${esc(c.doc_title)}》· ${esc(c.section)}</div>
          <div class="snip">${esc(c.snippet)}</div>
        </div>
        <div class="ops">
          <button class="linkbtn" data-doc="${esc(c.doc_id)}" data-op="view">原文</button>
          <a class="linkbtn" href="/api/qa/source/${encodeURIComponent(c.doc_id)}?format=docx"
             download="${esc(c.doc_id)}.docx">Word</a>
        </div>
      </div>`).join('');

    const hints = denied && r.guardrail?.topics?.length
        ? `<div class="cites">${r.guardrail.topics.map(t => `
            <div class="cite"><b>?</b><div class="src">《${esc(t.doc_title)}》· ${esc(t.section)}</div>
              <span class="tiny muted">可能相关</span></div>`).join('')}</div>`
        : '';

    const meta = denied
        ? `相关度 ${(r.retrieval?.[0]?.score ?? 0).toFixed(1)}，低于证据门槛 ${state.knowledge.min_score}`
        : `${esc(r.mode_label)} · 置信度 ${r.confidence.toFixed(2)} · ${r.latency_ms} ms`;

    const body = long
        ? `<div class="answer-body" data-short>${render(preview)}</div>
           <div class="answer-body" data-full hidden>${render(paragraphs)}</div>`
        : `<div class="answer-body">${render(paragraphs)}</div>`;

    const followups = (r.followups || []).length
        ? `<div class="followups"><span class="label">还想了解：</span>
            ${r.followups.map(f => `<button class="chip" data-ask="${esc(f.question)}">${esc(f.question)}</button>`).join('')}
          </div>`
        : '';

    return `<div class="msg"><div class="avatar">AI</div>
      <div class="bubble answer ${denied ? 'declined' : ''}">
        ${body}
        ${long ? `<button class="expand-btn" data-expand>展开全文（共 ${text.length} 字）${icon('arrow', 14)}</button>` : ''}
        ${hints}
        ${cites ? `<div class="cites">${cites}</div>` : ''}
        ${followups}
        <div class="answer-foot">
          <span>${meta}</span>
          <span class="spacer"></span>
          ${r.answered ? '<button data-copy>复制答案</button>' : ''}
          ${r.log_id ? `<button data-fb="1" data-log="${r.log_id}">有帮助</button>
                        <button data-fb="0" data-log="${r.log_id}">没帮助</button>` : ''}
        </div>
      </div>
    </div>`;
}

function evidenceHeader() {
    return `<div class="card-head"><div><h2>回答依据</h2><p>WHY THIS ANSWER</p></div>
      ${lastResult
        ? `<span class="badge ${lastResult.mode === 'guardrail' ? 'orange' : 'green'}">${lastResult.mode === 'guardrail' ? '未作答' : '已作答'}</span>`
        : icon('doc')}</div>`;
}

function refreshEvidence() {
    const card = $('#evidence-card');
    if (card) card.innerHTML = evidenceHeader() + evidenceHTML();
}

function evidenceHTML() {
    if (!lastResult) {
        return `<div class="evidence">
          <div class="notice">提问后这里显示命中的文件、章节与相关度，以及实际参与作答的段落。</div>
          <p class="small muted" style="margin-top:16px">知识库 ${state.knowledge.docs} 份文件 / ${state.knowledge.chunks} 段，
            证据门槛 ${state.knowledge.min_score}。${state.model.configured ? '' : '当前为检索抽取模式，不生成原文之外的内容。'}</p>
        </div>`;
    }
    const scale = Math.max(8, lastResult.retrieval?.[0]?.score || 8);
    const rows = (lastResult.retrieval || []).map(hit => `
      <div class="item">
        <div class="flex between"><span>${esc(hit.doc_title)}</span>
          <span class="score">${hit.score.toFixed(1)}</span></div>
        <div class="tiny muted">${esc(hit.section)}</div>
        <div class="bar"><span style="width:${Math.min(100, hit.score / scale * 100)}%"></span></div>
      </div>`).join('');

    return `<div class="evidence">
        <div class="kv"><span>回答方式</span><span>${esc(lastResult.mode_label)}</span></div>
        <div class="kv"><span>引用段落</span><span>${lastResult.citations.length} 条</span></div>
        <div class="kv"><span>检索耗时</span><span>${lastResult.latency_ms} ms</span></div>
        <div class="section-title">检索结果</div>
        ${rows || '<div class="empty">没有命中任何段落</div>'}
        ${history.length ? `<div class="section-title">最近提问</div>
          ${history.slice(0, 4).map(h => `<div class="small" style="color:#5d6a63;padding:5px 0">
            ${h.answered ? '' : '<span class="badge orange">未作答</span> '}${esc(h.question)}</div>`).join('')}` : ''}
      </div>`;
}

function bindQA() {
    const log = $('#chat-log');
    log.scrollTop = log.scrollHeight;

    $$('[data-ask]').forEach(chip => chip.onclick = () => {
        $('#ask-input').value = chip.dataset.ask;
        $('#ask-form').dispatchEvent(new Event('submit', { cancelable: true }));
    });

    const form = $('#ask-form');
    const input = $('#ask-input');
    input.oninput = () => {
        input.style.height = 'auto';
        input.style.height = Math.min(120, input.scrollHeight) + 'px';
    };
    input.onkeydown = e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            form.dispatchEvent(new Event('submit', { cancelable: true }));
        }
    };

    form.onsubmit = async e => {
        e.preventDefault();
        const question = input.value.trim();
        if (!question || busy) return;
        busy = true;
        messages.push({ role: 'user', text: question });
        input.value = '';
        input.style.height = 'auto';
        log.innerHTML = chatLogHTML() + `<div class="msg"><div class="avatar">AI</div>
            <div class="bubble answer muted">正在检索知识库…</div></div>`;
        log.scrollTop = log.scrollHeight;
        form.querySelector('button').disabled = true;

        try {
            const result = await api('/qa/ask', { question });
            messages.push({ role: 'bot', result });
            lastResult = result;
        } catch (err) {
            messages.push({ role: 'bot', result: {
                answer: err.message, mode: 'guardrail', mode_label: '请求失败',
                confidence: 0, citations: [], retrieval: [], latency_ms: 0
            } });
        } finally {
            busy = false;
            log.innerHTML = chatLogHTML();
            refreshEvidence();
            bindQA();
            log.scrollTop = log.scrollHeight;
            if (messages.length <= 2) loadHistory();
        }
    };

    $$('[data-expand]').forEach(btn => btn.onclick = () => {
        const bubble = btn.closest('.bubble');
        const short = bubble?.querySelector('[data-short]');
        const full = bubble?.querySelector('[data-full]');
        if (!short || !full) return;
        const expanded = !full.hidden;
        full.hidden = expanded;
        short.hidden = !expanded;
        btn.innerHTML = expanded
            ? `展开全文${icon('arrow', 14)}`
            : `收起${icon('arrow', 14)}`;
    });

    $$('[data-cite]').forEach(btn => btn.onclick = () => {
        const card = btn.closest('.bubble')?.querySelectorAll('.cite')[Number(btn.dataset.cite) - 1];
        if (card) {
            card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            card.style.borderColor = '#8eaf94';
            setTimeout(() => card.style.borderColor = '', 1200);
        }
    });

    $$('[data-doc]').forEach(btn => btn.onclick = () =>
        openSource(btn.dataset.doc, btn.dataset.op));

    $$('[data-copy]').forEach(btn => btn.onclick = async () => {
        const body = btn.closest('.bubble')?.querySelector('.answer-body');
        if (!body) return;
        try {
            await navigator.clipboard.writeText(body.innerText.trim());
            toast('答案已复制');
        } catch (e) {
            toast('复制失败，请手动选择文本');
        }
    });

    $$('[data-fb]').forEach(btn => btn.onclick = async () => {
        const helpful = btn.dataset.fb === '1';
        try {
            await api('/qa/feedback', { log_id: Number(btn.dataset.log), helpful });
            toast('已记录反馈');
        } catch (err) { toast(err.message); }
    });
}

async function openSource(docId) {
    try {
        const doc = await api('/qa/source/' + encodeURIComponent(docId));
        openModal(`
          <div class="modal-head">
            <div><div class="eyebrow">SOURCE DOCUMENT</div>
              <h2>${esc(doc.title)}</h2>
              <p class="subtitle">${esc(doc.owner)} · v${esc(doc.version)} · 更新于 ${esc(doc.updated)}</p></div>
            <button class="close" data-close-modal aria-label="关闭">×</button>
          </div>
          <div class="modal-body">
            <div class="doc-body">${esc(doc.content)}</div>
            <div class="flex between" style="margin-top:16px">
              <span class="tiny muted">${esc(doc.filename)} · ${doc.chars} 字符</span>
              <div class="flex">
                <button class="btn secondary small" data-close-modal>关闭</button>
                <a class="btn small" href="/api/qa/source/${encodeURIComponent(doc.doc_id)}?format=docx"
                   download="${esc(doc.doc_id)}.docx">${icon('download', 15)} 下载 Word</a>
              </div>
            </div>
          </div>`);
    } catch (err) {
        toast(err.message);
    }
}

async function loadHistory() {
    try {
        const data = await api('/qa/history');
        history = data.items || [];
        refreshEvidence();
    } catch (e) { /* 历史不是关键路径 */ }
}

async function loadSuggestions() {
    try {
        const data = await api('/qa/suggestions');
        suggestions = data.items || [];
    } catch (e) { suggestions = []; }
}

/* ============================================================ Module 2 */

function riskPage() {
    return state.capabilities.risk_advisor ? teacherPage() : selfPage();
}

/* ---------------------------------------------------------- 教师：风险名单 */

function teacherPage() {
    if (!teacherData) {
        if (!loading.teacher) { loading.teacher = true; loadTeacher(); }
        return head('学业风险', '四项指标加权，每项依据可展开核对。') +
            `<div class="card"><div class="loading">正在计算…</div></div>`;
    }
    const d = teacherData;
    const c = d.counts;
    const threshold = state.alert?.threshold ?? 60;

    const cards = [
        ['所带学生', d.items.length, 'users', '按学业导师归属统计', ''],
        ['高风险', c.high, 'alert', `≥ ${threshold} 分，需学院干预`, c.high ? 'color:#b36355' : ''],
        ['关注', c.watch, 'clock', '35 – 59 分，导师面谈', c.watch ? 'color:#ae7835' : ''],
        ['平均风险分', d.average.toFixed(1), 'chart', '四项指标加权平均', '']
    ];

    const rows = d.items.map(item => `
      <tr data-student="${esc(item.student_id)}" style="cursor:pointer">
        <td>
          <strong>${esc(item.name)}</strong>
          <div class="small muted">${esc(item.student_id)}</div>
        </td>
        <td>
          <div class="score-cell"><b style="color:var(--${item.level === 'high' ? 'red' : item.level === 'watch' ? 'orange' : 'green'})">${item.score.toFixed(0)}</b>
            <div class="meter"><span class="${item.level}" style="width:${Math.min(100, item.score)}%"></span></div></div>
          <div class="small muted" style="margin-top:4px">${esc(item.driver || '—')}</div>
        </td>
        <td>${levelBadge(item.level, item.level_label)}</td>
        <td class="small muted">登录 ${item.activity.logins} · 提问 ${item.activity.qa_asks}</td>
        <td class="right"><button class="linkbtn" data-open="${esc(item.student_id)}">查看依据 ↗</button></td>
      </tr>`).join('');

    return head('学业风险', '先看依据，再看分数。教师只看到本人名下学生。',
        `<button class="btn secondary" data-action="scan" id="scan-btn">${icon('chart')} 重新扫描</button>`) + `
    <div class="stats">
      ${cards.map(([name, value, ico, foot, style]) => `<div class="stat">
        <div class="stat-top">${name}<span class="stat-icon">${icon(ico)}</span></div>
        <div class="stat-value" style="${style}">${value}</div>
        <div class="stat-foot">${esc(foot)}</div></div>`).join('')}
    </div>
    <div class="two-col">
      <section class="card fill">
        <div class="card-head"><div><h2>学生风险名单</h2><p>按风险分从高到低 · 点击查看每一项依据</p></div>
          <span class="badge plain">${d.items.length} 人</span></div>
        <div class="table-wrap scroll-y">
          <table>
            <thead><tr><th>学生</th><th>风险分 / 主导因素</th><th>等级</th><th>近 14 天参与</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>
      <section class="card fill">
        <div class="card-head"><div><h2>系统通知</h2><p>分数达到 ${threshold} 分时自动发送</p></div>
          <span class="badge plain">${(d.notifications || []).length} 条</span></div>
        <div class="card-body scroll-y" style="padding-top:0">
          <div class="note-list">${teacherNotesHTML()}</div>
        </div>
      </section>
    </div>
    <div class="notice" style="margin-top:20px">
      ${esc(d.disclaimer)} 分数 ≥ ${d.thresholds.high} 为高风险，≥ ${d.thresholds.watch} 为关注；
      达到 ${threshold} 分时系统自动向你与学生各发送一条通知，同一学生每周最多提醒一次。
    </div>`;
}

function teacherNotesHTML() {
    const notes = teacherData?.notifications || [];
    if (!notes.length) return '<div class="empty">暂无系统通知</div>';
    return notes.slice(0, 6).map(n => `
      <button class="note" data-note="${n.id}">
        <div>
          <div class="note-title">${esc(n.student_name || '')} · ${esc(n.title)}
            ${n.read_at ? '' : '<span class="badge orange">未读</span>'}</div>
          <div class="note-preview">${esc(n.body)}</div>
          <div class="note-meta">${esc(n.created)}</div>
        </div>
        <span class="linkbtn">展开</span>
      </button>`).join('');
}

async function loadTeacher() {
    try {
        const [overview, notes] = await Promise.all([
            api('/risk/overview'), api('/notifications')
        ]);
        teacherData = { ...overview, notifications: notes.items || [] };
    } catch (err) {
        toast(err.message);
        teacherData = null;
    } finally {
        loading.teacher = false;
    }
    if (page === 'risk') render();
}

function bindRisk() {
    const scan = $('#scan-btn');
    if (scan) scan.onclick = async () => {
        scan.disabled = true;
        try {
            const res = await api('/risk/scan', {});
            toast(`已重新计算 ${res.scanned} 名学生${res.alerts ? `，自动发送 ${res.alerts} 条预警` : ''}`);
            teacherData = null;
            await loadTeacher();
            await refresh();
        } catch (err) {
            toast(err.message);
            scan.disabled = false;
        }
    };
    $$('[data-student]').forEach(row => row.onclick = () => openStudent(row.dataset.student));
    $$('[data-open]').forEach(btn => btn.onclick = e => {
        e.stopPropagation();
        openStudent(btn.dataset.open);
    });
    $$('[data-note]').forEach(btn => btn.onclick = () => {
        const note = (teacherData?.notifications || []).find(n => String(n.id) === btn.dataset.note);
        if (note) openNote(note, loadTeacher);
    });
}

/* ---------------------------------------------------------- 学生：本人画像 */

function selfPage() {
    if (!selfData) {
        if (!loading.self) { loading.self = true; loadSelf(); }
        return head('我的学业画像', '只有你能看到这一页。') +
            `<div class="card"><div class="loading">正在计算…</div></div>`;
    }
    const d = selfData;
    const threshold = state.alert?.threshold ?? 60;
    const zone = d.level === 'high' ? 'red' : d.level === 'watch' ? 'orange' : 'green';

    const factors = d.factors.map(f => `
      <tr>
        <td>
          <div class="factor-name">${esc(f.name)}${f.sufficient ? '' : ' <span class="badge plain">数据不足</span>'}</div>
          <div class="factor-detail">${esc(f.detail)}</div>
        </td>
        <td class="small muted" style="white-space:nowrap">${(f.weight * 100).toFixed(0)}%</td>
        <td style="width:110px">
          <div class="factor-num"><b>${(f.risk * 100).toFixed(0)}</b></div>
          <div class="meter"><span class="${f.risk >= 0.6 ? 'high' : f.risk >= 0.3 ? 'watch' : 'low'}"
            style="width:${f.risk * 100}%"></span></div>
        </td>
        <td class="small" style="white-space:nowrap;text-align:right">${f.contribution} 分</td>
      </tr>`).join('');

    const notes = (d.notes || []).map(n => `
      <button class="note" data-note="${n.id}">
        <div>
          <div class="note-title">
            ${n.kind === 'auto' ? '<span class="badge red">系统自动</span>' : '<span class="badge blue">导师留言</span>'}
            ${esc(n.title)}
            ${n.read_at ? '' : '<span class="badge orange">未读</span>'}
          </div>
          <div class="note-preview">${esc(n.body)}</div>
          <div class="note-meta">${esc(n.created)}</div>
        </div>
        <span class="linkbtn">展开</span>
      </button>`).join('') || '<div class="empty">暂无通知</div>';

    return head('我的学业画像', '分数由行为记录算出，四项依据逐条列出；每项都可对照原始记录核对。') + `
    <div class="student-grid">
      <section class="card fill">
        <div class="card-head"><div><h2>当前状态</h2><p>ACADEMIC STANDING</p></div>
          ${levelBadge(d.level, d.level_label)}</div>
        <div class="score-card">
          <div class="score-line">
            <span class="score-num">${d.score.toFixed(0)}</span>
            <span class="score-unit">/ 100 风险分</span>
          </div>
          <div class="score-scale">
            <i class="zone-low"></i><i class="zone-watch"></i><i class="zone-high"></i>
            <b style="left:35%"></b><b style="left:60%"></b>
          </div>
          <div class="score-marks"><span>0</span><span>关注 35</span><span>高风险 ${threshold}</span><span>100</span></div>
          <div style="margin-top:16px">
            <div class="kv"><span>主导因素</span><span style="color:var(--${zone});font-weight:600">${esc(d.driver || '—')}</span></div>
            <div class="kv"><span>数据覆盖率</span><span>${(d.coverage * 100).toFixed(0)}%</span></div>
            <div class="kv"><span>学业导师</span><span>${esc(d.advisor_name || '—')}</span></div>
            <div class="kv"><span>近 14 天</span><span>登录 ${d.activity.logins} 次 · 提问 ${d.activity.qa_asks} 次</span></div>
          </div>
        </div>
      </section>
      <section class="card fill">
        <div class="card-head"><div><h2>四项依据</h2><p>合计 ${d.score.toFixed(1)} 分</p></div>
          <button class="linkbtn" data-action="method">评分口径 ↗</button></div>
        <table class="factor-table">
          <thead><tr><th>指标与记录</th><th>权重</th><th>风险</th><th style="text-align:right">贡献</th></tr></thead>
          <tbody>${factors}</tbody>
        </table>
      </section>
      <section class="card fill">
        <div class="card-head"><div><h2>下一步建议</h2><p>依据主导因素自动生成，可自行判断是否采纳</p></div></div>
        <div class="card-body">
          ${d.actions.length
            ? `<div class="advice">${d.actions.map((a, i) => `<div class="advice-item"><b>${i + 1}</b><span>${esc(a)}</span></div>`).join('')}</div>`
            : '<div class="empty">当前没有需要处理的事项</div>'}
          <div class="notice" style="margin-top:16px">
            预警不进入档案、不作为处分。若记录有误（病假、竞赛集训等），可带证明请导师复核。
          </div>
        </div>
      </section>
      <section class="card fill">
        <div class="card-head"><div><h2>通知</h2><p>系统自动预警与导师留言，点击查看全文</p></div>
          <span class="badge plain">${(d.notes || []).filter(n => !n.read_at).length} 条未读</span></div>
        <div class="card-body scroll-y" style="padding-top:0">
          <div class="note-list">${notes}</div>
        </div>
      </section>
    </div>`;
}

async function loadSelf() {
    try {
        selfData = await api('/risk/me');
    } catch (err) {
        toast(err.message);
        selfData = null;
    } finally {
        loading.self = false;
    }
    if (page === 'risk') render();
}

function bindSelf() {
    $$('[data-note]').forEach(btn => btn.onclick = () => {
        const note = (selfData?.notes || []).find(n => String(n.id) === btn.dataset.note);
        if (note) openNote(note, async () => {
            await loadSelf();
            await refresh();
        });
    });
    $$('[data-action="method"]').forEach(btn => btn.onclick = showMethodology);
}

/* ---------------------------------------------------------- 通知弹窗 */

function openNote(note, onRead) {
    const auto = note.kind === 'auto';
    openModal(`
      <div class="modal-head">
        <div>
          <div class="eyebrow">${auto ? 'SYSTEM ALERT' : 'MESSAGE FROM ADVISOR'}</div>
          <h2>${esc(note.title)}</h2>
          <p class="subtitle">${esc(note.created)}${note.student_name && state.capabilities.risk_advisor ? ' · ' + esc(note.student_name) : ''}
            ${note.score !== null && note.score !== undefined ? ` · 当时风险分 ${Number(note.score).toFixed(0)}` : ''}</p>
        </div>
        <button class="close" data-close-modal aria-label="关闭">×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;line-height:1.9">${esc(note.body)}</p>
        <div class="flex between" style="margin-top:22px">
          <span class="tiny muted">${auto ? '系统按阈值自动发送，同时发给学生与导师' : '学业导师发送'}</span>
          <div class="flex">
            <button class="btn secondary small" data-close-modal>关闭</button>
            ${note.read_at ? '<span class="badge green">已读</span>'
              : `<button class="btn small" data-mark-read>标为已读</button>`}
          </div>
        </div>
      </div>`);

    const mark = $('[data-mark-read]');
    if (mark) mark.onclick = async () => {
        try {
            await api('/notifications/read', { id: note.id });
            closeModal();
            toast('已标为已读');
            if (onRead) await onRead();
        } catch (err) { toast(err.message); }
    };
}

/* ---------------------------------------------------------- 教师：依据抽屉 */

async function openStudent(studentId) {
    $('#modal-root').innerHTML = `<div class="drawer-backdrop"><section class="drawer">
        <div class="drawer-head"><div><div class="eyebrow">STUDENT RISK DETAIL</div><h2>加载中…</h2></div>
        <button class="close" data-close-modal>×</button></div>
        <div class="loading">正在读取依据…</div></section></div>`;
    document.body.style.overflow = 'hidden';
    $$('.drawer-backdrop').forEach(node => {
        node.onclick = e => { if (e.target === node) closeModal(); };
    });
    $$('[data-close-modal]').forEach(b => b.onclick = closeModal);

    try {
        const data = await api('/risk/student/' + encodeURIComponent(studentId));
        $('.drawer').innerHTML = drawerHTML(data);
        $$('[data-close-modal]').forEach(b => b.onclick = closeModal);
        const btn = $('[data-action="notify"]');
        if (btn) btn.onclick = () => sendNotify(data, $('.drawer'), btn);
    } catch (err) {
        $('.drawer').innerHTML = `<div class="drawer-head"><h2>无法打开</h2>
            <button class="close" data-close-modal>×</button></div>
            <div class="notice warning">${esc(err.message)}</div>`;
        $$('[data-close-modal]').forEach(b => b.onclick = closeModal);
    }
}

function drawerHTML(d) {
    const factors = d.factors.map(f => `
      <tr>
        <td>
          <div class="factor-name">${esc(f.name)}${f.sufficient ? '' : ' <span class="badge plain">数据不足</span>'}</div>
          <div class="factor-detail">${esc(f.detail)}</div>
        </td>
        <td class="small muted" style="white-space:nowrap">${(f.weight * 100).toFixed(0)}%</td>
        <td style="width:96px">
          <div class="factor-num"><b>${(f.risk * 100).toFixed(0)}</b></div>
          <div class="meter"><span class="${f.risk >= 0.6 ? 'high' : f.risk >= 0.3 ? 'watch' : 'low'}"
            style="width:${f.risk * 100}%"></span></div>
        </td>
        <td class="small" style="text-align:right;white-space:nowrap">${f.contribution} 分</td>
      </tr>`).join('');

    const records = d.records.map(r => `
      <tr>
        <td>${esc(r.course_code)}</td>
        <td>${esc(r.assessment)}</td>
        <td class="small muted" style="white-space:nowrap">${esc(r.due)}</td>
        <td>${r.score === null ? '<span class="badge orange">未提交</span>' : `<strong>${r.score}</strong>`}</td>
        <td class="small">${r.submitted === null ? '—' : r.on_time ? '按时' : '<span style="color:var(--orange)">逾期</span>'}</td>
      </tr>`).join('');

    const notes = (d.notes || []).map(n => `
      <div class="note" style="cursor:default">
        <div>
          <div class="note-title">
            ${n.kind === 'auto' ? '<span class="badge red">系统自动</span>' : '<span class="badge blue">我的留言</span>'}
            ${esc(n.title)}</div>
          <div class="note-preview" style="-webkit-line-clamp:2">${esc(n.body)}</div>
          <div class="note-meta">${esc(n.created)} · ${n.read_at ? '学生已读' : '学生未读'}</div>
        </div>
      </div>`).join('') || '<div class="empty">还没有发送过通知</div>';

    const trendList = (d.history || []).map(h => h.score.toFixed(0));
    const trend = trendList.length
        ? trendList.join(' → ') + (trendList.length === 1 ? '（首次扫描）' : '')
        : '—';

    return `<div class="drawer-head">
        <div>
          <div class="eyebrow">STUDENT RISK DETAIL</div>
          <h2>${esc(d.name)}</h2>
          <p class="subtitle">${esc(d.student_id)} · ${esc(d.program)} · 导师 ${esc(d.advisor_name || '—')}</p>
        </div>
        <button class="close" data-close-modal>×</button>
      </div>

      <div class="detail-box">
        <div class="flex between">
          <div class="score-line">
            <span class="score-num" style="font-size:40px">${d.score.toFixed(0)}</span>
            <span class="score-unit">风险分</span>
          </div>
          <div style="text-align:right">
            ${levelBadge(d.level, d.level_label)}
            <div class="tiny muted" style="margin-top:6px">覆盖率 ${(d.coverage * 100).toFixed(0)}%</div>
          </div>
        </div>
        <div class="detail-label" style="margin-top:16px">主导因素</div>
        <p class="small">${esc(d.driver)}：${esc(d.driver_detail)}</p>
      </div>

      <div class="section-title">四项依据</div>
      <div class="detail-box" style="padding:0;overflow:hidden">
        <table class="factor-table">
          <thead><tr><th>指标与记录</th><th>权重</th><th>风险</th><th style="text-align:right">贡献</th></tr></thead>
          <tbody>${factors}</tbody>
        </table>
      </div>

      <div class="section-title">分数变化</div>
      <p class="small">${trend}</p>

      <div class="section-title">最近考核记录</div>
      <div class="detail-box" style="padding:0;overflow:hidden">
        <table>
          <thead><tr><th>课程</th><th>考核</th><th>截止</th><th>得分</th><th>提交</th></tr></thead>
          <tbody>${records}</tbody>
        </table>
      </div>

      <div class="section-title">已发送通知</div>
      <div class="note-list">${notes}</div>

      <div class="section-title">向学生留言</div>
      <div class="detail-box" style="margin-bottom:0">
        <textarea id="notify-text" rows="3" placeholder="选填。留空时将根据主导因素与建议自动生成内容。"></textarea>
        <div class="flex between" style="margin-top:12px">
          <span class="tiny muted">留言显示在学生的通知列表，与系统自动预警分开标记</span>
          <button class="btn" data-action="notify">发送</button>
        </div>
      </div>`;
}

async function sendNotify(d, drawer, btn) {
    const message = drawer.querySelector('#notify-text').value.trim();
    btn.disabled = true;
    try {
        const res = await api('/risk/notify', {
            student_id: d.student_id,
            ...(message ? { message } : {})
        });
        toast(res.generated ? '已按主导因素自动生成并发送' : '留言已发送');
        closeModal();
        teacherData = null;
        await loadTeacher();
        await refresh();
    } catch (err) {
        toast(err.message);
        btn.disabled = false;
    }
}

async function showMethodology() {
    try {
        const data = await api('/risk/methodology');
        openModal(`
          <div class="modal-head">
            <div><div class="eyebrow">METHODOLOGY</div><h2>评分口径</h2>
              <p class="subtitle">与学生端完全一致，依据 ${esc(data.policy_ref)}</p></div>
            <button class="close" data-close-modal>×</button>
          </div>
          <div class="modal-body">
            <div class="section-title" style="margin-top:0">指标与权重</div>
            <div class="detail-box" style="margin:0;padding:0;overflow:hidden">
              <table><thead><tr><th>指标</th><th>权重</th><th>窗口</th><th>判定规则</th></tr></thead>
              <tbody>${data.factors.map(f => `<tr>
                <td class="factor-name">${esc(f.name)}</td>
                <td class="small">${(f.weight * 100).toFixed(0)}%</td>
                <td class="small muted">${esc(f.window)}</td>
                <td class="small muted">${esc(f.rule)}</td></tr>`).join('')}</tbody></table>
            </div>
            <div class="section-title">等级与响应</div>
            <div class="detail-box" style="margin:0">
              ${data.levels.map(l => `<div class="kv"><span>${esc(l.label)} · ${esc(l.range)}</span>
                <span class="small muted">${esc(l.response)}</span></div>`).join('')}
            </div>
            <div class="section-title">自动预警</div>
            <div class="notice">${esc(data.auto_alert.rule)}</div>
            <div class="section-title">边界</div>
            <div class="notice">${esc(data.coverage_rule)}</div>
            ${data.limits.map(l => `<p class="small muted" style="margin-top:8px">· ${esc(l)}</p>`).join('')}
          </div>`);
    } catch (err) { toast(err.message); }
}

/* ============================================================ 后台管理 */

function adminPage() {
    if (!adminData?.knowledge) {
        if (!loading.admin) { loading.admin = true; loadAdmin(); }
        return head('后台管理', '系统管理员：知识库语料、系统日志、账号一览。') +
            `<div class="card"><div class="loading">正在读取…</div></div>`;
    }
    const { knowledge, gaps, logs, users } = adminData;

    const docs = knowledge.docs.map(d => `
      <tr>
        <td><strong>${esc(d.title)}</strong>
          <div class="mono muted" style="margin-top:5px">${esc(d.doc_id)} · v${esc(d.version)}</div></td>
        <td class="small muted">${esc(d.owner)}</td>
        <td class="small">${d.sections.length} 章 / ${d.chunks} 段</td>
        <td class="small muted">${d.chars} 字</td>
        <td class="small muted">${esc(d.updated)}</td>
      </tr>`).join('');

    const gapRows = gaps.items.map(g => `
      <tr>
        <td>${esc(g.question)}<div class="small muted">${esc(g.last_seen)}</div></td>
        <td>${g.times}</td>
        <td>${g.best_score === null ? '—' : g.best_score.toFixed(1)}</td>
      </tr>`).join('') || '<tr><td colspan="3" class="empty">暂无答不上的问题</td></tr>';

    const qaRows = logs.qa.map(l => `
      <tr>
        <td class="small muted">${esc(l.created)}</td>
        <td class="small">${esc(l.user_name || l.user_id || '—')}</td>
        <td>${esc(l.question)}</td>
        <td class="small">${l.answered ? '已回答' : '<span style="color:var(--orange)">拒答</span>'}</td>
        <td class="small muted mono">${l.confidence.toFixed(2)}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">暂无记录</td></tr>';

    const userRows = users.items.map(u => `
      <tr>
        <td><strong>${esc(u.name)}</strong><div class="mono muted" style="margin-top:5px">${esc(u.id)}</div></td>
        <td class="small">${esc(u.identity)}</td>
        <td class="small muted">${esc(u.program || '—')}</td>
        <td class="small muted">${esc(u.student_no || '—')}</td>
        <td class="small">${u.enabled ? '启用' : '停用'}</td>
      </tr>`).join('');

    return head('后台管理', '系统管理员只处理系统资产：语料、日志与账号，不接触学生成绩与预警。') + `
    <div class="stats">
      <div class="stat"><div class="stat-top">知识库文件<span class="stat-icon">${icon('doc')}</span></div>
        <div class="stat-value">${knowledge.docs.length}</div><div class="stat-foot">${knowledge.chars} 字 · ${knowledge.chunks} 段</div></div>
      <div class="stat"><div class="stat-top">作答率<span class="stat-icon">${icon('check')}</span></div>
        <div class="stat-value">${gaps.answer_rate === null ? '—' : (gaps.answer_rate * 100).toFixed(0) + '%'}</div>
        <div class="stat-foot">共 ${gaps.total} 次提问</div></div>
      <div class="stat"><div class="stat-top">拒答次数<span class="stat-icon">${icon('alert')}</span></div>
        <div class="stat-value" style="${gaps.missed ? 'color:var(--orange)' : ''}">${gaps.missed}</div>
        <div class="stat-foot">低于证据门槛 ${knowledge.min_score}</div></div>
      <div class="stat"><div class="stat-top">系统账号<span class="stat-icon">${icon('users')}</span></div>
        <div class="stat-value">${users.total}</div><div class="stat-foot">学生、教师与管理员</div></div>
    </div>

    <section class="card">
      <div class="card-head"><div><h2>知识库</h2><p>上传后立即重建索引，无需重启服务</p></div>
        <button class="btn secondary small" data-action="rebuild">重建索引</button></div>
      <div class="table-wrap scroll-y" style="max-height:330px">
        <table><thead><tr><th>文件</th><th>责任部门</th><th>章节 / 段落</th><th>字数</th><th>更新</th></tr></thead>
        <tbody>${docs}</tbody></table>
      </div>
      <div class="card-body" style="padding-top:18px;border-top:1px solid var(--line)">
        <div class="flex wrap" style="align-items:flex-end">
          <div style="flex:1;min-width:240px">
            <label for="corpus-file" style="margin-top:0">上传或覆盖语料</label>
            <input type="file" id="corpus-file" accept=".md,text/markdown">
          </div>
          <button class="btn" data-action="upload" id="upload-btn">${icon('doc')} 上传并重建索引</button>
        </div>
        <p class="small muted" style="margin-top:10px">
          文件名需为小写字母、数字、下划线或短横线并以 .md 结尾；正文需包含至少一个 ## 章节；同名文件将被覆盖。
        </p>
      </div>
    </section>

    <div class="two-col" style="margin-top:20px">
      <section class="card">
        <div class="card-head"><div><h2>问答日志</h2><p>最近 40 条 · 用于审计与知识库改进</p></div></div>
        <div class="table-wrap scroll-y" style="max-height:360px">
          <table><thead><tr><th>时间</th><th>用户</th><th>问题</th><th>结果</th><th>置信度</th></tr></thead>
          <tbody>${qaRows}</tbody></table>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><div><h2>知识缺口</h2><p>拒答问题按次数聚合</p></div>
          <span class="badge orange">${gaps.missed} 次</span></div>
        <div class="table-wrap scroll-y" style="max-height:360px">
          <table><thead><tr><th>问题</th><th>次数</th><th>最高相关度</th></tr></thead>
          <tbody>${gapRows}</tbody></table>
        </div>
      </section>
    </div>

    <section class="card" style="margin-top:20px">
      <div class="card-head"><div><h2>账号一览</h2><p>只读，账号管理属于后台管理模块</p></div>
        <span class="badge plain">${users.total} 个</span></div>
      <div class="table-wrap scroll-y" style="max-height:400px">
        <table><thead><tr><th>账号</th><th>身份</th><th>所属</th><th>学号 / 工号</th><th>状态</th></tr></thead>
        <tbody>${userRows}</tbody></table>
      </div>
      <div class="card-body" style="padding-top:14px"><div class="notice">${esc(users.note)}</div></div>
    </section>`;
}

async function loadAdmin() {
    try {
        const [knowledge, gaps, logs, users] = await Promise.all([
            api('/qa/knowledge'), api('/qa/gaps'), api('/admin/logs'), api('/admin/users')
        ]);
        adminData = { knowledge, gaps, logs, users };
    } catch (err) {
        toast(err.message);
        adminData = null;
    } finally {
        loading.admin = false;
    }
    if (page === 'admin') render();
}

function bindAdmin() {
    const rebuild = $('[data-action="rebuild"]');
    if (rebuild) rebuild.onclick = async () => {
        rebuild.disabled = true;
        try {
            const res = await api('/qa/rebuild', {});
            toast(`索引已重建：${res.docs} 份文件 / ${res.chunks} 段`);
            adminData = null;
            await loadAdmin();
        } catch (err) {
            toast(err.message);
            rebuild.disabled = false;
        }
    };

    const upload = $('#upload-btn');
    if (upload) upload.onclick = async () => {
        const file = $('#corpus-file').files[0];
        if (!file) return toast('请选择 .md 文件');
        upload.disabled = true;
        try {
            const content = await file.text();
            const res = await api('/qa/corpus', { filename: file.name.toLowerCase(), content });
            toast(`${res.replaced ? '已覆盖' : '已新增'} ${res.filename}，当前 ${res.docs} 份文件`);
            adminData = null;
            await loadAdmin();
            await refresh();
        } catch (err) {
            toast(err.message);
            upload.disabled = false;
        }
    };
}

/* ------------------------------------------------------------------ 启动 */

(async function start() {
    try {
        await refresh();
    } catch (e) {
        return renderLogin();
    }
    await loadSuggestions();
    page = state.capabilities.qa ? 'qa' : 'admin';
    render();
})();
