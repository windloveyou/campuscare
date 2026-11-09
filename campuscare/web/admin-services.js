'use strict';
const adminServices = (function () {
    'use strict';
    const root = '/admin-services';
    const applications = root + '/applications';
    const fields = {name: '姓名', student_no: '学号', class_name: '班级', department: '学院 / 院系', email: '邮箱'};
    const colors = {pending: 'blue', needs_materials: 'orange', approved: 'green', rejected: 'red'};
    const eventLabels = {submitted: '提交申请', supplemented: '补交材料', needs_materials: '退回补充材料', approved: '审批通过', rejected: '审批未通过'};
    const visible = user => user.role === 'admin' || (user.role === 'user' && user.identity === '学生');
    const statusBadge = (catalog, status) => `<span class="badge ${colors[status] || ''}">${esc(catalog.statuses[status])}</span>`;
    const profile = values => `<dl class="as-profile">${Object.entries(fields).map(([key, label]) =>
        `<div><dt>${label}</dt><dd>${esc(values[key] || '未登记')}</dd></div>`).join('')}</dl>`;
    const fileHelp = limits => `支持 PDF、PNG、JPG；每次最多 ${limits.max_files} 份，每份不超过 ${limits.max_bytes / 1048576} MB。`;
    const sizeLabel = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
    const download = (id, material) => `/api${applications}/${encodeURIComponent(id)}/materials/${encodeURIComponent(material.id)}`;
    const detailPath = id => `${applications}/${encodeURIComponent(id)}`;
    const closeButton = '<button type="button" class="close" data-action="close" aria-label="关闭">×</button>';

    function view() {
        const reviewer = state.user.role === 'admin';
        return head('行政服务', reviewer ? '处理学生提交的成绩单和在校证明申请。' : '在一个入口申请成绩单和在校证明，并查看办理进度。')
            + '<div id="as-portal"><p class="muted" role="status">正在加载行政服务…</p></div>';
    }

    function fileField(id, limits, required = false) {
        return `<label for="${id}">${required ? '补交材料 *' : '支持材料（选填）'}</label>
            <input id="${id}" name="materials" type="file" multiple ${required ? 'required' : ''}
                accept="${limits.extensions.map(ext => '.' + esc(ext)).join(',')}" aria-describedby="${id}-help">
            <p id="${id}-help" class="small muted as-hint">${fileHelp(limits)}</p>`;
    }

    function applyCard(catalog) {
        return `<section class="card" aria-labelledby="as-apply-title">
            <div class="card-head"><div><h2 id="as-apply-title">发起申请</h2><p>个人资料从校园账号自动填入。</p></div>${icon('ticket')}</div>
            <div class="card-body">
                ${profile(catalog.profile)}
                ${!catalog.can_apply ? '<p class="error">姓名或学号未登记，请联系管理员补全个人资料后再申请。</p>' : `
                <form id="as-apply-form" class="as-form">
                    <label for="as-type">文件类型 *</label>
                    <select id="as-type" name="document_type" required><option value="">请选择文件类型</option>
                        ${Object.entries(catalog.types).map(([key, title]) => `<option value="${esc(key)}">${esc(title)}</option>`).join('')}
                    </select>
                    <label for="as-purpose">申请用途 *</label>
                    <textarea id="as-purpose" name="purpose" maxlength="300" rows="3" required placeholder="例如：用于实习申请"></textarea>
                    ${fileField('as-files', catalog.materials)}
                    <p class="error as-error" role="alert"></p>
                    <button class="btn" type="submit">${icon('plus')} 提交申请</button>
                </form>`}
            </div></section>`;
    }

    function listCard(catalog) {
        const reviewer = catalog.mode === 'reviewer';
        return `<section class="card" aria-labelledby="as-list-title">
            <div class="card-head"><div><h2 id="as-list-title">${reviewer ? '申请审批' : '我的申请'}</h2>
            <p>${reviewer ? '按状态查找申请，打开详情核对资料。' : '查看审批进度、审批说明及已提交的材料。'}</p></div></div>
            <div class="card-body">
                <div class="as-controls">
                    <div><label for="as-status">申请状态</label>
                    <select id="as-status"><option value="">全部状态</option>
                        ${Object.entries(catalog.statuses).map(([key, title]) => `<option value="${esc(key)}" ${reviewer && key === 'pending' ? 'selected' : ''}>${esc(title)}</option>`).join('')}
                    </select></div>
                    <button class="btn secondary" id="as-refresh" type="button">刷新列表</button>
                </div>
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

    function applicationDetails(panel, detail, catalog, reload, loadList) {
        const {application: item, events, materials} = detail;
        const reviewer = catalog.mode === 'reviewer';
        panel.innerHTML = `
            <div class="detail-box as-detail"><div class="flex between">${statusBadge(catalog, item.status)}
            <span class="small muted">提交于 ${date(item.created)}</span></div>
            <h3>申请资料</h3>${profile(item.profile)}<h3>申请用途</h3><p class="as-note">${esc(item.purpose)}</p></div>
            <section class="detail-box as-detail"><h2>办理进度</h2>
                <ol class="timeline as-timeline">${events.map(event => `<li class="timeline-item">
                    <strong>${eventLabels[event.action] || esc(event.action)}</strong>
                    <div class="small muted">${date(event.created)}</div>
                    ${event.note ? `<p class="as-note">${esc(event.note)}</p>` : ''}
                    ${materials.filter(file => file.event_id === event.id).map(file => `<a class="as-download" href="${download(item.id, file)}">${esc(file.filename)} <span class="small muted">· ${sizeLabel(file.size)}</span></a>`).join('')}
                </li>`).join('')}</ol>
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
                </form></section>` : ''}`;
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
                loadList();
                reload();
            }
        };
        bindForm(decisionForm, (inputs, active) =>
            update('/decision', {decision: inputs.decision.value, note: inputs.note.value}, '已保存审批结果', active));
        bindForm(panel.querySelector('#as-supplement'), async (inputs, active) =>
            update('/materials', {note: inputs.note.value, materials: await selectedFiles(inputs.materials, catalog.materials)}, '已补交材料，申请重新进入审批', active));
    }

    function showDetails(id, catalog, loadList) {
        drawer(`<div class="drawer-head"><div><div class="eyebrow">APPLICATION DETAILS</div><h2 id="as-detail-title">申请详情</h2>
            <div class="small muted">${esc(id)}</div></div>${closeButton}</div>
            <button type="button" class="btn secondary" id="as-refresh-detail">刷新详情</button>
            <div id="as-detail-body" aria-live="polite"></div>`);
        const panel = $('#as-detail-body');
        const refresh = $('#as-refresh-detail');
        async function reload() {
            if (!panel.isConnected) return;
            refresh.disabled = true;
            panel.innerHTML = '<p class="muted">正在加载申请…</p>';
            try {
                const detail = await api(detailPath(id));
                if (!panel.isConnected) return;
                $('#as-detail-title').textContent = catalog.types[detail.application.document_type] + '申请';
                applicationDetails(panel, detail, catalog, reload, loadList);
            } catch (err) {
                panel.textContent = err.message;
            } finally {
                refresh.disabled = false;
            }
        }
        refresh.onclick = reload;
        reload();
    }

    async function bind() {
        const portal = $('#as-portal');
        let catalog;
        try {
            catalog = await api(root + '/catalog');
        } catch (err) {
            if (portal.isConnected) {
                portal.innerHTML = '<p class="error" role="alert"></p><button type="button" class="btn secondary">重新加载</button>';
                portal.querySelector('p').textContent = err.message;
                portal.querySelector('button').onclick = bind;
            }
            return;
        }
        if (!portal.isConnected) return;
        const student = catalog.mode === 'student';
        portal.innerHTML = `<div class="${student ? 'as-layout' : ''}">${student ? applyCard(catalog) : ''}${listCard(catalog)}</div>`;
        const results = portal.querySelector('#as-results');
        const status = portal.querySelector('#as-status');
        let pageNumber = 1, request = 0;

        async function loadList() {
            if (!portal.isConnected) return;
            const current = ++request;
            results.innerHTML = '<p class="muted">正在加载申请…</p>';
            try {
                const params = new URLSearchParams({status: status.value, page: pageNumber});
                const data = await api(applications + '?' + params);
                if (current !== request || !portal.isConnected) return;
                const lastPage = Math.max(1, Math.ceil(data.total / data.page_size));
                if (pageNumber > lastPage) {
                    pageNumber = lastPage;
                    return loadList();
                }
                results.innerHTML = data.applications.length ? `
                    <ul class="as-results">${data.applications.map(item => `<li><button type="button" class="as-row" data-as-id="${esc(item.id)}">
                        <span class="ticket-icon">${icon('ticket')}</span><span class="as-row-main">
                            <strong>${esc(catalog.types[item.document_type])}</strong>
                            <span class="small muted">${esc(item.id)}${student ? '' : ` · ${esc(item.name)} / ${esc(item.student_no)}`}</span>
                            <span class="small muted">更新于 ${date(item.updated)}</span>
                        </span>${statusBadge(catalog, item.status)}
                    </button></li>`).join('')}</ul>
                    <div class="flex between as-pagination"><span class="small muted">共 ${data.total} 条 · 第 ${pageNumber} / ${lastPage} 页</span>
                        <div class="flex"><button type="button" class="btn secondary" data-as-page="-1" ${pageNumber === 1 ? 'disabled' : ''}>上一页</button>
                        <button type="button" class="btn secondary" data-as-page="1" ${pageNumber === lastPage ? 'disabled' : ''}>下一页</button></div></div>`
                    : '<p class="empty">当前没有符合条件的申请。</p>';
            } catch (err) {
                if (current === request && portal.isConnected) results.textContent = err.message;
            }
        }

        results.onclick = event => {
            const row = event.target.closest('[data-as-id]');
            if (row) showDetails(row.dataset.asId, catalog, loadList);
            const step = event.target.closest('[data-as-page]');
            if (step) {
                pageNumber += Number(step.dataset.asPage);
                loadList();
            }
        };
        status.onchange = () => { pageNumber = 1; loadList(); };
        portal.querySelector('#as-refresh').onclick = loadList;
        const form = portal.querySelector('#as-apply-form');
        bindForm(form, async (inputs, active) => {
            const payload = {
                document_type: inputs.document_type.value,
                purpose: inputs.purpose.value,
                materials: await selectedFiles(inputs.materials, catalog.materials),
            };
            if (!active()) return;
            const result = await api(applications, payload);
            if (!active()) return;
            form.reset();
            status.value = '';
            pageNumber = 1;
            toast('申请已提交，可在「我的申请」查看进度');
            loadList();
            showDetails(result.id, catalog, loadList);
        });
        loadList();
    }

    return {visible, view, bind};
})();
