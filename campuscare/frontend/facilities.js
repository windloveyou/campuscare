'use strict';

// Facility views and their transient state. The host supplies the current session
// and shared UI primitives; facility interactions stay inside this module.
const facilities = (() => {
    const emptyDraft = () => ({asset_id: '', description: '', title: '', priority: 'medium', images: []});
    const emptyFilters = () => ({search: '', status: '', location: ''});
    let selectedLocation = 'A', selectedRoom = '', filters = emptyFilters(),
        draft = emptyDraft(), analysis = null, forecast = null;
    const newButton = () => state.user.role !== 'technician' ? `<button class="btn" data-action="new">${icon('plus')} Report an Issue</button>` : '';
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
        const buildings = [['A',138,95,100,68,'Academic Building A'],['B',365,95,110,68,'Academic Building B'],['D1',140,265,100,70,'Residence D1'],['D2',365,265,110,70,'Residence D2'],['SERVICE',555,280,79,48,'Maintenance Center']];
        const active = a => a && !['normal','unknown','retired'].includes(a.status);
        const treeMarkup = trees.map(([x,y],i) => `<circle cx="${x}" cy="${y}" r="${i%3+9}" fill="#c9d8b8"/><circle cx="${x-2}" cy="${y-2}" r="3" fill="#ffffff24"/>`).join('');
        const buildingMarkup = buildings.map(([id,x,y,w,h,name]) => {
            const assets = state.assets.filter(a => a.location_id === id);
            const count = assets.filter(active).length;
            const color = id.startsWith('D') ? '#e4d9c7' : '#d5dfd2';
            const roof = id.startsWith('D') ? '#f0e8da' : '#e5ece0';
            const windows = [0,1,2,3].map(i => `<rect x="${x+15+i*(w-28)/4}" y="${y+10}" width="8" height="5" rx="1" fill="#b9cbb6"/>`).join('');
            const counter = count ? `<circle cx="${x+w-2}" cy="${y+2}" r="10" fill="#cb934e" stroke="#fff" stroke-width="2"/><text x="${x+w-2}" y="${y+5}" text-anchor="middle" fill="#fff" font-size="9">${count}</text>` : '';
            return `<g class="building" data-location="${id}" tabindex="0" role="button" aria-label="${name}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${color}" stroke="#b7c6b3" filter="url(#mapshadow)"/><rect x="${x+7}" y="${y+6}" width="${w-14}" height="${h-17}" rx="4" fill="${roof}" stroke="#c7d1bf"/>${windows}<text x="${x+w/2}" y="${y+h/2+5}" text-anchor="middle" fill="#586b52" font-size="12" font-weight="500">${name}</text><text x="${x+w/2}" y="${y+h+18}" text-anchor="middle" fill="#8b9880" font-size="9">${assets.length}  facilities</text>${counter}</g>`;
        }).join('');
        const roadMarkup = [['R1',336,238,'Sycamore Avenue'],['R2',110,195,'Academic Way'],['R3',520,268,'Residence Road']].map(([id,x,y,name]) => `<g data-location="${id}" class="building" tabindex="0" role="button" aria-label="${name}"><rect x="${x-35}" y="${y-13}" width="70" height="20" rx="4" fill="#fafbf5"/><text x="${x}" y="${y}" text-anchor="middle" fill="#8b987e" font-size="10">${name}</text></g>`).join('');
        const lamps = [175,225,425,475,580,630].map((x,i) => {
            const id = 'R1-LIGHT-' + String(i+1).padStart(2,'0');
            const asset = state.assets.find(a => a.id === id);
            const color = active(asset) ? '#cb934e' : asset?.status === 'normal' ? '#83a682' : '#9ba49b';
            return `<g class="building" data-asset="${id}" tabindex="0" role="button" aria-label="Sycamore Avenue streetlight ${i+1}"><circle cx="${x}" cy="252" r="9" fill="transparent"/><circle cx="${x}" cy="252" r="4" fill="${color}" stroke="#fff" stroke-width="1.5"/></g>`;
        }).join('');
        return `<div class="map-wrap"><div class="map-overlay">GCU Campus illustration · Not to scale</div><div class="map-compass">N<br>↑</div>
        <svg class="map-svg" viewBox="0 0 700 400" role="img" aria-label="Campus map. Select a building or road to view its facilities.">
        <defs><pattern id="grass" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".5" fill="#cbd4bb"/></pattern><filter id="mapshadow"><feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#66816b" flood-opacity=".13"/></filter></defs>
        <rect width="700" height="400" fill="#edf0e3"/><rect width="700" height="400" fill="url(#grass)"/>
        <path d="M0 235H700 M110 0V400 M520 0V400" stroke="#d9decf" stroke-width="32"/><path d="M0 235H700 M110 0V400 M520 0V400" stroke="#fafbf5" stroke-width="25"/><path d="M0 235H700 M110 0V400 M520 0V400" stroke="#dbe1d2" stroke-width="1" stroke-dasharray="6 6"/>
        <path d="M240 128H365 M290 130V235 M240 300H365 M300 300V235 M475 300H555" stroke="#f9faf3" stroke-width="12"/><rect x="260" y="80" width="72" height="90" rx="30" fill="#dfe8d1"/><ellipse cx="302" cy="305" rx="30" ry="32" fill="#d9e7d6"/><path d="M288 283Q318 284 315 310Q300 327 286 312Z" fill="#c7dcd2"/>
        ${treeMarkup}${buildingMarkup}${roadMarkup}${lamps}
        <rect x="82" y="374" width="58" height="20" rx="3" fill="#e4e9dc"/><text x="110" y="388" text-anchor="middle" fill="#89967c" font-size="9">South Campus Gate</text><text x="580" y="385" fill="#a1aa93" font-size="8">SCHEMATIC · NOT TO SCALE</text></svg></div>`;
    }

    function facilityOverview() {
        const a = state.assets,
            t = state.tickets,
            open = t.filter(t => !['closed', 'cancelled'].includes(t.status)),
            pending = t.filter(t => t.status === 'pending'),
            review = t.filter(t => t.status === 'review'),
            normal = a.filter(a => a.status === 'normal');
        const cards = [
            ['Asset Records', a.length, 'box', 'Facilities available to your account'],
            ['Open Work Orders', open.length, 'ticket', 'Includes review, repairs, and verification'],
            ['Awaiting Review or Assignment', pending.length, 'clock', 'Requires administrator follow-up'],
            ['Awaiting Verification', review.length, 'check', 'Verify that the repair is complete']
        ];
        return head(state.user.role === 'admin' ? 'Campus Maintenance Overview' : state.user.role === 'technician' ? 'Maintenance Dashboard' : 'Campus Facilities Dashboard', 'Track issues from the initial report through completed repairs.', newButton()) + `<div class="stats">${cards.map(([n,v,i,f])=>`<div class="stat"><div class="stat-top">${n}<span class="stat-icon">${icon(i)}</span></div><div class="stat-value">${v}<span style="font-size:11px;color:#9ca49a;margin-left:7px"> items</span></div><div class="stat-foot">${f}</div></div>`).join('')}</div><div class="dashboard-grid"><section class="card"><div class="card-head"><div><h2>Open Work and Recent Activity</h2><p>Work orders that need attention</p></div><span class="badge">${open.length}  items</span></div><div class="card-body">${open.slice(0,4).map(ticketRow).join('')||'<div class="empty">There are no open work orders.</div>'}<button class="btn secondary" style="width:100%;margin-top:10px" data-page="tickets">View All Work Orders ${icon('arrow')}</button></div></section></div><div class="bottom-grid"><section class="card"><div class="card-head"><div><h2>Facility Status Overview</h2><p>Based on reports, repairs, and completion checks</p></div>${icon('box')}</div><div class="card-body"><div class="flex between"><span class="small muted">No Known Issues / Visible Facilities</span><span style="font-size:23px">${normal.length}<span class="small muted"> / ${a.length}</span></span></div><div class="equipment-progress"><span style="background:#83ac8d;flex:${normal.length}"></span><span style="background:#d3ac69;flex:${a.length-normal.length}"></span></div><div class="notice">No Reported Issue ≠ real-time operational status. The asset record shows the last verification and its source.</div></div></section><section class="card"><div class="card-head"><div><h2>Work Orders by Area</h2><p>Includes demo history and records available to your account.</p></div>${icon('chart')}</div><div class="card-body bars">${state.locations.filter(l=>['A','B','D1','D2'].includes(l.id)).map(l=>{let n=t.filter(x=>state.assets.find(a=>a.id===x.asset_id)?.location_id===l.id).length;return `<div class="bar-row"><span>${esc(l.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100,n/Math.max(1,t.length)*180)}%"></div></div><span class="muted">${n}</span></div>`;}).join('')}</div></section></div>`;
    }

    function ticketRow(t) {
        return `<div class="ticket-row" data-ticket="${t.id}" tabindex="0" role="button"><div class="ticket-icon">${icon('tool')}</div><div style="flex:1;min-width:0"><div class="ticket-title">${esc(t.title)}</div><div class="ticket-meta">${esc(t.location_name)} · ${esc(t.asset_id)}</div><div class="flex between" style="margin-top:4px">${badge(t.status)}<span class="tiny muted">${date(t.updated)}</span></div></div></div>`;
    }

    function mapPage() {
        let loc = state.locations.find(l => l.id === selectedLocation) || state.locations[0],
            assets = state.assets.filter(a => a.location_id === loc.id),
            rooms = [...new Set(assets.map(a => a.room))];
        return head('Campus Map', 'Browse buildings, rooms, and individual assets on this illustrative campus map.', newButton()) + `<div class="two-col"><section class="card"><div class="card-head"><h2>GCU · Demo Campus</h2><button class="linkbtn" data-action="geolocate">${icon('pin')} Use My Location</button></div>${mapSVG()}<div class="card-body"><div id="geo-result" class="notice">This campus is fictional. GPS shows your browser’s coordinates without mapping them to the demo campus.</div><div class="map-locations">${state.locations.map(l=>`<button class="tag-button ${l.id===loc.id?'active':''}" data-location="${l.id}">${esc(l.name)}</button>`).join('')}</div><label for="location-query">Location or Asset ID</label><div class="flex"><input id="location-query" placeholder="e.g., A201, D1 shared washing machine, R1-LIGHT-03"><button class="btn secondary" data-action="locate-text">Find</button></div><div id="location-results" class="small muted" style="margin-top:10px">Search the asset register by keyword.</div></div></section><section class="card building-detail"><div class="eyebrow">LOCATION DETAILS</div><h2>${esc(loc.name)}</h2><p class="subtitle">${esc(loc.description)} · ${assets.length}  visible facilities</p><div class="room-grid">${rooms.map(r=>`<button class="room ${r===selectedRoom?'active':''}" data-room="${r}">${r==='PUBLIC'?'Public Area':r==='OUTDOOR'?'Outdoor Facilities':esc(r)}<div class="tiny muted" style="margin-top:7px">${assets.filter(a=>a.room===r).length}  facilities</div></button>`).join('')}</div><div style="max-height:440px;overflow:auto">${assets.filter(a=>!selectedRoom||a.room===selectedRoom).map(a=>`<div class="ticket-row" data-asset="${a.id}" tabindex="0" role="button"><div class="ticket-icon">${icon('box')}</div><div style="flex:1"><div class="ticket-title">${esc(a.name)}</div><div class="ticket-meta">${esc(a.id)}</div></div>${badge(a.status)}</div>`).join('')||'<div class="empty">No assets are registered in this area.</div>'}</div></section></div>`;
    }


    function ticketsPage() {
        return head(state.user.role === 'technician' ? 'My Maintenance Tasks' : 'Work Orders', state.user.role === 'user' ? 'Track your reports and the work orders you follow.' : 'Track maintenance from initial review through completion.', newButton()) + `<div class="toolbar"><input id="filter-search" placeholder="Search by title, asset, or work order ID" value="${esc(filters.search)}"><select id="filter-status"><option value="">All Statuses</option>${Object.keys(labels).slice(0,7).map(s=>`<option value="${s}" ${filters.status===s?'selected':''}>${labels[s]}</option>`).join('')}</select><span class="small muted">Showing work orders available to your account</span></div><div class="card table-wrap"><table><thead><tr><th>Work Order</th><th>Asset and Location</th><th>Status</th><th>Priority</th><th>Technicians</th><th>Last Updated</th></tr></thead><tbody id="tickets-body">${ticketRows()}</tbody></table></div>`;
    }

    function ticketRows() {
        return state.tickets.filter(t => (!filters.status || t.status === filters.status) && [t.title, t.id, t.asset_id].join(' ').toLowerCase().includes(filters.search.toLowerCase())).map(t => `<tr><td><button class="linkbtn" style="font-size:12px;text-align:left" data-ticket="${t.id}">${esc(t.title)}</button><div class="mono muted" style="margin-top:5px">${t.id}${t.synthetic?' · Demo':''}</div></td><td>${esc(t.location_name)}<div class="small muted">${esc(t.asset_id)}</div></td><td>${badge(t.status)}</td><td>${pri(t.priority)}</td><td>${esc(t.assignee_name||'Unassigned')}</td><td class="small muted">${date(t.updated)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No matching work orders</td></tr>';
    }

    function reportPage() {
        let asset = state.assets.find(a => a.id === draft.asset_id);
        return head('Report a Facility Issue', 'Select the affected asset and describe the issue.') + `<div class="steps"><span><b>1</b> Confirm Asset</span><span>—</span><span><b>2</b> Describe the Issue</span><span>—</span><span><b>3</b> Review and Submit</span></div><div class="two-col"><form id="report-form" class="card form-card"><h2>Issue Details</h2><label for="report-location">Campus Area</label><select id="report-location"><option value="">Select an area</option>${state.locations.map(l=>`<option value="${l.id}" ${asset?.location_id===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select><label for="report-asset">Affected Asset *</label><select id="report-asset" required><option value="">Select an asset or scan its QR code</option>${(asset?state.assets.filter(a=>a.location_id===asset.location_id):[]).map(a=>`<option value="${a.id}" ${a.id===draft.asset_id?'selected':''}>${esc(a.id)} · ${esc(a.name)}</option>`).join('')}</select><div id="asset-hint" class="tiny muted" style="margin-top:9px">${asset?esc(asset.location_name+' / '+asset.room+' / '+asset.position):'Confirm the asset location against the register before submitting.'}</div><label for="report-description">What happened? *</label><textarea id="report-description" maxlength="3000" required placeholder="e.g., The air conditioner in A201 has been leaking since this morning.">${esc(draft.description)}</textarea><label class="upload" for="report-photos">${icon('image')}<br><span style="display:block;margin-top:8px">Add Photos · Up to 3</span><span class="tiny">JPEG / PNG · Photos are compressed in your browser before upload.</span><input type="file" accept="image/jpeg,image/png" multiple id="report-photos"></label><div class="previews" id="previews">${draft.images.map((im,i)=>`<div><img src="data:${im.mime};base64,${im.data}" alt="Selected Photos ${i+1}"><button type="button" class="linkbtn" data-remove-photo="${i}">Remove</button></div>`).join('')}</div><button class="btn soft" type="button" id="analyze-btn" style="margin-top:20px;width:100%">${icon('spark')} ${state.model.configured?'AI Organize Report with Photos':'Organize Report Using Rules'}</button><div class="form-grid"><div><label for="report-title">Report Title *</label><input id="report-title" maxlength="100" value="${esc(draft.title)}" required placeholder="Use the assistant to draft a title, then review or edit it"></div><div><label for="report-priority">Requested Priority</label><select id="report-priority">${[['low','Low · Still usable'],['medium','Normal · Affects use'],['high','High · Needs prompt review']].map(([v,n])=>`<option value="${v}" ${draft.priority===v?'selected':''}>${n}</option>`).join('')}</select></div></div><label class="checkrow" style="margin-top:22px"><input id="report-confirm" type="checkbox" required>I confirm the location and description.</label><div class="flex between" style="margin-top:20px"><span class="tiny muted">Reports are assigned automatically by specialty and workload.</span><button class="btn" type="submit">Submit Report ${icon('arrow')}</button></div></form><aside class="ai-panel"><div class="flex"><span class="ai-icon">${icon('spark')}</span><div><h2>Reporting Assistant</h2><div class="tiny muted" style="margin-top:4px">EVIDENCE BEFORE ASSUMPTIONS</div></div></div><div id="analysis-result">${analysisHTML()}</div></aside></div>`;
    }

    function analysisHTML() {
        if (!analysis) return `<p class="subtitle" style="margin-top:22px">The assistant checks for missing details and open reports for the same asset.</p><div class="ai-section"><h3>On-Site Verification</h3><p class="muted">Technicians must inspect faults that cannot be seen in photos. You can still submit a report with limited information.</p></div><div class="notice warning" style="margin-top:20px">${state.model.configured?'A local model is configured. If it is unavailable, the assistant will use text-based rules.':'No vision model is configured. The assistant processes text only.'}</div>`;
        return `<div class="notice ${analysis.mode==='model'?'':'warning'}" style="margin-top:20px">${esc(analysis.provider_note)}</div><div class="ai-section"><h3>Issue Summary</h3><p>${esc(analysis.summary)}</p><div class="flex" style="margin-top:10px">${pri(analysis.priority)}<span class="badge">Recommendation: ${esc(analysis.trade)}</span></div></div><div class="ai-section"><h3>Evidence and Limitations</h3>${analysis.observations.map(o=>`<p><span class="badge">${esc(o.source)}</span> ${esc(o.text)}</p>`).join('')}<p class="muted" style="margin-top:8px">${esc(analysis.uncertainty)}</p>${analysis.conflicts.map(c=>`<div class="notice warning">${esc(c)}</div>`).join('')}</div>${analysis.questions.length?`<div class="ai-section"><h3>Suggested Details</h3>${analysis.questions.map(q=>`<div class="question">${esc(q)}</div>`).join('')}<p class="tiny muted" style="margin-top:8px">Add any details you know to the description before submitting.</p></div>`:''}<div class="ai-section"><h3>Open Reports for This Asset</h3>${analysis.duplicates.map(t=>`<div class="duplicate"><p>${esc(t.title)}</p><div class="flex between" style="margin-top:8px">${badge(t.status)}<button class="linkbtn" data-follow="${t.id}">Follow This Work Order</button></div><p class="tiny muted" style="margin-top:8px">${esc(t.reason)}</p></div>`).join('')||'<p class="muted">No open work orders were found for this asset.</p>'}</div>`;
    }

    function maintenancePage() {
        const inspections = state.inspections;
        return head('Maintenance and Risk Assessment', 'Review maintenance records and run a separately labeled forecasting experiment.') + `<div class="notice warning" style="margin-bottom:20px">The forecasting experiment uses synthetic asset events and does not measure real campus performance. Assets with fewer than three historical work orders are not scored.</div><div class="two-col"><section class="card"><div class="card-head"><div><h2>Maintenance Priorities</h2><p>Repeat-Report Baseline + Synthetic-Data Forecasting Model</p></div><button class="btn secondary" id="forecast-btn">${icon('chart')} Run Forecasting Experiment</button></div><div class="card-body" id="forecast-result">${forecastHTML()}</div></section><section class="card"><div class="card-head"><div><h2>Inspections</h2><p>Administrators schedule inspections and verify results.</p></div><span class="badge">${inspections.filter(i=>i.status==='pending').length} Pending</span></div><div class="card-body">${inspections.map(i=>`<div class="risk-row"><div><h3>${esc(i.asset_id)}</h3><p class="small muted" style="margin-top:6px">${esc(i.note)}</p><div class="tiny muted">${date(i.created)} · ${i.status==='pending'?'Awaiting Verification':'Verified'}</div>${i.result?`<p class="small">${esc(i.result)}</p>`:''}</div>${i.status==='pending'?`<button class="linkbtn" data-inspection-complete="${i.id}">Record Results</button>`:icon('check')}</div>`).join('')||'<div class="empty">No scheduled inspections<br>Schedule an inspection from the risk list.</div>'}</div></section></div>`;
    }

    function forecastHTML() {
        if (!forecast) return `<div class="empty">Reproducible Forecasting Experiment<br><span class="small">Compare logistic regression against a baseline based on recent report counts.</span></div>`;
        const e = forecast.evaluation;
        return `<div class="notice">${esc(e.disclaimer)}</div><div class="stats" style="grid-template-columns:1fr 1fr;margin-top:18px"><div class="stat"><div class="small muted">Model AUROC on Test Set</div><div class="stat-value">${e.model_auc.toFixed(3)}</div><div class="tiny muted">Baseline ${e.baseline_auc.toFixed(3)}</div></div><div class="stat"><div class="small muted">Brier Score on Test Set</div><div class="stat-value">${e.brier.toFixed(3)}</div><div class="tiny muted">Lower is better · Synthetic test set</div></div></div><p class="tiny muted">${e.train_assets}  training assets /  ${e.test_assets}  held-out assets · Forecast window:  ${e.horizon_days}  days</p>${forecast.assets.map(a=>`<div class="risk-row"><div><h3>${esc(a.name)}</h3><div class="mono muted" style="margin-top:6px">${esc(a.id)}</div><p class="small muted">${esc(a.reason)}</p><span class="badge ${a.level==='Elevated'?'orange':''}">${esc(a.level)}</span> <span class="tiny muted">${a.score===null?'Insufficient Records':'Synthetic Model Score '+a.score.toFixed(2)+' (not a measured probability)'}</span></div>${a.score!==null?`<button class="linkbtn" data-inspect="${a.id}">Schedule Inspection ↗</button>`:''}</div>`).join('')}`;
    }

    function assistantPage() {
        return head('Operations Assistant', 'Query existing work orders and maintenance records.') + `<div class="two-col"><section class="card form-card"><div class="flex"><span class="ai-icon">${icon('spark')}</span><h2>Campus Maintenance Queries</h2></div><p class="subtitle">Choose one of the three supported queries. Results come from stored records.</p><div class="flex wrap" style="margin:20px 0">${['Which assets have repeated reports?','Which work orders are unassigned?','Which area has the most reports?'].map(q=>`<button class="tag-button" data-question="${q}">${q}</button>`).join('')}</div><form id="ask-form"><label for="ask-input">Your Question</label><div class="flex"><input id="ask-input" placeholder="e.g., Which assets have repeated reports?" required><button class="btn" type="submit">Search ${icon('arrow')}</button></div></form><div id="ask-answer"></div></section><aside class="card form-card"><h2>Model Connection</h2><div class="notice ${state.model.configured?'':'warning'}" style="margin-top:17px">${state.model.configured?'Ollama is configured. Try the reporting assistant to verify the connection.':'The assistant uses text-based rules and does not analyze photos.'}</div><p class="subtitle">An optional Ollama vision model can be configured on the server.</p><div class="ai-section"><h3>Capabilities and Limitations</h3><p class="small muted">Location: asset register search and user confirmation<br>Duplicate reports: same asset and  + text similarity<br>Forecasting: local model trained on synthetic events<br>Asset status: maintenance and verification records rather than sensor data</p></div></aside></div>`;
    }

    function bind() {
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
                $('#report-asset').innerHTML = '<option value="">Select an asset.</option>' + rows.map(a => `<option value="${a.id}">${esc(a.id)} · ${esc(a.name)}</option>`).join('');
                $('#asset-hint').textContent = 'Select an asset and confirm its location.';
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
                    if (draft.images.length + e.target.files.length > 3) throw Error('You can upload up to three photos.');
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
                if (!draft.asset_id || !draft.description.trim()) return toast('Select an asset and describe the issue.');
                e.currentTarget.disabled = true;
                e.currentTarget.textContent = 'Organizing your report…';
                try {
                    analysis = await api('/analyze', {...draft, language: typeof campusLocale !== 'undefined' ? campusLocale.language : 'en'});
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
                    toast('Report submitted and awaiting review.');
                    await openTicket(r.id);
                } catch (e) {
                    toast(e.message);
                    e.submitter.disabled = false;
                }
            };
        }
        $('#forecast-btn')?.addEventListener('click', async e => {
            e.currentTarget.disabled = true;
            e.currentTarget.textContent = 'Running the experiment…';
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
                $('#ask-answer').innerHTML = `<div class="chat-answer">${esc(r.answer)}</div><p class="tiny muted" style="margin-top:10px">${esc(r.mode)}</p><button class="linkbtn" style="margin-top:15px" data-page="tickets">View Work Order ↗</button>`;
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
        if (page === 'tickets') $('#tickets-body').innerHTML = ticketRows();
    }
    async function compressImage(file) {
        if (!['image/jpeg', 'image/png'].includes(file.type)) throw Error('Upload a JPEG or PNG photo.');
        if (file.size > 15 * 1024 * 1024) throw Error('Original photos must be 15 MB or smaller.');
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
        drawer(`<div class="drawer-head"><div><div class="eyebrow">ASSET PROFILE</div><h1>${esc(a.name)}</h1><div class="mono muted" style="margin-top:8px">${esc(a.id)}</div></div><button class="close" data-action="close" aria-label="Close">×</button></div><div class="detail-box"><div class="flex between">${badge(a.status)}<span class="small muted">${esc(a.category)}</span></div><p style="margin-top:15px">${esc(a.location_name)} / ${esc(a.room)} / ${esc(a.position)}</p><div class="small muted" style="margin-top:12px">Last verified: ${date(a.last_checked)}<br>Status source: ${esc(a.basis)}<br>Commissioned: ${esc(a.commissioned)} (demo)</div></div>${state.user.role!=='technician'?`<button class="btn" style="width:100%" data-report-asset="${a.id}">${icon('plus')} Report an Issue with This Asset</button>`:''}<div class="detail-box"><h2>Asset Reporting Link</h2><p class="small muted" style="margin-top:10px">The reporting link includes the asset’s registered location. A localhost link works only on this computer.</p><div class="qr-box"><img src="/api/qr?asset=${encodeURIComponent(a.id)}" alt="Asset Reporting QR Code"><div class="mono" style="margin-top:9px">${esc(a.id)}</div></div><button class="btn secondary" style="margin-top:12px;width:100%" data-copy-asset="${a.id}">Copy Reporting Link</button></div><div class="detail-box"><h2>Maintenance History</h2>${history.map(ticketRow).join('')||'<p class="subtitle">No work order history is available to your account.</p>'}</div>`);
    }
    async function openTicket(id) {
        try {
            const data = await api('/tickets/' + id),
                t = data.ticket,
                u = state.user,
                a = state.assets.find(a => a.id === t.asset_id),
                full = state.tickets.find(x => x.id === id);
            let actions = '';
            if (t.status === 'pending') actions += '<p class="notice warning">Waiting for an available specialist. Administrators can assign a technician or retry automatic dispatch.</p>';
            if (u.role === 'admin' && t.status === 'pending') actions += '<button class="btn secondary" id="retry-dispatch">Retry Automatic Dispatch</button>';
            if (u.role === 'admin' && ['pending', 'assigned', 'in_progress', 'waiting_parts'].includes(t.status)) actions += `<label for="assign-person">Assign or Reassign Technician</label><select id="assign-person">${state.technicians.map(p=>`<option value="${p.id}" ${p.id===t.assignee?'selected':''}>${esc(p.name)} · ${esc(p.skill)} · ${p.workload}  open work orders</option>`).join('')}</select><button class="btn" data-transition="assign" style="margin-top:12px">Confirm Assignment</button>`;
            if (u.role === 'technician') {
                if (t.status === 'assigned') actions += '<button class="btn" data-transition="start">Start Repair</button>';
                if (t.status === 'in_progress') actions += '<button class="btn secondary" data-transition="wait">Awaiting Parts</button> <button class="btn" data-transition="complete">Submit for Verification</button>';
                if (t.status === 'waiting_parts') actions += '<button class="btn" data-transition="resume">Resume Repair</button>';
            }
            if (u.role === 'admin' || t.reporter === u.id) {
                if (t.status === 'review') actions += '<button class="btn" data-transition="accept">Confirm Completion</button> ';
                if (['review', 'closed'].includes(t.status)) actions += '<button class="btn secondary" data-transition="reopen">Reopen Unresolved Issue</button> ';
                if (['pending', 'assigned'].includes(t.status) && !data.events.some(event => event.action === 'start')) actions += '<button class="btn danger" data-transition="cancel">Cancel Report</button>';
            }
            drawer(`<div class="drawer-head"><div><div class="eyebrow">WORK ORDER ${t.synthetic?'· Demo Record':''}</div><h2 style="font-size:22px;line-height:1.5">${esc(t.title)}</h2><div class="mono muted" style="margin-top:8px">${t.id}</div></div><button class="close" data-action="close" aria-label="Close">×</button></div><div class="flex">${badge(t.status)}${pri(t.priority)}</div><div class="detail-box"><div class="detail-label">Asset and Location</div><strong>${esc(a?.name||t.asset_id)}</strong><p class="small muted">${esc(a?.location_name||'')} / ${esc(a?.room||'')}<br>${esc(t.asset_id)}</p><div class="detail-label" style="margin-top:16px">Reported Issue</div><p>${esc(t.description).replace(/\n/g,'<br>')}</p><div class="flex between small muted" style="margin-top:16px"><span>Reported by: ${esc(full?.reporter_name||t.reporter)}</span><span>Assigned to: ${esc(full?.assignee_name||'Unassigned')}</span></div>${data.attachments.length?`<div class="photo-grid" style="margin-top:15px">${data.attachments.map(im=>`<a href="/api/attachments/${im.id}" target="_blank" rel="noopener"><img src="/api/attachments/${im.id}" alt="Report Photos"></a>`).join('')}</div>`:''}</div>${t.result?`<div class="detail-box"><div class="detail-label">Technician Findings</div><p>${esc(t.result)}</p></div>`:''}<div class="detail-box"><h3>Work Log</h3><label for="action-note">Notes or Findings</label><textarea id="action-note" placeholder="Record findings, steps taken, reasons for delays, or other details"></textarea><div class="flex wrap" style="margin-top:12px">${actions}</div><button class="linkbtn" data-transition="comment" style="margin-top:15px">Add Note</button><p class="tiny muted" style="margin-top:12px">Your access and the latest record version are checked before updates are saved.</p></div><div class="detail-box"><h3>Work Order History</h3><div class="timeline">${data.events.map(e=>`<div class="timeline-item"><div class="flex between"><strong>${esc(e.actor_name)}</strong><span class="tiny muted">${date(e.created)}</span></div><p>${esc(e.note)}</p><span class="tiny muted">${esc({created:'Submit Report',auto_assigned:'Automatically Assigned',dispatch_waiting:'Awaiting Specialist',assign:'Assigned',start:'Repair Started',wait:'Awaiting Parts',resume:'Repair Resumed',complete:'Submit for Verification',accept:'Completion Verified',reopen:'Reopened',comment:'Note Added',cancel:'Cancel Report',seed:'Initial Demo Record'}[e.action]||e.action)}</span></div>`).join('')}</div></div>`);
            $('#retry-dispatch')?.addEventListener('click', async event => {
                event.currentTarget.disabled = true;
                try {
                    await api('/dispatch/retry', {});
                    await refresh(); render(); await openTicket(t.id);
                } catch (error) { toast(error.message); event.target.disabled = false; }
            });
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
                    toast('Work order updated.');
                } catch (e) {
                    toast(e.message);
                    if (e.message.includes('Refresh')) {
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
        drawer(`<div class="drawer-head"><div><div class="eyebrow">ASSET MANAGEMENT</div><h2>${editing?'Update Asset Record':'Register an Asset'}</h2></div><button class="close" data-action="close" aria-label="Close">×</button></div><form id="asset-form"><label for="asset-name">Asset Name *</label><input id="asset-name" value="${esc(a?.name||'')}" required maxlength="80">${editing?`<p class="subtitle">Fixed ID and area: ${esc(a.id)} / ${esc(a.location_name)}</p>`:`<label for="asset-id">Unique ID *</label><input id="asset-id" placeholder="e.g., A-201-FAN-02" pattern="[A-Za-z0-9-]{4,48}" required><label for="asset-category">Category</label><select id="asset-category">${['Air Conditioner','Fan','Light Fixture','Streetlight','Computer','Projector','Furniture','Door Lock','Plumbing','Washing Machine','Water Dispenser','Fence','Road Surface'].map(c=>`<option>${c}</option>`).join('')}</select><label for="asset-location">Area</label><select id="asset-location">${state.locations.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select><label for="asset-room">Room or Public Area *</label><input id="asset-room" placeholder="e.g., A-201, D1-201, PUBLIC, or OUTDOOR" required><label for="asset-date">Commissioning Date (optional)</label><input type="date" id="asset-date">`}<label for="asset-position">Location Details</label><input id="asset-position" value="${esc(a?.position||'')}" placeholder="e.g., near the lectern or seventh light along the road" maxlength="100">${editing?`<label class="checkrow"><input id="asset-retired" type="checkbox" ${a.retired?'checked':''}>Retire this asset and retain its maintenance history</label>`:'<div class="notice" style="margin-top:18px">New assets remain unverified until their first inspection.</div>'}<button class="btn" style="margin-top:20px;width:100%" type="submit">Save Asset Record</button></form>`);
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
                toast('Asset record saved.');
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
            if (page === 'overview') {
                render();
                $('.dashboard-map')?.scrollIntoView({block: 'start'});
            } else go('overview');
        } else if (b.dataset.room) {
            selectedRoom = selectedRoom === b.dataset.room ? '' : b.dataset.room;
            render();
            $('.dashboard-map')?.scrollIntoView({block: 'start'});
        } else if (b.dataset.ticket) await openTicket(b.dataset.ticket);
        else if (b.dataset.asset) {
            await openAsset(b.dataset.asset);
            if (state.user.role === 'admin') $('.drawer .detail-box').insertAdjacentHTML('beforeend', `<div class="flex wrap" style="margin-top:15px"><button class="linkbtn" data-edit-asset="${b.dataset.asset}">Edit Asset Record</button><button class="linkbtn" data-inspect="${b.dataset.asset}">Schedule Inspection</button></div>`);
        } else if (b.dataset.editAsset) assetEditor(b.dataset.editAsset);
        else if (b.dataset.action === 'add-asset') assetEditor();
        else if (b.dataset.reportAsset) {
            closeDrawer();
            draft.asset_id = b.dataset.reportAsset;
            analysis = null;
            go('report');
        } else if (b.dataset.copyAsset) {
            await navigator.clipboard.writeText(location.origin + '/?asset=' + encodeURIComponent(b.dataset.copyAsset));
            toast('Asset link copied.');
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
            toast('You are following the work order. You can view progress and add notes.');
            await openTicket(b.dataset.follow);
        } else if (b.dataset.inspect) {
            await api('/inspections', {
                asset_id: b.dataset.inspect,
                note: 'Record the findings from the scheduled inspection.'
            });
            await refresh();
            closeDrawer();
            render();
            toast('Inspection scheduled.');
        } else if (b.dataset.inspectionComplete) {
            drawer(`<div class="drawer-head"><h2>Verify Inspection</h2><button class="close" data-action="close" aria-label="Close">×</button></div><label for="inspection-note">Inspection Findings</label><textarea id="inspection-note" placeholder="Record what you inspected and found. Create a work order if repairs are needed."></textarea><button class="btn" id="inspection-submit" style="margin-top:15px">Save Results</button>`);
            $('#inspection-submit').onclick = async () => {
                try {
                    await api('/inspections/complete', {
                        id: b.dataset.inspectionComplete,
                        note: $('#inspection-note').value
                    });
                    await refresh();
                    closeDrawer();
                    render();
                    toast('Inspection results saved.');
                } catch (e) {
                    toast(e.message);
                }
            };
        } else if (b.dataset.question) {
            $('#ask-input').value = b.dataset.question;
            $('#ask-form').requestSubmit($('#ask-form button'));
        } else if (b.dataset.action === 'geolocate') {
            $('#geo-result').textContent = 'Requesting location access…';
            if (!navigator.geolocation) throw Error('This browser does not support location access.');
            navigator.geolocation.getCurrentPosition(p => {
                $('#geo-result').textContent = `Coordinates: ${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}; Reported accuracy: approximately  ${Math.round(p.coords.accuracy)}  meters. Select the location on the illustrated campus map.`;
            }, err => {
                $('#geo-result').textContent = 'Location is unavailable or access was denied. Select a location on the map or enter the asset ID.';
            }, {
                timeout: 10000,
                maximumAge: 60000
            });
        } else if (b.dataset.action === 'locate-text') {
            let q = $('#location-query').value.toUpperCase().replace(/\s/g, '');
            let matches = state.assets.filter(a => [a.id, a.id.replaceAll('-', ''), a.name, a.location_name + a.room + a.name].some(s => s.toUpperCase().includes(q))).slice(0, 8);
            $('#location-results').innerHTML = q && matches.length ? matches.map(a => `<button class="tag-button" style="margin:4px" data-asset="${a.id}">${esc(a.id)} · ${esc(a.name)}</button>`).join('') : 'No unique match. Select a map area or enter the exact asset ID.';
        }
    }

    return {
        views: {map: mapPage, tickets: ticketsPage, report: reportPage,
            maintenance: maintenancePage, assistant: assistantPage, 'facility-overview': facilityOverview},
        bind, handle, reset, captureDraft,
        resetFilters: () => { filters = emptyFilters(); },
        seedReport: asset => { draft.asset_id = state.assets.some(a => a.id === asset) ? asset : ''; },
    };
})();
