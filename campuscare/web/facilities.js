'use strict';

// Facility views and their transient state. The host supplies the current session
// and shared UI primitives; facility interactions stay inside this module.
const facilities = (() => {
    const emptyDraft = () => ({asset_id: '', description: '', title: '', priority: 'medium', images: []});
    const emptyFilters = () => ({search: '', status: '', location: ''});
    let selectedLocation = 'A', selectedRoom = '', filters = emptyFilters(),
        draft = emptyDraft(), analysis = null, forecast = null;
    const newButton = () => state.user.role !== 'technician' ? `<button class="btn" data-action="new">${icon('plus')} 发起报修</button>` : '';
    function reset() {
        selectedLocation = 'A';
        selectedRoom = '';
        filters = emptyFilters();
        draft = emptyDraft();
        analysis = null;
        forecast = null;
    }

    function mapSVG() {
        const trees = [[60,65],[180,70],[340,65],[510,80],[625,115],[75,200],[180,210],[350,215],[565,208],[80,355],[220,363],[410,365],[630,355]];
        const buildings = [['A',138,95,100,68,'明理楼 A'],['B',365,95,110,68,'知行楼 B'],['D1',140,265,100,70,'栖园 D1'],['D2',365,265,110,70,'栖园 D2'],['SERVICE',555,280,79,48,'维修中心']];
        const active = a => a && !['normal','unknown','retired'].includes(a.status);
        const treeMarkup = trees.map(([x,y],i) => `<circle cx="${x}" cy="${y}" r="${i%3+9}" fill="#c9d8b8"/><circle cx="${x-2}" cy="${y-2}" r="3" fill="#ffffff24"/>`).join('');
        const buildingMarkup = buildings.map(([id,x,y,w,h,name]) => {
            const assets = state.assets.filter(a => a.location_id === id);
            const count = assets.filter(active).length;
            const color = id.startsWith('D') ? '#e4d9c7' : '#d5dfd2';
            const roof = id.startsWith('D') ? '#f0e8da' : '#e5ece0';
            const windows = [0,1,2,3].map(i => `<rect x="${x+15+i*(w-28)/4}" y="${y+10}" width="8" height="5" rx="1" fill="#b9cbb6"/>`).join('');
            const counter = count ? `<circle cx="${x+w-2}" cy="${y+2}" r="10" fill="#cb934e" stroke="#fff" stroke-width="2"/><text x="${x+w-2}" y="${y+5}" text-anchor="middle" fill="#fff" font-size="9">${count}</text>` : '';
            return `<g class="building" data-location="${id}" tabindex="0" role="button" aria-label="${name}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${color}" stroke="#b7c6b3" filter="url(#mapshadow)"/><rect x="${x+7}" y="${y+6}" width="${w-14}" height="${h-17}" rx="4" fill="${roof}" stroke="#c7d1bf"/>${windows}<text x="${x+w/2}" y="${y+h/2+5}" text-anchor="middle" fill="#586b52" font-size="12" font-weight="500">${name}</text><text x="${x+w/2}" y="${y+h+18}" text-anchor="middle" fill="#8b9880" font-size="9">${assets.length} 项设施</text>${counter}</g>`;
        }).join('');
        const roadMarkup = [['R1',336,238,'梧桐大道'],['R2',110,195,'明理路'],['R3',520,268,'栖园路']].map(([id,x,y,name]) => `<g data-location="${id}" class="building" tabindex="0" role="button" aria-label="${name}"><rect x="${x-35}" y="${y-13}" width="70" height="20" rx="4" fill="#fafbf5"/><text x="${x}" y="${y}" text-anchor="middle" fill="#8b987e" font-size="10">${name}</text></g>`).join('');
        const lamps = [175,225,425,475,580,630].map((x,i) => {
            const id = 'R1-LIGHT-' + String(i+1).padStart(2,'0');
            const asset = state.assets.find(a => a.id === id);
            const color = active(asset) ? '#cb934e' : asset?.status === 'normal' ? '#83a682' : '#9ba49b';
            return `<g class="building" data-asset="${id}" tabindex="0" role="button" aria-label="梧桐大道第${i+1}盏路灯"><circle cx="${x}" cy="252" r="9" fill="transparent"/><circle cx="${x}" cy="252" r="4" fill="${color}" stroke="#fff" stroke-width="1.5"/></g>`;
        }).join('');
        return `<div class="map-wrap"><div class="map-overlay">GCU 校园示意图 · 非真实地理坐标</div><div class="map-compass">N<br>↑</div>
        <svg class="map-svg" viewBox="0 0 700 400" role="img" aria-label="校园地图，点击建筑或道路查看设施">
        <defs><pattern id="grass" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".5" fill="#cbd4bb"/></pattern><filter id="mapshadow"><feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#66816b" flood-opacity=".13"/></filter></defs>
        <rect width="700" height="400" fill="#edf0e3"/><rect width="700" height="400" fill="url(#grass)"/>
        <path d="M0 235H700 M110 0V400 M520 0V400" stroke="#d9decf" stroke-width="32"/><path d="M0 235H700 M110 0V400 M520 0V400" stroke="#fafbf5" stroke-width="25"/><path d="M0 235H700 M110 0V400 M520 0V400" stroke="#dbe1d2" stroke-width="1" stroke-dasharray="6 6"/>
        <path d="M240 128H365 M290 130V235 M240 300H365 M300 300V235 M475 300H555" stroke="#f9faf3" stroke-width="12"/><rect x="260" y="80" width="72" height="90" rx="30" fill="#dfe8d1"/><ellipse cx="302" cy="305" rx="30" ry="32" fill="#d9e7d6"/><path d="M288 283Q318 284 315 310Q300 327 286 312Z" fill="#c7dcd2"/>
        ${treeMarkup}${buildingMarkup}${roadMarkup}${lamps}
        <rect x="82" y="374" width="58" height="20" rx="3" fill="#e4e9dc"/><text x="110" y="388" text-anchor="middle" fill="#89967c" font-size="9">校园南门</text><text x="580" y="385" fill="#a1aa93" font-size="8">SCHEMATIC · NOT TO SCALE</text></svg></div>`;
    }

    function facilityOverview() {
        const a = state.assets,
            t = state.tickets,
            open = t.filter(t => !['closed', 'cancelled'].includes(t.status)),
            pending = t.filter(t => t.status === 'pending'),
            review = t.filter(t => t.status === 'review'),
            normal = a.filter(a => a.status === 'normal');
        const cards = [
            ['设施档案', a.length, 'box', '当前角色可见设施'],
            ['待处理工单', open.length, 'ticket', '包括待确认、维修与验收'],
            ['待确认 / 派单', pending.length, 'clock', '需要管理人员跟进'],
            ['等待验收', review.length, 'check', '处理完成后确认恢复']
        ];
        return head(state.user.role === 'admin' ? '校园维护，一目了然。' : state.user.role === 'technician' ? '今天的维修工作台' : '你好，一起照顾校园。', '从发现问题到完成修复，每一条记录都有迹可循。', newButton()) + `<div class="stats">${cards.map(([n,v,i,f])=>`<div class="stat"><div class="stat-top">${n}<span class="stat-icon">${icon(i)}</span></div><div class="stat-value">${v}<span style="font-size:11px;color:#9ca49a;margin-left:7px">项</span></div><div class="stat-foot">${f}</div></div>`).join('')}</div><div class="dashboard-grid"><section class="card"><div class="card-head"><div><h2>校园设施分布</h2><p>CAMPUS AT A GLANCE · 点击区域查看详情</p></div><button class="linkbtn" data-page="map">展开地图 ↗</button></div>${mapSVG()}<div class="map-legend"><span><i class="dot"></i>设施已登记</span><span><i class="dot orange"></i>有待处理报修</span><span class="muted">2 栋教学楼 · 2 栋宿舍 · 3 条道路</span></div></section><section class="card"><div class="card-head"><div><h2>待办与最新动态</h2><p>需要关注的每一个小问题</p></div><span class="badge">${open.length} 条</span></div><div class="card-body">${open.slice(0,4).map(ticketRow).join('')||'<div class="empty">所有工单已处理，暂无待办。</div>'}<button class="btn secondary" style="width:100%;margin-top:10px" data-page="tickets">查看全部工单 ${icon('arrow')}</button></div></section></div><div class="bottom-grid"><section class="card"><div class="card-head"><div><h2>设施状态概览</h2><p>依据报修、维修与验收记录更新</p></div>${icon('box')}</div><div class="card-body"><div class="flex between"><span class="small muted">记录正常 / 可见设施</span><span style="font-size:23px">${normal.length}<span class="small muted"> / ${a.length}</span></span></div><div class="equipment-progress"><span style="background:#83ac8d;flex:${normal.length}"></span><span style="background:#d3ac69;flex:${a.length-normal.length}"></span></div><div class="notice">没有报修 ≠ 实时正常。设备详情保留最近确认时间和状态依据。</div></div></section><section class="card"><div class="card-head"><div><h2>各区域报修记录</h2><p>含课程模拟历史 · 按当前角色可见范围统计</p></div>${icon('chart')}</div><div class="card-body bars">${state.locations.filter(l=>['A','B','D1','D2'].includes(l.id)).map(l=>{let n=t.filter(x=>state.assets.find(a=>a.id===x.asset_id)?.location_id===l.id).length;return `<div class="bar-row"><span>${esc(l.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100,n/Math.max(1,t.length)*180)}%"></div></div><span class="muted">${n}</span></div>`;}).join('')}</div></section></div>`;
    }

    function ticketRow(t) {
        return `<div class="ticket-row" data-ticket="${t.id}" tabindex="0" role="button"><div class="ticket-icon">${icon('tool')}</div><div style="flex:1;min-width:0"><div class="ticket-title">${esc(t.title)}</div><div class="ticket-meta">${esc(t.location_name)} · ${esc(t.asset_id)}</div><div class="flex between" style="margin-top:4px">${badge(t.status)}<span class="tiny muted">${date(t.updated)}</span></div></div></div>`;
    }

    function mapPage() {
        let loc = state.locations.find(l => l.id === selectedLocation) || state.locations[0],
            assets = state.assets.filter(a => a.location_id === loc.id),
            rooms = [...new Set(assets.map(a => a.room))];
        return head('校园地图', '从楼栋到房间，再到一台具体设备。地图为课程设计示意。', newButton()) + `<div class="two-col"><section class="card"><div class="card-head"><h2>GCU · 示例校区</h2><button class="linkbtn" data-action="geolocate">${icon('pin')} 获取手机位置</button></div>${mapSVG()}<div class="card-body"><div id="geo-result" class="notice">本校区为虚拟场景。真实 GPS 只展示浏览器返回的坐标，不自动匹配虚构校区。</div><div class="map-locations">${state.locations.map(l=>`<button class="tag-button ${l.id===loc.id?'active':''}" data-location="${l.id}">${esc(l.name)}</button>`).join('')}</div><label for="location-query">描述地点 / 设备编号</label><div class="flex"><input id="location-query" placeholder="如：A201、D1公共洗衣机、R1-LIGHT-03"><button class="btn secondary" data-action="locate-text">查找</button></div><div id="location-results" class="small muted" style="margin-top:10px">台账关键词匹配，不根据照片猜测真实位置。</div></div></section><section class="card building-detail"><div class="eyebrow">LOCATION DETAILS</div><h2>${esc(loc.name)}</h2><p class="subtitle">${esc(loc.description)} · ${assets.length} 项可见设施</p><div class="room-grid">${rooms.map(r=>`<button class="room ${r===selectedRoom?'active':''}" data-room="${r}">${r==='PUBLIC'?'公共区域':r==='OUTDOOR'?'室外设施':esc(r)}<div class="tiny muted" style="margin-top:7px">${assets.filter(a=>a.room===r).length} 项设施</div></button>`).join('')}</div><div style="max-height:440px;overflow:auto">${assets.filter(a=>!selectedRoom||a.room===selectedRoom).map(a=>`<div class="ticket-row" data-asset="${a.id}" tabindex="0" role="button"><div class="ticket-icon">${icon('box')}</div><div style="flex:1"><div class="ticket-title">${esc(a.name)}</div><div class="ticket-meta">${esc(a.id)}</div></div>${badge(a.status)}</div>`).join('')||'<div class="empty">此处暂无设备</div>'}</div></section></div>`;
    }

    function assetsPage() {
        return head('设施台账', '每项设施都有独立身份、位置和维护记录。', newButton()) + `<div class="toolbar"><input id="filter-search" placeholder="搜索设备名称、编号或房间" value="${esc(filters.search)}"><select id="filter-location"><option value="">全部区域</option>${state.locations.map(l=>`<option value="${l.id}" ${filters.location===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select><select id="filter-status"><option value="">全部状态</option>${['normal','pending','assigned','in_progress','waiting_parts','review','unknown'].map(s=>`<option value="${s}" ${filters.status===s?'selected':''}>${labels[s]}</option>`).join('')}</select></div><div class="card table-wrap"><table><thead><tr><th>设施 / 编号</th><th>所在位置</th><th>记录状态</th><th>最后确认</th><th>操作</th></tr></thead><tbody id="assets-body">${assetRows()}</tbody></table></div>`;
    }

    function assetRows() {
        let rows = state.assets.filter(a => (!filters.location || a.location_id === filters.location) && (!filters.status || a.status === filters.status) && [a.name, a.id, a.room].join(' ').toLowerCase().includes(filters.search.toLowerCase()));
        return rows.map(a => `<tr><td><strong>${esc(a.name)}</strong><div class="mono muted" style="margin-top:5px">${esc(a.id)}</div></td><td>${esc(a.location_name)}<div class="small muted">${esc(a.room)} · ${esc(a.position)}</div></td><td>${badge(a.status)}</td><td class="small muted">${date(a.last_checked)}</td><td><button class="linkbtn" data-asset="${a.id}">查看档案 ↗</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">没有匹配的设施</td></tr>';
    }

    function ticketsPage() {
        return head(state.user.role === 'technician' ? '我的维修任务' : '工单中心', state.user.role === 'user' ? '查看自己的报修及关注的工单，跟踪每次处理进展。' : '从确认到验收，完整记录每一次维护。', newButton()) + `<div class="toolbar"><input id="filter-search" placeholder="搜索标题、设施或工单编号" value="${esc(filters.search)}"><select id="filter-status"><option value="">全部状态</option>${Object.keys(labels).slice(0,7).map(s=>`<option value="${s}" ${filters.status===s?'selected':''}>${labels[s]}</option>`).join('')}</select><span class="small muted">仅展示当前账号有权查看的记录</span></div><div class="card table-wrap"><table><thead><tr><th>工单</th><th>设施 / 位置</th><th>状态</th><th>优先级</th><th>维修人员</th><th>更新时间</th></tr></thead><tbody id="tickets-body">${ticketRows()}</tbody></table></div>`;
    }

    function ticketRows() {
        return state.tickets.filter(t => (!filters.status || t.status === filters.status) && [t.title, t.id, t.asset_id].join(' ').toLowerCase().includes(filters.search.toLowerCase())).map(t => `<tr><td><button class="linkbtn" style="font-size:12px;text-align:left" data-ticket="${t.id}">${esc(t.title)}</button><div class="mono muted" style="margin-top:5px">${t.id}${t.synthetic?' · 模拟':''}</div></td><td>${esc(t.location_name)}<div class="small muted">${esc(t.asset_id)}</div></td><td>${badge(t.status)}</td><td>${pri(t.priority)}</td><td>${esc(t.assignee_name||'未分配')}</td><td class="small muted">${date(t.updated)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">暂无匹配工单</td></tr>';
    }

    function reportPage() {
        let asset = state.assets.find(a => a.id === draft.asset_id);
        return head('把问题告诉我们。', '选好位置，描述现象。我们会帮你把报修整理清楚。') + `<div class="steps"><span><b>1</b> 确认设施</span><span>—</span><span><b>2</b> 描述与辅助整理</span><span>—</span><span><b>3</b> 确认提交</span></div><div class="two-col"><form id="report-form" class="card form-card"><h2>报修信息</h2><label for="report-location">所在区域</label><select id="report-location"><option value="">请选择区域</option>${state.locations.map(l=>`<option value="${l.id}" ${asset?.location_id===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select><label for="report-asset">具体设施 *</label><select id="report-asset" required><option value="">请选择设施 / 扫码后自动填入</option>${(asset?state.assets.filter(a=>a.location_id===asset.location_id):[]).map(a=>`<option value="${a.id}" ${a.id===draft.asset_id?'selected':''}>${esc(a.id)} · ${esc(a.name)}</option>`).join('')}</select><div id="asset-hint" class="tiny muted" style="margin-top:9px">${asset?esc(asset.location_name+' / '+asset.room+' / '+asset.position):'位置以设备台账和你的确认结果为准。'}</div><label for="report-description">发生了什么？ *</label><textarea id="report-description" maxlength="3000" required placeholder="例如：A201的空调开启后一直滴水，大约从今天上午开始。">${esc(draft.description)}</textarea><label class="upload" for="report-photos">${icon('image')}<br><span style="display:block;margin-top:8px">添加照片 · 最多 3 张</span><span class="tiny">JPEG / PNG · 在浏览器压缩后保存在本地</span><input type="file" accept="image/jpeg,image/png" multiple id="report-photos"></label><div class="previews" id="previews">${draft.images.map((im,i)=>`<div><img src="data:${im.mime};base64,${im.data}" alt="待上传照片 ${i+1}"><button type="button" class="linkbtn" data-remove-photo="${i}">移除</button></div>`).join('')}</div><button class="btn soft" type="button" id="analyze-btn" style="margin-top:20px;width:100%">${icon('spark')} ${state.model.configured?'AI 图文辅助整理':'规则辅助整理（未接模型）'}</button><div class="form-grid"><div><label for="report-title">工单标题 *</label><input id="report-title" maxlength="100" value="${esc(draft.title)}" required placeholder="可先辅助整理，再核对修改"></div><div><label for="report-priority">期望优先级</label><select id="report-priority">${[['low','低 · 不影响使用'],['medium','普通 · 影响使用'],['high','高 · 需尽快核查']].map(([v,n])=>`<option value="${v}" ${draft.priority===v?'selected':''}>${n}</option>`).join('')}</select></div></div><label class="checkrow" style="margin-top:22px"><input id="report-confirm" type="checkbox" required>我已确认设施位置及问题描述</label><div class="flex between" style="margin-top:20px"><span class="tiny muted">提交后由管理人员核查和派单</span><button class="btn" type="submit">提交报修 ${icon('arrow')}</button></div></form><aside class="ai-panel"><div class="flex"><span class="ai-icon">${icon('spark')}</span><div><h2>报修辅助</h2><div class="tiny muted" style="margin-top:4px">EVIDENCE BEFORE ASSUMPTIONS</div></div></div><div id="analysis-result">${analysisHTML()}</div></aside></div>`;
    }

    function analysisHTML() {
        if (!analysis) return `<p class="subtitle" style="margin-top:22px">描述越具体，处理越高效。辅助整理会检查缺失信息，并查找同一设施的未完成工单。</p><div class="ai-section"><h3>我们会保留不确定性</h3><p class="muted">照片中看不到的内部故障，需要维修人员现场确认。信息不足时也可以提交。</p></div><div class="notice warning" style="margin-top:20px">${state.model.configured?'已配置本地模型接口，实际调用失败时会明确降级。':'当前没有配置视觉语言模型。规则模式只处理文字，不会声称看懂图片。'}</div>`;
        return `<div class="notice ${analysis.mode==='model'?'':'warning'}" style="margin-top:20px">${esc(analysis.provider_note)}</div><div class="ai-section"><h3>问题摘要</h3><p>${esc(analysis.summary)}</p><div class="flex" style="margin-top:10px">${pri(analysis.priority)}<span class="badge">建议：${esc(analysis.trade)}</span></div></div><div class="ai-section"><h3>证据与判断边界</h3>${analysis.observations.map(o=>`<p><span class="badge">${esc(o.source)}</span> ${esc(o.text)}</p>`).join('')}<p class="muted" style="margin-top:8px">${esc(analysis.uncertainty)}</p>${analysis.conflicts.map(c=>`<div class="notice warning">${esc(c)}</div>`).join('')}</div>${analysis.questions.length?`<div class="ai-section"><h3>可以再补充一点</h3>${analysis.questions.map(q=>`<div class="question">${esc(q)}</div>`).join('')}<p class="tiny muted" style="margin-top:8px">将答案补充到左侧描述；不清楚也可提交。</p></div>`:''}<div class="ai-section"><h3>同设施的未完成报修</h3>${analysis.duplicates.map(t=>`<div class="duplicate"><p>${esc(t.title)}</p><div class="flex between" style="margin-top:8px">${badge(t.status)}<button class="linkbtn" data-follow="${t.id}">这是同一问题，关注工单</button></div><p class="tiny muted" style="margin-top:8px">${esc(t.reason)}</p></div>`).join('')||'<p class="muted">没有发现同一设施的未完成工单。</p>'}</div>`;
    }

    function maintenancePage() {
        const inspections = state.inspections;
        return head('维护与风险预警', '先看真实业务记录，再看明确标注的模拟预测实验。') + `<div class="notice warning" style="margin-bottom:20px">预测实验使用合成设备事件训练并验证，不能代表真实校园效果。少于 3 条历史工单的设施不输出风险评估。</div><div class="two-col"><section class="card"><div class="card-head"><div><h2>设施维护优先级</h2><p>重复报修基线 + 合成数据预测模型</p></div><button class="btn secondary" id="forecast-btn">${icon('chart')} 运行预测实验</button></div><div class="card-body" id="forecast-result">${forecastHTML()}</div></section><section class="card"><div class="card-head"><div><h2>巡检任务</h2><p>由管理员确认创建与核查结果</p></div><span class="badge">${inspections.filter(i=>i.status==='pending').length} 待办</span></div><div class="card-body">${inspections.map(i=>`<div class="risk-row"><div><h3>${esc(i.asset_id)}</h3><p class="small muted" style="margin-top:6px">${esc(i.note)}</p><div class="tiny muted">${date(i.created)} · ${i.status==='pending'?'待核查':'已核查'}</div>${i.result?`<p class="small">${esc(i.result)}</p>`:''}</div>${i.status==='pending'?`<button class="linkbtn" data-inspection-complete="${i.id}">填写结果</button>`:icon('check')}</div>`).join('')||'<div class="empty">暂无巡检任务<br>从风险列表创建第一项巡检。</div>'}</div></section></div>`;
    }

    function forecastHTML() {
        if (!forecast) return `<div class="empty">运行本地、可复现的预测实验<br><span class="small">训练逻辑回归，与近期报修次数基线对比。</span></div>`;
        const e = forecast.evaluation;
        return `<div class="notice">${esc(e.disclaimer)}</div><div class="stats" style="grid-template-columns:1fr 1fr;margin-top:18px"><div class="stat"><div class="small muted">测试集模型 AUROC</div><div class="stat-value">${e.model_auc.toFixed(3)}</div><div class="tiny muted">基线 ${e.baseline_auc.toFixed(3)}</div></div><div class="stat"><div class="small muted">测试集 Brier 分数</div><div class="stat-value">${e.brier.toFixed(3)}</div><div class="tiny muted">越低越好 · 合成测试集</div></div></div><p class="tiny muted">${e.train_assets} 台训练设备 / ${e.test_assets} 台独立测试设备 · 预测窗口 ${e.horizon_days} 天</p>${forecast.assets.map(a=>`<div class="risk-row"><div><h3>${esc(a.name)}</h3><div class="mono muted" style="margin-top:6px">${esc(a.id)}</div><p class="small muted">${esc(a.reason)}</p><span class="badge ${a.level==='较高'?'orange':''}">${esc(a.level)}</span> <span class="tiny muted">${a.score===null?'暂无足够记录':'模拟模型分数 '+a.score.toFixed(2)+'（非实测概率）'}</span></div>${a.score!==null?`<button class="linkbtn" data-inspect="${a.id}">创建巡检 ↗</button>`:''}</div>`).join('')}`;
    }

    function assistantPage() {
        return head('管理助手', '从已有工单中找到答案，每一个数字由数据库计算。') + `<div class="two-col"><section class="card form-card"><div class="flex"><span class="ai-icon">${icon('spark')}</span><h2>校园维护查询</h2></div><p class="subtitle">目前为受控统计查询，支持下方三类问题；不会生成不存在的数据。</p><div class="flex wrap" style="margin:20px 0">${['哪些设施反复报修？','还有哪些工单待分配？','哪个区域报修最多？'].map(q=>`<button class="tag-button" data-question="${q}">${q}</button>`).join('')}</div><form id="ask-form"><label for="ask-input">你的问题</label><div class="flex"><input id="ask-input" placeholder="例如：哪些设施反复报修？" required><button class="btn" type="submit">查询 ${icon('arrow')}</button></div></form><div id="ask-answer"></div></section><aside class="card form-card"><h2>模型连接状态</h2><div class="notice ${state.model.configured?'':'warning'}" style="margin-top:17px">${state.model.configured?'已配置 Ollama 接口；可在报修页面实际调用验证。':'当前使用规则辅助。没有伪造 AI 图片理解或生成诊断。'}</div><p class="subtitle">预留本地 Ollama 视觉语言模型接口。模型配置使用服务端环境变量，不在网页保存凭证。</p><div class="ai-section"><h3>现有能力边界</h3><p class="small muted">位置：台账检索与用户确认<br>重复工单：同设施 + 字符相似度基线<br>预测：合成事件数据上的本地模型<br>设备状态：报修与验收记录，不是传感器监测</p></div></aside></div>`;
    }

    function bind() {
        if (page === 'assets' && state.user.role === 'admin') $('.toolbar').insertAdjacentHTML('beforeend', '<button class="btn" data-action="add-asset">登记新设施</button>');
        $('#filter-search')?.addEventListener('input', e => {
            filters.search = e.target.value;
            updateRows();
        });
        $('#filter-status')?.addEventListener('change', e => {
            filters.status = e.target.value;
            updateRows();
        });
        $('#filter-location')?.addEventListener('change', e => {
            filters.location = e.target.value;
            updateRows();
        });
        if (page === 'report') {
            $('#report-location').onchange = e => {
                captureDraft();
                draft.asset_id = '';
                analysis = null;
                let rows = state.assets.filter(a => a.location_id === e.target.value);
                $('#report-asset').innerHTML = '<option value="">请选择具体设施</option>' + rows.map(a => `<option value="${a.id}">${esc(a.id)} · ${esc(a.name)}</option>`).join('');
                $('#asset-hint').textContent = '请选择设施并确认位置。';
                $('#analysis-result').innerHTML = analysisHTML();
            };
            $('#report-asset').onchange = e => {
                draft.asset_id = e.target.value;
                analysis = null;
                const a = state.assets.find(a => a.id === draft.asset_id);
                $('#asset-hint').textContent = a ? `${a.location_name} / ${a.room} / ${a.position}` : '';
                $('#analysis-result').innerHTML = analysisHTML();
            };
            $('#report-description').oninput = () => {
                captureDraft();
                if (analysis) {
                    analysis = null;
                    $('#analysis-result').innerHTML = analysisHTML();
                }
            };
            $('#report-photos').onchange = async e => {
                captureDraft();
                try {
                    if (draft.images.length + e.target.files.length > 3) throw Error('最多上传3张照片');
                    const imgs = await Promise.all([...e.target.files].map(compressImage));
                    draft.images.push(...imgs);
                    analysis = null;
                    render();
                } catch (e) {
                    toast(e.message);
                }
            };
            $('#analyze-btn').onclick = async e => {
                captureDraft();
                if (!draft.asset_id || !draft.description.trim()) return toast('请先选择设施并填写描述');
                e.currentTarget.disabled = true;
                e.currentTarget.textContent = '正在整理，请稍候…';
                try {
                    analysis = await api('/analyze', draft);
                    draft.title = analysis.title;
                    draft.priority = analysis.priority;
                    render();
                } catch (e) {
                    toast(e.message);
                    render();
                }
            };
            $('#report-form').onsubmit = async e => {
                e.preventDefault();
                captureDraft();
                e.submitter.disabled = true;
                try {
                    const r = await api('/tickets', draft);
                    draft = {
                        asset_id: '',
                        description: '',
                        title: '',
                        priority: 'medium',
                        images: []
                    };
                    analysis = null;
                    await refresh();
                    go('tickets');
                    toast('报修已提交，等待管理人员确认');
                    await openTicket(r.id);
                } catch (e) {
                    toast(e.message);
                    e.submitter.disabled = false;
                }
            };
        }
        $('#forecast-btn')?.addEventListener('click', async e => {
            e.currentTarget.disabled = true;
            e.currentTarget.textContent = '运行实验中…';
            try {
                forecast = await api('/forecast');
                render();
            } catch (e) {
                toast(e.message);
                render();
            }
        });
        $('#ask-form')?.addEventListener('submit', async e => {
            e.preventDefault();
            const b = e.submitter;
            b.disabled = true;
            try {
                const r = await api('/ask', {
                    question: $('#ask-input').value
                });
                $('#ask-answer').innerHTML = `<div class="chat-answer">${esc(r.answer)}</div><p class="tiny muted" style="margin-top:10px">${esc(r.mode)}</p><button class="linkbtn" style="margin-top:15px" data-page="tickets">查看工单记录 ↗</button>`;
            } catch (e) {
                toast(e.message);
            } finally {
                b.disabled = false;
            }
        });
    }

    function captureDraft() {
        if (!$('#report-form')) return;
        draft.asset_id = $('#report-asset').value;
        draft.description = $('#report-description').value;
        draft.title = $('#report-title').value;
        draft.priority = $('#report-priority').value;
    }

    function updateRows() {
        if (page === 'assets') $('#assets-body').innerHTML = assetRows();
        if (page === 'tickets') $('#tickets-body').innerHTML = ticketRows();
    }
    async function compressImage(file) {
        if (!['image/jpeg', 'image/png'].includes(file.type)) throw Error('请上传 JPEG 或 PNG 图片');
        if (file.size > 15 * 1024 * 1024) throw Error('原始图片请控制在15MB以内');
        let bitmap = await createImageBitmap(file);
        let canvas = document.createElement('canvas');
        const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
        canvas.width = bitmap.width * scale;
        canvas.height = bitmap.height * scale;
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        return {
            mime: 'image/jpeg',
            data: canvas.toDataURL('image/jpeg', .82).split(',')[1]
        };
    }

    async function openAsset(id) {
        let a = state.assets.find(x => x.id === id);
        if (!a) return;
        let history = state.tickets.filter(t => t.asset_id === id);
        drawer(`<div class="drawer-head"><div><div class="eyebrow">ASSET PROFILE</div><h1>${esc(a.name)}</h1><div class="mono muted" style="margin-top:8px">${esc(a.id)}</div></div><button class="close" data-action="close" aria-label="关闭">×</button></div><div class="detail-box"><div class="flex between">${badge(a.status)}<span class="small muted">${esc(a.category)}</span></div><p style="margin-top:15px">${esc(a.location_name)} / ${esc(a.room)} / ${esc(a.position)}</p><div class="small muted" style="margin-top:12px">最后确认：${date(a.last_checked)}<br>状态依据：${esc(a.basis)}<br>初始投用日期：${esc(a.commissioned)}（模拟）</div></div>${state.user.role!=='technician'?`<button class="btn" style="width:100%" data-report-asset="${a.id}">${icon('plus')} 报修此设施</button>`:''}<div class="detail-box"><h2>设施定位入口</h2><p class="small muted" style="margin-top:10px">登记位置固定绑定设施编号。手机访问时需使用可达的服务地址；localhost 链接仅本机有效。</p><div class="qr-box"><img src="/api/qr?asset=${encodeURIComponent(a.id)}" alt="设施报修二维码"><div class="mono" style="margin-top:9px">${esc(a.id)}</div></div><button class="btn secondary" style="margin-top:12px;width:100%" data-copy-asset="${a.id}">复制设施报修链接</button></div><div class="detail-box"><h2>可见维修记录</h2>${history.map(ticketRow).join('')||'<p class="subtitle">当前账号没有可见的历史工单。</p>'}</div>`);
    }
    async function openTicket(id) {
        try {
            const data = await api('/tickets/' + id),
                t = data.ticket,
                u = state.user,
                a = state.assets.find(a => a.id === t.asset_id),
                full = state.tickets.find(x => x.id === id);
            let actions = '';
            if (u.role === 'admin' && ['pending', 'assigned', 'in_progress', 'waiting_parts'].includes(t.status)) actions += `<label for="assign-person">指派 / 改派维修人员</label><select id="assign-person">${state.technicians.map(p=>`<option value="${p.id}" ${p.id===t.assignee?'selected':''}>${esc(p.name)} · ${esc(p.skill)} · ${p.workload} 项未完成</option>`).join('')}</select><button class="btn" data-transition="assign" style="margin-top:12px">确认派单</button>`;
            if (u.role === 'technician') {
                if (t.status === 'assigned') actions += '<button class="btn" data-transition="start">开始检查维修</button>';
                if (t.status === 'in_progress') actions += '<button class="btn secondary" data-transition="wait">等待配件</button> <button class="btn" data-transition="complete">提交验收</button>';
                if (t.status === 'waiting_parts') actions += '<button class="btn" data-transition="resume">恢复维修</button>';
            }
            if (u.role === 'admin' || t.reporter === u.id) {
                if (t.status === 'review') actions += '<button class="btn" data-transition="accept">确认验收通过</button> ';
                if (['review', 'closed'].includes(t.status)) actions += '<button class="btn secondary" data-transition="reopen">未解决 / 再次出现</button> ';
                if (t.status === 'pending') actions += '<button class="btn danger" data-transition="cancel">取消报修</button>';
            }
            drawer(`<div class="drawer-head"><div><div class="eyebrow">WORK ORDER ${t.synthetic?'· 模拟记录':''}</div><h2 style="font-size:22px;line-height:1.5">${esc(t.title)}</h2><div class="mono muted" style="margin-top:8px">${t.id}</div></div><button class="close" data-action="close" aria-label="关闭">×</button></div><div class="flex">${badge(t.status)}${pri(t.priority)}</div><div class="detail-box"><div class="detail-label">设施与位置</div><strong>${esc(a?.name||t.asset_id)}</strong><p class="small muted">${esc(a?.location_name||'')} / ${esc(a?.room||'')}<br>${esc(t.asset_id)}</p><div class="detail-label" style="margin-top:16px">用户报告的现象</div><p>${esc(t.description).replace(/\n/g,'<br>')}</p><div class="flex between small muted" style="margin-top:16px"><span>报修：${esc(full?.reporter_name||t.reporter)}</span><span>维修：${esc(full?.assignee_name||'待分配')}</span></div>${data.attachments.length?`<div class="photo-grid" style="margin-top:15px">${data.attachments.map(im=>`<a href="/api/attachments/${im.id}" target="_blank" rel="noopener"><img src="/api/attachments/${im.id}" alt="报修照片"></a>`).join('')}</div>`:''}</div>${t.result?`<div class="detail-box"><div class="detail-label">维修人员处理结果</div><p>${esc(t.result)}</p></div>`:''}<div class="detail-box"><h3>处理与补充记录</h3><label for="action-note">说明 / 实际检查结果</label><textarea id="action-note" placeholder="填写实际发现、处理步骤、等待原因或补充信息"></textarea><div class="flex wrap" style="margin-top:12px">${actions}</div><button class="linkbtn" data-transition="comment" style="margin-top:15px">仅添加补充记录</button><p class="tiny muted" style="margin-top:12px">状态变更由后端检查权限和版本，避免覆盖他人的更新。</p></div><div class="detail-box"><h3>完整处理记录</h3><div class="timeline">${data.events.map(e=>`<div class="timeline-item"><div class="flex between"><strong>${esc(e.actor_name)}</strong><span class="tiny muted">${date(e.created)}</span></div><p>${esc(e.note)}</p><span class="tiny muted">${esc({created:'提交报修',assign:'派单',start:'开始维修',wait:'等待配件',resume:'继续维修',complete:'提交验收',accept:'验收通过',reopen:'重新打开',comment:'补充信息',cancel:'取消报修',seed:'模拟初始记录'}[e.action]||e.action)}</span></div>`).join('')}</div></div>`);
            $$('.drawer [data-transition]').forEach(b => b.onclick = async () => {
                b.disabled = true;
                try {
                    await api('/transition', {
                        id: t.id,
                        version: t.version,
                        action: b.dataset.transition,
                        note: $('#action-note').value,
                        assignee: $('#assign-person')?.value
                    });
                    await refresh();
                    render();
                    await openTicket(t.id);
                    toast('工单已更新');
                } catch (e) {
                    toast(e.message);
                    if (e.message.includes('刷新')) {
                        await refresh();
                        render();
                        await openTicket(t.id);
                    }
                    b.disabled = false;
                }
            });
        } catch (e) {
            toast(e.message);
        }
    }

    function assetEditor(id) {
        const a = state.assets.find(a => a.id === id),
            editing = !!a;
        drawer(`<div class="drawer-head"><div><div class="eyebrow">ASSET MANAGEMENT</div><h2>${editing?'更新设施档案':'登记新设施'}</h2></div><button class="close" data-action="close" aria-label="关闭">×</button></div><form id="asset-form"><label for="asset-name">设施名称 *</label><input id="asset-name" value="${esc(a?.name||'')}" required maxlength="80">${editing?`<p class="subtitle">编号与区域固定：${esc(a.id)} / ${esc(a.location_name)}</p>`:`<label for="asset-id">唯一编号 *</label><input id="asset-id" placeholder="如 A-201-FAN-02" pattern="[A-Za-z0-9-]{4,48}" required><label for="asset-category">类别</label><select id="asset-category">${['空调','风扇','灯具','路灯','电脑','投影仪','家具','门锁','水务','洗衣机','饮水机','围栏','路面'].map(c=>`<option>${c}</option>`).join('')}</select><label for="asset-location">区域</label><select id="asset-location">${state.locations.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select><label for="asset-room">房间 / 公共区域 *</label><input id="asset-room" placeholder="如 A-201 / D1-201 / PUBLIC / OUTDOOR" required><label for="asset-date">投用日期（未知可留空）</label><input type="date" id="asset-date">`}<label for="asset-position">具体位置补充</label><input id="asset-position" value="${esc(a?.position||'')}" placeholder="如靠近讲台、沿道路第7盏" maxlength="100">${editing?`<label class="checkrow"><input id="asset-retired" type="checkbox" ${a.retired?'checked':''}>停用此设施（保留档案与维修记录）</label>`:'<div class="notice" style="margin-top:18px">新设施初始为“待核实”，完成巡检后才记录状态。</div>'}<button class="btn" style="margin-top:20px;width:100%" type="submit">保存设施档案</button></form>`);
        $('#asset-form').onsubmit = async e => {
            e.preventDefault();
            const b = e.submitter;
            b.disabled = true;
            try {
                let body = {
                    name: $('#asset-name').value,
                    position: $('#asset-position').value
                };
                if (editing) {
                    body.id = a.id;
                    body.retired = $('#asset-retired').checked;
                } else Object.assign(body, {
                    id: $('#asset-id').value,
                    category: $('#asset-category').value,
                    location_id: $('#asset-location').value,
                    room: $('#asset-room').value,
                    commissioned: $('#asset-date').value
                });
                await api(editing ? '/assets/update' : '/assets', body);
                await refresh();
                closeDrawer();
                go('assets');
                toast('设施档案已保存');
            } catch (e) {
                toast(e.message);
                b.disabled = false;
            }
        };
    }

    async function handle(b) {
        if (b.dataset.location) {
            selectedLocation = b.dataset.location;
            selectedRoom = '';
            go('map');
        } else if (b.dataset.room) {
            selectedRoom = selectedRoom === b.dataset.room ? '' : b.dataset.room;
            render();
        } else if (b.dataset.ticket) await openTicket(b.dataset.ticket);
        else if (b.dataset.asset) {
            await openAsset(b.dataset.asset);
            if (state.user.role === 'admin') $('.drawer .detail-box').insertAdjacentHTML('beforeend', `<div class="flex wrap" style="margin-top:15px"><button class="linkbtn" data-edit-asset="${b.dataset.asset}">编辑设施档案</button><button class="linkbtn" data-inspect="${b.dataset.asset}">安排核查巡检</button></div>`);
        } else if (b.dataset.editAsset) assetEditor(b.dataset.editAsset);
        else if (b.dataset.action === 'add-asset') assetEditor();
        else if (b.dataset.reportAsset) {
            closeDrawer();
            draft.asset_id = b.dataset.reportAsset;
            analysis = null;
            go('report');
        } else if (b.dataset.copyAsset) {
            await navigator.clipboard.writeText(location.origin + '/?asset=' + encodeURIComponent(b.dataset.copyAsset));
            toast('设施链接已复制');
        } else if (b.dataset.removePhoto !== undefined) {
            captureDraft();
            draft.images.splice(Number(b.dataset.removePhoto), 1);
            analysis = null;
            render();
        } else if (b.dataset.follow) {
            captureDraft();
            await api('/follow', {
                ticket_id: b.dataset.follow,
                asset_id: draft.asset_id
            });
            await refresh();
            toast('已关注原工单，可查看进度并补充信息');
            await openTicket(b.dataset.follow);
        } else if (b.dataset.inspect) {
            await api('/inspections', {
                asset_id: b.dataset.inspect,
                note: '管理员从设施档案或维护列表安排核查；请记录实际检查结果。'
            });
            await refresh();
            closeDrawer();
            render();
            toast('巡检任务已创建');
        } else if (b.dataset.inspectionComplete) {
            drawer(`<div class="drawer-head"><h2>确认巡检结果</h2><button class="close" data-action="close" aria-label="关闭">×</button></div><label for="inspection-note">实际巡检结果</label><textarea id="inspection-note" placeholder="记录检查内容与发现；需要维修请另建工单。"></textarea><button class="btn" id="inspection-submit" style="margin-top:15px">保存结果</button>`);
            $('#inspection-submit').onclick = async () => {
                try {
                    await api('/inspections/complete', {
                        id: b.dataset.inspectionComplete,
                        note: $('#inspection-note').value
                    });
                    await refresh();
                    closeDrawer();
                    render();
                    toast('巡检结果已保存');
                } catch (e) {
                    toast(e.message);
                }
            };
        } else if (b.dataset.question) {
            $('#ask-input').value = b.dataset.question;
            $('#ask-form').requestSubmit($('#ask-form button'));
        } else if (b.dataset.action === 'geolocate') {
            $('#geo-result').textContent = '正在申请定位权限…';
            if (!navigator.geolocation) throw Error('此浏览器不支持定位');
            navigator.geolocation.getCurrentPosition(p => {
                $('#geo-result').textContent = `实际坐标：${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}；浏览器报告精度约 ${Math.round(p.coords.accuracy)} 米。虚拟校园未配置真实地理边界，请在示意图选择位置。`;
            }, err => {
                $('#geo-result').textContent = '无法获取定位（权限被拒绝或定位不可用）。仍可通过地图选点或设施编号报修。';
            }, {
                timeout: 10000,
                maximumAge: 60000
            });
        } else if (b.dataset.action === 'locate-text') {
            let q = $('#location-query').value.toUpperCase().replace(/\s/g, '');
            let matches = state.assets.filter(a => [a.id, a.id.replaceAll('-', ''), a.name, a.location_name + a.room + a.name].some(s => s.toUpperCase().includes(q))).slice(0, 8);
            $('#location-results').innerHTML = q && matches.length ? matches.map(a => `<button class="tag-button" style="margin:4px" data-asset="${a.id}">${esc(a.id)} · ${esc(a.name)}</button>`).join('') : '没有唯一匹配，请选择地图区域或输入准确编号；系统不会猜测位置。';
        }
    }

    return {
        views: {map: mapPage, assets: assetsPage, tickets: ticketsPage, report: reportPage,
            maintenance: maintenancePage, assistant: assistantPage, 'facility-overview': facilityOverview},
        bind, handle, reset, captureDraft,
        resetFilters: () => { filters = emptyFilters(); },
        seedReport: asset => { draft.asset_id = state.assets.some(a => a.id === asset) ? asset : ''; },
    };
})();
