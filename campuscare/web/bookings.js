'use strict';

const campusTime = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const bookingLabels = {
    available: ['可预约', 'green'], held: ['时段已占用', 'orange'], past: ['时段已开始', ''],
    pending: ['待审批', 'orange'], approved: ['已通过', 'green'],
    rejected: ['已驳回', 'red'], cancelled: ['已取消', ''], expired: ['已过期', '']
};

function bookingBadge(status) {
    const [label, color] = bookingLabels[status];
    return `<span class="badge ${color}">${label}</span>`;
}

function bookingTable(title, id, headers) {
    return `<section class="card" style="margin-bottom:20px">
        <div class="card-head"><h2>${title}</h2></div>
        <div class="table-wrap"><table aria-label="${title}">
            <thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead>
            <tbody id="${id}"><tr><td colspan="${headers.length}">正在加载…</td></tr></tbody>
        </table></div>
    </section>`;
}

function bookingsPage() {
    const isAdmin = state.user.role === 'admin';
    const title = isAdmin ? '场地预约审批' : '校园场地预约';
    const subtitle = isAdmin ? '审批学生和教师的场地申请，处理结果将通过站内通知发送给申请人。'
        : '查询教室、实验室、会议室和运动场馆的可用时段，并在线提交预约。';
    return head(title, subtitle, '<button class="btn secondary" id="booking-refresh">刷新状态</button>') +
        '<div id="booking-view"><p id="booking-feedback" role="status"></p>' + (isAdmin
            ? bookingTable('待审批申请', 'booking-queue', ['场地', '时段', '申请人', '用途', '操作'])
            : `<section class="card form-card" style="margin-bottom:20px">
                <h2>查询时段并申请</h2>
                <p class="subtitle">使用校园时间（UTC+8）。待审批的申请会暂时保留时段，开场时仍未审批则自动过期。</p>
                <form id="booking-form">
                    <div class="form-grid">
                        <div><label for="booking-start">开始时间</label><input type="datetime-local" id="booking-start" required></div>
                        <div><label for="booking-end">结束时间</label><input type="datetime-local" id="booking-end" required></div>
                        <div><label for="booking-venue">可预约场地</label><select id="booking-venue" required disabled><option value="">请选择场地</option></select></div>
                        <div><label for="booking-purpose">预约用途</label><input id="booking-purpose" maxlength="200" required></div>
                    </div>
                    <button class="btn" type="submit" id="booking-submit" style="margin-top:16px" disabled>提交预约</button>
                </form>
            </section>` +
            bookingTable('场地实时可用状态', 'booking-venues', ['场地', '类型', '位置', '容量', '所选时段']) +
            bookingTable('我的预约', 'booking-mine', ['场地', '时段', '用途', '状态', '操作']) +
            bookingTable('预约结果通知', 'booking-inbox', ['场地', '预约时段', '结果', '审批意见', '通知时间', '操作'])
        ) + '</div>';
}

function bookingSlot(item) {
    return `${esc(campusTime.format(new Date(item.start_at)))} 至 ${esc(campusTime.format(new Date(item.end_at)))}`;
}

