'use strict';
const adminServices = (function () {
    'use strict';
    const root = '/admin-services';
    const applications = root + '/applications';
    const fields = {name: '姓名', student_no: '学号', class_name: '班级', department: '学院 / 院系', email: '邮箱'};
    const profileInputAttributes = {
        name: 'required minlength="2" maxlength="50"',
        student_no: 'required minlength="3" maxlength="30" title="3–30 位字母、数字或连字符"',
        class_name: 'maxlength="80"',
        department: 'maxlength="80"',
        email: 'type="email" maxlength="254"',
    };
    const colors = {pending: 'blue', needs_materials: 'orange', approved: 'green', rejected: 'red'};
    const eventLabels = {submitted: '提交申请', supplemented: '补交材料', needs_materials: '退回补充材料', approved: '审批通过', rejected: '审批未通过'};
    const visible = user => user.role === 'admin' || (user.role === 'user' && user.identity === '学生');
    const statusBadge = (catalog, status) => `<span class="badge ${colors[status] || ''}">${esc(catalog.statuses[status])}</span>`;
    const profile = (values, keys = Object.keys(fields)) => `<dl class="as-profile">${keys.map(key =>
        `<div><dt>${fields[key]}</dt><dd>${esc(values[key] || '未登记')}</dd></div>`).join('')}</dl>`;

    function profileInputs(values) {
        return `<div class="as-profile as-profile-inputs">${Object.entries(fields).map(([key, label]) =>
            `<div><label for="as-profile-${key}">${label}${['name', 'student_no'].includes(key) ? ' *' : ''}</label>
                <input id="as-profile-${key}" name="profile_${key}" value="${esc(values[key] || '')}" ${profileInputAttributes[key]}></div>`
        ).join('')}</div>`;
    }

    function accountComparison(detail) {
        const registered = detail.account_profile;
        if (!registered) return '';
        const item = detail.application;
        const changed = Object.keys(fields).filter(key => registered[key] !== item.profile[key]);
        return `<p class="small muted">提交账号：${esc(item.applicant_id)}</p>
            ${changed.length ? `<h3>账号登记资料</h3><p class="small muted">以下登记资料与本次申请填写的内容不同，请核对。</p>
                ${profile(registered, changed)}` : ''}`;
    }
    const fileHelp = limits => `支持 PDF、PNG、JPG；每次最多 ${limits.max_files} 份，每份不超过 ${limits.max_bytes / 1048576} MB。`;
    const sizeLabel = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
    const download = (id, material) => `/api${applications}/${encodeURIComponent(id)}/materials/${encodeURIComponent(material.id)}`;
    const detailPath = id => `${applications}/${encodeURIComponent(id)}`;
    const homeHref = '#admin-services';
    const isPortalHash = () => /^#admin-services(?:[/?]|$)/.test(location.hash);
    const href = (view = '', query = {}) => {
        const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value));
        return homeHref + (view ? '/' + view : '') + (params.size ? '?' + params : '');
    };
    const link = (url, text, style = 'btn secondary') => `<a class="${style}" href="${esc(url)}">${text}</a>`;
    const recordHref = (id, query) => href('detail/' + encodeURIComponent(id), query);
    const docDescriptions = {
        transcript: '用于升学、交换、实习或奖学金申请，提供课程成绩记录。',
        enrollment: '用于证明当前在校状态，常见于实习、资格审核和相关手续。',
    };

    function currentRoute(reviewer) {
        const [path, search = ''] = location.hash.slice(homeHref.length).split('?');
        const params = new URLSearchParams(search);
        const detail = path.match(/^\/detail\/(AS-[0-9A-F]{16})$/);
        const view = detail ? 'detail'
            : ['/records', '/guide'].includes(path) || (!reviewer && path === '/apply') ? path.slice(1) : 'home';
        const type = params.get('type') || '';
        const status = params.get('status');
        const number = params.get('q') || '';
        const page = params.get('page') || '';
        return {
            view, id: detail?.[1],
            query: {
                type: ['transcript', 'enrollment'].includes(type) ? type : '',
                status: status === 'all' || Object.prototype.hasOwnProperty.call(colors, status) ? status : '',
                q: /^[a-z0-9-]{1,24}$/i.test(number) ? number : '',
                page: /^[1-9][0-9]{0,8}$/.test(page) && page !== '1' ? page : '',
            },
        };
    }

    function view() {
        const reviewer = state.user.role === 'admin';
        const route = currentRoute(reviewer);
        const [title, subtitle] = {
            home: ['行政服务', reviewer ? '查看待办和最新申请，集中处理学生的成绩单与在校证明。' : '申请成绩单与在校证明，随时查看每一项办理进度。'],
            apply: ['新建申请', '核对资料、选择文件类型，再填写用途和支持材料。'],
            records: reviewer ? ['审批工作台', '筛选、查找并办理学生提交的申请。'] : ['我的申请', '按状态、类型或申请编号查找办理记录。'],
            guide: ['办理指南', '了解申请条件、材料要求和常见问题。'],
            detail: ['申请详情', '查看申请资料、附件和完整办理记录。'],
        }[route.view];
        const tabs = [['home', '服务首页'], ...(!reviewer ? [['apply', '新建申请']] : []),
            ['records', reviewer ? '审批工作台' : '我的申请'], ['guide', '办理指南']];
        return `<div class="page-head"><div><div class="eyebrow">CAMPUS OPERATIONS / ADMIN SERVICES</div>
            <h1 id="as-page-title" tabindex="-1">${title}</h1><p class="subtitle">${subtitle}</p></div></div>
            <nav class="as-nav" aria-label="行政服务导航">${tabs.map(([key, label]) => `<a href="${href(key === 'home' ? '' : key)}"
                ${(route.view === key || (route.view === 'detail' && key === 'records')) ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
            <div id="as-portal"><p class="muted" role="status">正在加载行政服务…</p></div>`;
    }

    function recordRows(items, catalog, query) {
        return `<ul class="as-results">${items.map(item => `<li><a class="as-row" data-as-id="${esc(item.id)}" href="${esc(recordHref(item.id, query))}">
            <span class="ticket-icon">${icon('ticket')}</span><span class="as-row-main">
                <strong>${esc(catalog.types[item.document_type])}</strong>
                <span class="small muted">${esc(item.id)}${catalog.mode === 'student' ? '' : ` · ${esc(item.name)} / ${esc(item.student_no)}`}</span>
                <span class="small muted">更新于 ${date(item.updated)}</span>
            </span>${statusBadge(catalog, item.status)}${icon('arrow')}
        </a></li>`).join('')}</ul>`;
    }

    function dashboard(catalog, data) {
        const reviewer = catalog.mode === 'reviewer';
        const statusIcons = {pending: 'clock', needs_materials: 'ticket', approved: 'check', rejected: 'box'};
        return `<section class="as-hero"><div><div class="eyebrow">STUDENT DOCUMENT SERVICES</div>
            <h2>${reviewer ? '学生申请处理中心' : '校园证明，一处办理'}</h2>
            <p>${reviewer ? '从待审批队列开始，核对申请资料并记录办理结果。' : '从提交到补交、审批，办理记录集中保存在这里。'}</p>
            <div class="as-actions">${reviewer ? link(href('records', {status: 'pending'}), '处理待审批 ' + icon('arrow'), 'btn')
                : link(href('apply'), icon('plus') + ' 新建申请', 'btn')}${link(href('guide'), '查看办理指南')}</div>
            </div><span class="as-hero-icon" aria-hidden="true">${icon('ticket')}</span></section>
            <div class="as-metrics" aria-label="申请状态概览">${Object.entries(catalog.statuses).map(([key, label]) =>
                `<a class="stat as-metric" href="${href('records', {status: key})}"><div class="stat-top">${esc(label)}
                <span class="stat-icon">${icon(statusIcons[key])}</span></div><div class="stat-value">${data.counts[key]}</div>
                <div class="stat-foot">查看记录 ${icon('arrow')}</div></a>`).join('')}</div>
            ${reviewer ? '' : `<div class="as-service-grid">${Object.entries(catalog.types).map(([key, title]) =>
                `<section class="card as-service"><div class="card-body"><span class="ticket-icon">${icon('ticket')}</span>
                <h2>${esc(title)}</h2><p class="subtitle">${esc(docDescriptions[key])}</p>
                ${link(href('apply', {type: key}), '申请' + esc(title) + ' ' + icon('arrow'))}</div></section>`).join('')}</div>`}
            <section class="card"><div class="card-head"><div><h2>最近办理</h2><p>按最后更新时间排列</p></div>
                ${link(href('records', {status: 'all'}), '查看全部 ' + icon('arrow'), 'linkbtn')}</div>
            <div class="card-body">${data.recent.length ? recordRows(data.recent, catalog, {status: 'all'})
                : '<p class="empty">暂无办理记录。</p>'}</div></section>`;
    }

    function steps() {
        return `<ol class="as-steps"><li><strong>提交申请</strong><p>确认个人资料和办理用途，按需附上材料。</p></li>
            <li><strong>等待审批</strong><p>管理员核对资料；收到补交要求后可继续提交材料。</p></li>
            <li><strong>查看结果</strong><p>打开申请详情，查看审批状态和说明。</p></li></ol>`;
    }

    function guide(catalog) {
        const reviewer = catalog.mode === 'reviewer';
        const questions = [
            ['成绩单和在校证明有什么区别？', '成绩单用于说明课程成绩；在校证明用于说明当前在校状态。请按接收方要求选择。'],
            ['账号自动带入的资料有误怎么办？', '学生可以在新建申请时直接修改或补填。更正仅用于当前申请，管理员审批时可以核对账号登记资料。'],
            ['材料有哪些要求？', fileHelp(catalog.materials) + ' 首次提交可按需附加材料；收到补交要求后，至少提交一份。'],
            ['收到补交要求后怎么操作？', '在「我的申请」选择「待补交材料」，打开详情阅读审批意见，再上传补充材料。提交后会重新进入审批。'],
            ['审批通过后能下载正式文件吗？', '本门户显示办理状态和审批意见。正式文件的签发和领取按学校规定办理。'],
        ];
        return `<div class="as-layout as-workspace"><section class="card"><div class="card-head"><div><h2>常见问题</h2><p>点击问题展开说明</p></div></div>
            <div class="card-body as-faq">${questions.map(([q, a]) => `<details><summary>${q}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>
            <aside class="card"><div class="card-head"><div><h2>办理流程</h2><p>从申请到结果</p></div></div><div class="card-body">${steps()}
                ${reviewer ? link(href('records'), '前往审批工作台', 'btn') : link(href('apply'), '开始申请', 'btn')}</div></aside></div>`;
    }

    function fileField(id, limits, required = false) {
        return `<label for="${id}">${required ? '补交材料 *' : '支持材料（选填）'}</label>
            <input id="${id}" name="materials" type="file" multiple ${required ? 'required' : ''}
                accept="${limits.extensions.map(ext => '.' + esc(ext)).join(',')}" aria-describedby="${id}-help">
            <p id="${id}-help" class="small muted as-hint">${fileHelp(limits)}</p>`;
    }

    function applyCard(catalog, type) {
        return `<section class="card" aria-labelledby="as-apply-title">
            <div class="card-head"><div><h2 id="as-apply-title">发起申请</h2><p>已从校园账号带入资料，可直接补填或修改，仅用于本次申请。</p></div>${icon('ticket')}</div>
            <div class="card-body">
                <form id="as-apply-form" class="as-form">
                    ${profileInputs(catalog.profile)}
                    <label for="as-type">文件类型 *</label>
                    <select id="as-type" name="document_type" required><option value="">请选择文件类型</option>
                        ${Object.entries(catalog.types).map(([key, title]) => `<option value="${esc(key)}" ${key === type ? 'selected' : ''}>${esc(title)}</option>`).join('')}
                    </select>
                    <p class="small muted as-hint" id="as-type-hint"></p>
                    <label for="as-purpose">申请用途 *</label>
                    <textarea id="as-purpose" name="purpose" maxlength="300" rows="3" required placeholder="例如：用于实习申请"></textarea>
                    ${fileField('as-files', catalog.materials)}
                    <p class="error as-error" role="alert"></p>
                    <button class="btn" type="submit">${icon('plus')} 提交申请</button>
                </form>
            </div></section>`;
    }

    function listCard(catalog, query) {
        const reviewer = catalog.mode === 'reviewer';
        const selected = query.status === 'all' ? '' : query.status || (reviewer ? 'pending' : '');
        return `<section class="card" aria-labelledby="as-list-title">
            <div class="card-head"><div><h2 id="as-list-title">申请记录</h2>
            <p>${reviewer ? '打开记录核对资料并办理。' : '打开记录查看审批说明及已提交的材料。'}</p></div>
            ${reviewer ? '' : link(href('apply'), icon('plus') + ' 新建申请', 'btn')}</div>
            <div class="card-body">
                <form class="as-controls" id="as-filters">
                    <div><label for="as-search">申请编号</label>
                    <input id="as-search" name="q" value="${esc(query.q)}" maxlength="24" placeholder="例如 AS-4D2…" spellcheck="false"></div>
                    <div><label for="as-status">申请状态</label>
                    <select id="as-status" name="status"><option value="">全部状态</option>
                        ${Object.entries(catalog.statuses).map(([key, title]) => `<option value="${esc(key)}" ${selected === key ? 'selected' : ''}>${esc(title)}</option>`).join('')}
                    </select></div>
                    <div><label for="as-filter-type">文件类型</label>
                    <select id="as-filter-type" name="type"><option value="">全部类型</option>
                        ${Object.entries(catalog.types).map(([key, title]) => `<option value="${esc(key)}" ${query.type === key ? 'selected' : ''}>${esc(title)}</option>`).join('')}
                    </select></div>
                    <button class="btn" type="submit">查询</button>
                    ${link(href('records', {status: 'all'}), '清空筛选')}
                    <button class="btn secondary" id="as-refresh" type="button">刷新列表</button>
                </form>
                <p id="as-filter-error" class="error as-error" role="alert"></p>
                <div id="as-results" aria-live="polite"></div>
            </div></section>`;
    }

    function readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({filename: file.name, data: reader.result.split(',')[1]});
            reader.onerror = reader.onabort = () => reject(new Error('读取材料失败，请重新选择文件'));
            reader.readAsDataURL(file);
        });
    }

    async function selectedFiles(input, limits) {
        const files = [...input.files];
        if (files.length > limits.max_files) throw new Error(`每次最多上传 ${limits.max_files} 份材料`);
        for (const file of files) {
            if (!file.size || file.size > limits.max_bytes) throw new Error(`请选择非空文件，每份不超过 ${limits.max_bytes / 1048576} MB`);
            if (!limits.extensions.includes(file.name.split('.').pop().toLowerCase())) throw new Error('材料仅支持 PDF、PNG、JPG');
        }
        return Promise.all(files.map(readFile));
    }

    function bindForm(form, submit) {
        if (!form) return;
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const button = event.submitter || form.querySelector('[type=submit]');
            if (button.disabled) return;
            const error = form.querySelector('.as-error');
            const owner = $('#as-portal');
            error.textContent = '';
            button.disabled = true;
            try {
                await submit(form.elements, () => owner?.isConnected && form.isConnected);
            } catch (err) {
                error.textContent = err.message;
            } finally {
                button.disabled = false;
            }
        });
    }

    function applicationDetails(panel, detail, catalog, reload) {
        const {application: item, events, materials} = detail;
        const reviewer = catalog.mode === 'reviewer';
        panel.innerHTML = `
            <div class="as-layout as-workspace"><div class="as-stack"><div class="detail-box as-detail">
            <h3>申请资料</h3>${profile(item.profile)}${reviewer ? accountComparison(detail) : ''}
            <h3>申请用途</h3><p class="as-note">${esc(item.purpose)}</p></div>
            <section class="detail-box as-detail"><h2>办理进度</h2>
                <ol class="timeline as-timeline">${events.map(event => `<li class="timeline-item">
                    <strong>${eventLabels[event.action] || esc(event.action)}</strong>
                    <div class="small muted">${date(event.created)}</div>
                    ${event.note ? `<p class="as-note">${esc(event.note)}</p>` : ''}
                    ${materials.filter(file => file.event_id === event.id).map(file => `<a class="as-download" href="${download(item.id, file)}">${esc(file.filename)} <span class="small muted">· ${sizeLabel(file.size)}</span></a>`).join('')}
                </li>`).join('')}</ol>
            </section></div><aside class="as-stack"><section class="detail-box as-detail"><h2>当前状态</h2>
                <div class="as-detail-status">${statusBadge(catalog, item.status)}</div>
                <p class="small muted">提交于 ${date(item.created)} · 更新于 ${date(item.updated)}</p>
                <p class="small muted">${esc({
                    pending: reviewer ? '核对申请资料及材料后，选择审批结果。' : '申请已进入审批队列，请稍后回来查看结果。',
                    needs_materials: reviewer ? '等待学生补交材料。' : '请阅读办理进度中的补交要求，然后上传材料。',
                    approved: '已通过审批，办理记录可继续查看。',
                    rejected: '本次申请未通过，具体原因见办理记录。',
                }[item.status])}</p>
            </section>
            ${reviewer && item.status === 'pending' ? `<section class="detail-box as-detail"><h2>审批操作</h2>
                <form class="as-form" id="as-decision">
                    <label for="as-decision-value">处理结果 *</label>
                    <select id="as-decision-value" name="decision" required><option value="">请选择处理结果</option>
                        <option value="approved">通过</option><option value="needs_materials">退回补充材料</option><option value="rejected">不通过</option>
                    </select>
                    <label for="as-decision-note">审批说明（退回或不通过时必填）</label>
                    <textarea id="as-decision-note" name="note" maxlength="500" rows="3"></textarea>
                    <p class="error as-error" role="alert"></p><button type="submit" class="btn">保存审批结果</button>
                </form></section>` : ''}
            ${!reviewer && item.status === 'needs_materials' ? `<section class="detail-box as-detail"><h2>补交材料</h2>
                <form class="as-form" id="as-supplement">
                    ${fileField('as-extra-files', catalog.materials, true)}
                    <label for="as-supplement-note">补充说明（选填）</label>
                    <textarea id="as-supplement-note" name="note" maxlength="500" rows="3"></textarea>
                    <p class="error as-error" role="alert"></p><button type="submit" class="btn">提交补充材料</button>
                </form></section>` : ''}</aside></div>`;
        const decisionForm = panel.querySelector('#as-decision');
        if (decisionForm) {
            decisionForm.elements.decision.onchange = () => {
                decisionForm.elements.note.required = ['rejected', 'needs_materials'].includes(decisionForm.elements.decision.value);
            };
        }
        const update = async (path, payload, message, active) => {
            if (!active()) return;
            await api(detailPath(item.id) + path, {version: item.version, ...payload});
            if (active()) {
                toast(message);
                reload();
            }
        };
        bindForm(decisionForm, (inputs, active) =>
            update('/decision', {decision: inputs.decision.value, note: inputs.note.value}, '已保存审批结果', active));
        bindForm(panel.querySelector('#as-supplement'), async (inputs, active) =>
            update('/materials', {note: inputs.note.value, materials: await selectedFiles(inputs.materials, catalog.materials)}, '已补交材料，申请重新进入审批', active));
    }

    function bindDetail(portal, route, catalog) {
        const id = route.id;
        portal.innerHTML = `<div class="as-detail-bar"><div><span class="eyebrow">APPLICATION NO.</span><div id="as-detail-id" class="mono">${esc(id)}</div></div>
            <div class="as-actions">${link(href('records', route.query), catalog.mode === 'reviewer' ? '返回审批工作台' : '返回我的申请')}
            <button type="button" class="btn secondary" id="as-copy-id">复制编号</button>
            <button type="button" class="btn secondary" id="as-refresh-detail">刷新详情</button></div></div>
            <div id="as-detail-body" aria-live="polite"></div>`;
        const panel = portal.querySelector('#as-detail-body');
        const refresh = portal.querySelector('#as-refresh-detail');
        portal.querySelector('#as-copy-id').onclick = async () => {
            try {
                await navigator.clipboard.writeText(id);
                toast('申请编号已复制');
            } catch {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(portal.querySelector('#as-detail-id'));
                selection.removeAllRanges();
                selection.addRange(range);
                toast('已选中编号，可手动复制');
            }
        };
        async function reload() {
            if (!panel.isConnected) return;
            refresh.disabled = true;
            panel.innerHTML = '<p class="muted">正在加载申请…</p>';
            try {
                const detail = await api(detailPath(id));
                if (!panel.isConnected) return;
                $('#as-page-title').textContent = catalog.types[detail.application.document_type] + '申请';
                applicationDetails(panel, detail, catalog, reload);
            } catch (err) {
                panel.textContent = err.message;
            } finally {
                refresh.disabled = false;
            }
        }
        refresh.onclick = reload;
        reload();
    }

    function bindRecords(portal, route, catalog) {
        portal.innerHTML = listCard(catalog, route.query);
        const results = portal.querySelector('#as-results');
        const form = portal.querySelector('#as-filters');
        const query = {...route.query, status: route.query.status || (catalog.mode === 'reviewer' ? 'pending' : 'all')};
        const pageNumber = Number(query.page || 1);
        let request = 0;

        async function loadList() {
            if (!portal.isConnected) return;
            const current = ++request;
            results.innerHTML = '<p class="muted">正在加载申请…</p>';
            try {
                const params = new URLSearchParams({...query, status: query.status === 'all' ? '' : query.status, page: pageNumber});
                const data = await api(applications + '?' + params);
                if (current !== request || !portal.isConnected) return;
                const lastPage = Math.max(1, Math.ceil(data.total / data.page_size));
                if (pageNumber > lastPage) {
                    const target = href('records', {...query, page: lastPage > 1 ? lastPage : ''});
                    // Use replace so an out-of-range page does not trap the Back button.
                    location.replace(target);
                    return;
                }
                results.innerHTML = data.applications.length ? `
                    ${recordRows(data.applications, catalog, query)}
                    <div class="flex between as-pagination"><span class="small muted">共 ${data.total} 条 · 第 ${pageNumber} / ${lastPage} 页</span>
                        <div class="flex">${pageNumber > 1 ? link(href('records', {...query, page: pageNumber > 2 ? pageNumber - 1 : ''}), '上一页') : ''}
                        ${pageNumber < lastPage ? link(href('records', {...query, page: pageNumber + 1}), '下一页') : ''}</div></div>`
                    : '<p class="empty">当前没有符合条件的申请。</p>';
            } catch (err) {
                if (current === request && portal.isConnected) results.textContent = err.message;
            }
        }

        form.onsubmit = event => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(form));
            const error = portal.querySelector('#as-filter-error');
            values.q = values.q.trim();
            if (!/^[a-z0-9-]{0,24}$/i.test(values.q)) {
                error.textContent = '申请编号只能包含字母、数字和连字符。';
                return;
            }
            error.textContent = '';
            const next = href('records', {...values, status: values.status || 'all'});
            if (location.hash === next) loadList();
            else location.hash = next;
        };
        portal.querySelector('#as-refresh').onclick = loadList;
        loadList();
    }

    function bindApply(portal, route, catalog) {
        portal.innerHTML = `<div class="as-layout as-workspace">${applyCard(catalog, route.query.type)}
            <aside class="card"><div class="card-head"><div><h2>办理流程</h2><p>提交前可先核对所需资料</p></div></div>
                <div class="card-body">${steps()}${link(href('guide'), '查看办理指南 ' + icon('arrow'))}</div></aside></div>`;
        const form = portal.querySelector('#as-apply-form');
        const typeHint = () => {
            portal.querySelector('#as-type-hint').textContent = docDescriptions[form.elements.document_type.value] || '';
        };
        form.elements.document_type.onchange = typeHint;
        typeHint();
        bindForm(form, async (inputs, active) => {
            const payload = {
                document_type: inputs.document_type.value,
                purpose: inputs.purpose.value,
                profile: Object.fromEntries(Object.keys(fields).map(key => [key, inputs[`profile_${key}`].value])),
                materials: await selectedFiles(inputs.materials, catalog.materials),
            };
            if (!active()) return;
            const result = await api(applications, payload);
            if (!active()) return;
            toast('申请已提交，可在「我的申请」查看进度');
            location.hash = recordHref(result.id);
        });
    }

    async function bind() {
        const portal = $('#as-portal');
        const route = currentRoute(state.user.role === 'admin');
        try {
            const catalog = await api(root + '/catalog');
            if (!portal.isConnected) return;
            if (route.view === 'home') {
                const data = await api(root + '/summary');
                if (portal.isConnected) portal.innerHTML = dashboard(catalog, data);
            } else if (route.view === 'guide') portal.innerHTML = guide(catalog);
            else if (route.view === 'apply') bindApply(portal, route, catalog);
            else if (route.view === 'records') bindRecords(portal, route, catalog);
            else bindDetail(portal, route, catalog);
        } catch (err) {
            if (portal.isConnected) {
                portal.innerHTML = '<p class="error" role="alert"></p><button type="button" class="btn secondary">重新加载</button>';
                portal.querySelector('p').textContent = err.message;
                portal.querySelector('button').onclick = bind;
            }
        }
    }

    return {visible, view, bind, homeHref, isPortalHash};
})();
