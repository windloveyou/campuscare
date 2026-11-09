'use strict';
const $ = s => document.querySelector(s),
    $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
} [c]));
const icons = {
    grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16',
    box: 'm12 3 9 5-9 5-9-5z M3 8v10l9 5 9-5V8 M12 13v10',
    ticket: 'M5 3h14v18l-4-2-3 2-3-2-4 2z M8 8h8 M8 12h8',
    spark: 'm12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8z',
    plus: 'M12 5v14 M5 12h14',
    arrow: 'M5 12h14 m-5-5 5 5-5 5',
    pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    tool: 'M14 6a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-4-4z',
    clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2',
    check: 'm5 12 4 4 10-10',
    chart: 'M4 20V10 M11 20V4 M18 20v-8 M2 21h20',
    logout: 'M10 4H4v16h6 M9 12h12 m-4-4 4 4-4 4',
    image: 'M3 3h18v18H3z m0 13 5-5 5 5 3-3 5 5 M15 8h.01',
    search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0 m-2 4 7 7',
    leaf: 'M19 3C7 2 3 8 5 14s15 5 14-11 M5 20 15 8',
    users: 'M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 21v-3a7 7 0 0 1 14 0v3',
    bell: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 21h4'
};
const icon = name => `<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${icons[name]||icons.box}"/></svg></span>`;
const labels = {
    pending: '待确认',
    assigned: '已派单',
    in_progress: '维修中',
    waiting_parts: '等待配件',
    review: '待验收',
    closed: '已完成',
    cancelled: '已取消',
    normal: '记录正常',
    unknown: '待核实',
    retired: '已停用'
};
const badge = s => `<span class="badge ${['normal','closed'].includes(s)?'green':['pending','waiting_parts'].includes(s)?'orange':['assigned','in_progress','review'].includes(s)?'blue':''}">${labels[s]||esc(s)}</span>`;
const pri = p => `<span class="badge ${p==='high'?'red':p==='medium'?'orange':''}">${{high:'高优先',medium:'普通',low:'低优先'}[p]||p}</span>`;
const date = d => d ? new Date(d).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
}) : '未记录';
function drawer(html) {
    $('#modal-root').innerHTML = `<div class="drawer-backdrop"><section class="drawer" role="dialog" aria-modal="true" aria-label="详情">${html}</section></div>`;
    document.body.style.overflow = 'hidden';
    $('.drawer .close')?.focus();
}

function closeDrawer() {
    $('#modal-root').innerHTML = '';
    document.body.style.overflow = '';
}

function toast(message) {
    const box = $('#toast');
    box.textContent = message;
    box.classList.add('show');
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => box.classList.remove('show'), 3500);
}