function bindBookingsPage() {
    const view = $('#booking-view'), feedback = $('#booking-feedback'), refreshButton = $('#booking-refresh');
    const form = $('#booking-form'), start = $('#booking-start'), end = $('#booking-end');
    const venue = $('#booking-venue'), purpose = $('#booking-purpose'), submit = $('#booking-submit');
    const lastMarkup = new Map();
    let request = 0, saving = false;

    function show(id, html) {
        if (lastMarkup.get(id) === html) return;
        view.querySelector('#' + id).innerHTML = html;
        lastMarkup.set(id, html);
    }

    function rows(id, items, renderRow, columns, emptyText) {
        show(id, items.map(renderRow).join('') || `<tr><td colspan="${columns}">${emptyText}</td></tr>`);
    }

    function times() {
        return {start: start.value + '+08:00', end: end.value + '+08:00'};
    }

    function showVenues(venues, emptyText) {
        const selected = venue.value;
        const available = venues.filter(v => v.availability === 'available');
        show('booking-venue', '<option value="">请选择场地</option>' + available.map(v =>
            `<option value="${esc(v.id)}">${esc(v.name)}（${esc(v.category)}）</option>`).join(''));
        venue.value = available.some(v => v.id === selected) ? selected : '';
        venue.disabled = !available.length || saving;
        submit.disabled = venue.disabled;
        rows('booking-venues', venues, v => `<tr><td>${esc(v.name)}</td><td>${esc(v.category)}</td>
            <td>${esc(v.location)}</td><td>${v.capacity} 人</td><td>${bookingBadge(v.availability)}</td></tr>`,
            5, emptyText);
    }

    async function load(clearSlots = false) {
        const sequence = ++request;
        if (clearSlots) showVenues([], '正在查询所选时段…');
        const valid = form && start.value && end.value && end.value > start.value;
        const query = valid ? '?' + new URLSearchParams(times()) : '';
        try {
            const data = await api('/bookings' + query);
            if (!view.isConnected || sequence !== request) return;
            feedback.textContent = form && !valid ? '请选择有效时段，结束时间须晚于开始时间。' : '';
            if (!form) {
                rows('booking-queue', data.pending, b => `<tr><td>${esc(b.venue_name)}</td><td>${bookingSlot(b)}</td>
                    <td>${esc(b.requester_name)}（${esc(b.requester)}）</td><td class="booking-text">${esc(b.purpose)}</td>
                    <td><button class="linkbtn" data-booking-review="${esc(b.id)}">处理申请</button></td></tr>`,
                    5, '没有待审批的预约。');
                return;
            }
            showVenues(data.venues || [], '请选择有效时段后查看场地。');
            rows('booking-mine', data.bookings, b => `<tr><td>${esc(b.venue_name)}</td><td>${bookingSlot(b)}</td>
                <td class="booking-text">${esc(b.purpose)}</td><td>${bookingBadge(b.status)}</td><td>${b.can_cancel
                    ? `<button class="linkbtn" data-booking-cancel="${esc(b.id)}">取消预约</button>` : '—'}</td></tr>`,
                5, '尚未提交预约。');
            const inbox = data.bookings.filter(b => b.decision).sort((a, b) => b.decided_at.localeCompare(a.decided_at));
            rows('booking-inbox', inbox, b => `<tr><td>${esc(b.venue_name)}</td><td>${bookingSlot(b)}</td>
                <td>${bookingBadge(b.decision)}</td><td class="booking-text">${esc(b.review_note || '—')}</td>
                <td>${esc(campusTime.format(new Date(b.decided_at)))}</td><td>${b.read_at ? '已读'
                    : `<button class="linkbtn" data-booking-read="${esc(b.id)}">标为已读</button>`}</td></tr>`,
                6, '审批结果将在这里显示。');
        } catch (error) {
            if (!view.isConnected || sequence !== request) return;
            if (form) showVenues([], '加载失败，请刷新状态。');
            feedback.textContent = error.message;
        }
    }

    refreshButton.onclick = () => load();
    if (form) {
        const nextHour = Math.floor(Date.now() / 3600000 + 1) * 3600000;
        const campusInput = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 16);
        start.value = campusInput(nextHour);
        end.value = campusInput(nextHour + 3600000);
        start.onchange = end.onchange = () => load(true);
        form.onsubmit = async event => {
            event.preventDefault();
            if (saving || !venue.value) return;
            saving = submit.disabled = venue.disabled = true;
            const submittedPurpose = purpose.value;
            try {
                await api('/bookings', {...times(), venue_id: venue.value, purpose: submittedPurpose});
                if (view.isConnected) {
                    if (purpose.value === submittedPurpose) purpose.value = '';
                    toast('预约已提交，审批结果将通过站内通知告知。');
                }
            } catch (error) {
                if (view.isConnected) toast(error.message);
            } finally {
                saving = false;
                if (view.isConnected) await load();
            }
        };
    }

    view.onclick = async event => {
        const button = event.target.closest('button');
        if (!button) return;
        const {bookingReview, bookingRead, bookingCancel} = button.dataset;
        if (bookingReview) {
            openBookingReview(bookingReview, load);
            return;
        }
        if (!bookingRead && !bookingCancel) return;
        if (bookingCancel && !window.confirm('确认取消此预约并释放场地时段？')) return;
        button.disabled = true;
        try {
            await api(bookingRead ? '/bookings/read' : '/bookings/cancel', {id: bookingRead || bookingCancel});
            if (view.isConnected) await load();
        } catch (error) {
            if (view.isConnected) {
                toast(error.message);
                await load();
            }
        } finally {
            button.disabled = false;
        }
    };

    async function poll() {
        if (!view.isConnected) return;
        await load();
        if (view.isConnected) setTimeout(poll, 15000);
    }
    poll();
}

function openBookingReview(id, reload) {
    drawer(`<div class="drawer-head"><h2>处理场地预约</h2><button class="close" data-action="close" aria-label="关闭">×</button></div>
        <form id="booking-review-form">
            <label for="booking-decision">审批结果</label>
            <select id="booking-decision" required>
                <option value="">请选择审批结果</option>
                <option value="approved">通过</option><option value="rejected">驳回</option>
            </select>
            <label for="booking-note">审批意见（驳回时必填）</label>
            <textarea id="booking-note" maxlength="300"></textarea>
            <p id="booking-review-error" class="error" role="alert"></p>
            <button class="btn" type="submit">确认审批</button>
        </form>`);
    const form = $('#booking-review-form'), decision = $('#booking-decision');
    const note = $('#booking-note'), submit = form.querySelector('button[type="submit"]');
    const feedback = $('#booking-review-error');
    decision.onchange = () => { note.required = decision.value === 'rejected'; };
    form.onsubmit = async event => {
        event.preventDefault();
        if (submit.disabled) return;
        submit.disabled = true;
        try {
            await api('/bookings/review', {id, decision: decision.value, note: note.value});
            if (form.isConnected) {
                closeDrawer();
                toast('审批已保存，结果已发送给申请人。');
            }
            await reload();
        } catch (error) {
            if (form.isConnected) feedback.textContent = error.message;
        } finally {
            submit.disabled = false;
        }
    };
}
