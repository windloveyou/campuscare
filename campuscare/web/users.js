// User directory is requested only by administrators, never included in bootstrap.
const userRoles = {user:'普通用户', technician:'维修人员', admin:'管理员'};
const userFieldLabels = {name:'姓名',role:'角色',identity:'身份',room:'宿舍',skill:'维修专长',student_no:'学号 / 工号',class_name:'班级',department:'院系',enabled:'账号状态'};
let usersQuery = {q:'',role:'',enabled:'',page:1}, usersRequest = 0;
function clearUsersView() { usersQuery = {q:'',role:'',enabled:'',page:1}; usersRequest++; }
function usersPage() {
    return head('用户管理','核实校园身份、分配访问权限，并保留每一次管理操作。','<button class="btn" id="user-create">＋ 新建用户</button>') +
        `<div class="stats" id="users-summary"></div><form class="toolbar" id="users-search-form">
        <input id="users-search" aria-label="搜索用户" placeholder="姓名、账号、邮箱、学号或班级" value="${esc(usersQuery.q)}">
        <select id="users-role" aria-label="筛选角色"><option value="">全部角色</option>${Object.entries(userRoles).map(([k,v])=>`<option value="${k}" ${usersQuery.role===k?'selected':''}>${v}</option>`).join('')}</select>
        <select id="users-enabled" aria-label="筛选账号状态"><option value="">全部状态</option><option value="1" ${usersQuery.enabled==='1'?'selected':''}>启用</option><option value="0" ${usersQuery.enabled==='0'?'selected':''}>停用</option></select><button class="btn secondary" type="submit">查询</button></form>
        <p id="users-feedback" role="status"></p><div class="card table-wrap"><table><thead><tr><th>姓名 / 账号</th><th>身份 / 角色</th><th>校园资料</th><th>邮箱</th><th>状态</th><th>操作</th></tr></thead><tbody id="users-body"><tr><td colspan="6">正在加载用户…</td></tr></tbody></table></div>
        <div class="flex between" style="margin-top:18px"><span id="users-total" class="subtitle"></span><div class="flex"><button class="btn secondary" id="users-prev">上一页</button><button class="btn secondary" id="users-next">下一页</button></div></div>
        <p class="subtitle">学生和教师可通过注册验证邮箱。管理员创建的账号由本人领取初始密码；邮箱验证状态不可直接修改。停用账号保留历史工单。</p>`;
}
function bindUsersPage() {
    $('#users-search-form').onsubmit = e => {e.preventDefault(); usersQuery={q:$('#users-search').value,role:$('#users-role').value,enabled:$('#users-enabled').value,page:1}; loadUsers();};
    $('#users-prev').onclick = ()=>{usersQuery.page--;loadUsers();};
    $('#users-next').onclick = ()=>{usersQuery.page++;loadUsers();};
    $('#user-create').onclick = ()=>openUserEditor();
    loadUsers();
}
async function loadUsers() {
    const request = ++usersRequest, body = $('#users-body');
    $('#users-feedback').textContent=''; $('#users-prev').disabled=true; $('#users-next').disabled=true;
    try {
        const response = await api('/users?'+new URLSearchParams(usersQuery));
        if (request!==usersRequest || !document.body.contains(body)) return;
        usersQuery.page=response.page;
        const s=response.summary;
        $('#users-summary').innerHTML=[['全部用户',s.total],['已启用',s.enabled],['维修人员',s.technicians],['管理员',s.admins]].map(([label,n])=>`<div class="stat card"><div class="small muted">${label}</div><h2 style="margin-top:12px">${n}</h2></div>`).join('');
        body.innerHTML=response.users.map(u=>`<tr><td><strong>${esc(u.name)}</strong><div class="small muted">${esc(u.id)}</div></td><td>${esc(u.identity)}<div class="small muted">${userRoles[u.role]}</div></td><td>${esc(u.student_no||'未填写学号/工号')}<div class="small muted">${esc([u.class_name,u.department,u.room,u.skill].filter(Boolean).join(' · ')||'未填写其他资料')}</div></td><td>${esc(u.email||'未绑定')}<div class="small muted">${u.email_verified?'已验证':'未验证'}</div></td><td><span class="badge ${u.enabled?'green':'orange'}">${u.enabled?'启用':'停用'}</span></td><td><button class="linkbtn" data-edit-user="${esc(u.id)}">管理</button></td></tr>`).join('')||'<tr><td colspan="6">没有符合条件的用户，请调整筛选条件。</td></tr>';
        body.querySelectorAll('[data-edit-user]').forEach(b=>b.onclick=()=>openUserEditor(b.dataset.editUser));
        $('#users-total').textContent=`共 ${response.total} 位用户 · 第 ${response.page} / ${Math.max(1,Math.ceil(response.total/response.page_size))} 页`;
        $('#users-prev').disabled=response.page<=1; $('#users-next').disabled=response.page*response.page_size>=response.total;
    } catch(e) {if(document.body.contains(body)) {body.innerHTML='<tr><td colspan="6">加载失败，请重新查询。</td></tr>';$('#users-feedback').textContent=e.message;}}
}
async function openUserEditor(uid) {
    drawer('<div class="drawer-head"><h2>用户管理</h2><button class="close" data-action="close" aria-label="关闭">×</button></div><p id="user-loading">正在读取资料…</p>');
    const marker=$('#user-loading'); let response;
    try {response=await api(uid?'/users/'+encodeURIComponent(uid):'/users');}
    catch(e){if(document.body.contains(marker)) marker.textContent=e.message;return;}
    if(!document.body.contains(marker))return;
    const u=response.user||{role:'user',identity:'学生',enabled:1}, own=uid===state.user.id;
    drawer(`<div class="drawer-head"><div><div class="eyebrow">CAMPUS ACCOUNTS</div><h2>${uid?'管理用户 · '+esc(u.name):'新建校园用户'}</h2></div><button class="close" data-action="close" aria-label="关闭">×</button></div>
        ${uid?`<p class="subtitle">账号：${esc(uid)} · ${u.enabled?'已启用':'已停用'}<br>邮箱：${esc(u.email||'未绑定')}（${u.email_verified?'已验证':'未验证'}）${u.open_tasks?`<br>当前负责 ${u.open_tasks} 条未完成工单，停用或调整角色前需先处理。`:''}</p>`:'<p class="subtitle">学生和教师也可自行注册并验证邮箱。此处创建的账号不绑定邮箱，需将初始密码私下交给本人。</p>'}
        <form id="user-editor" class="mail-settings-form"><div class="form-grid">
        ${!uid?'<div><label for="user-username">用户名 *</label><input id="user-username" pattern="[a-zA-Z][a-zA-Z0-9_]{3,31}" maxlength="32" required autocomplete="off"></div>':''}
        <div><label for="user-name">姓名 *</label><input id="user-name" value="${esc(u.name||'')}" minlength="2" maxlength="50" required></div>
        <div><label for="user-role">角色 *</label><select id="user-role" ${own?'disabled':''}>${Object.entries(userRoles).map(([k,v])=>`<option value="${k}" ${u.role===k?'selected':''}>${v}</option>`).join('')}</select></div>
        <div id="user-identity-wrap"><label for="user-identity">用户身份</label><select id="user-identity"><option ${u.identity==='学生'?'selected':''}>学生</option><option ${u.identity==='教师'?'selected':''}>教师</option></select></div>
        <div><label for="user-number">学号 / 工号</label><input id="user-number" value="${esc(u.student_no||'')}" pattern="[A-Za-z0-9-]{3,30}" maxlength="30"></div>
        <div><label for="user-class">班级</label><input id="user-class" value="${esc(u.class_name||'')}" maxlength="80"></div>
        <div><label for="user-department">学院 / 部门</label><input id="user-department" value="${esc(u.department||'')}" maxlength="80"></div>
        <div id="user-room-wrap"><label for="user-room">已核实的宿舍房间</label><select id="user-room"><option value="">不授予私人宿舍权限</option>${response.rooms.map(r=>`<option ${u.room===r?'selected':''}>${esc(r)}</option>`).join('')}</select></div>
        <div id="user-skill-wrap"><label for="user-skill">维修专长 *</label><input id="user-skill" value="${esc(u.skill||'')}" placeholder="例如 电工、水务、IT" maxlength="80"></div>
        <div><label for="user-enabled">账号状态</label><select id="user-enabled" ${own?'disabled':''}><option value="1" ${u.enabled?'selected':''}>启用</option><option value="0" ${!u.enabled?'selected':''}>停用</option></select></div></div>
        ${!uid?'<label for="user-initial-password">初始密码 *</label><input id="user-initial-password" type="password" minlength="10" maxlength="128" autocomplete="new-password" required placeholder="至少10位，包含字母与数字">':''}
        <label for="user-note">操作说明</label><input id="user-note" maxlength="300" placeholder="例如：已核实学籍及入住信息">
        <p class="subtitle">角色决定访问范围；宿舍权限需核实后分配。修改现有用户将撤销其旧登录会话。${own?'修改自己的资料后需要重新登录。':''}</p>
        <p id="user-error" class="error" role="alert"></p><button class="btn" type="submit">${uid?'保存用户资料':'创建用户'}</button></form>
        ${uid?'<details class="detail-box"><summary>重置登录密码</summary><form id="user-password-form" class="mail-settings-form"><p class="subtitle">请先核实本人身份。新密码需私下交给本人；重置后旧会话和找回密码验证码失效。</p><label for="user-new-password">新密码</label><input type="password" id="user-new-password" minlength="10" maxlength="128" autocomplete="new-password" required><label for="user-confirm-password">再次输入新密码</label><input type="password" id="user-confirm-password" minlength="10" maxlength="128" autocomplete="new-password" required><p class="error" id="user-password-error" role="alert"></p><button class="btn secondary" type="submit">确认重置密码</button></form></details><h3 style="margin-top:24px">最近管理记录</h3><div id="user-history"></div>':''}`);
    const form=$('#user-editor'), role=$('#user-role'), error=$('#user-error');
    const sync=()=>{
        const regular=role.value==='user', student=regular&&$('#user-identity').value==='学生';
        $('#user-identity-wrap').hidden=!regular;$('#user-room-wrap').hidden=!regular;$('#user-skill-wrap').hidden=role.value!=='technician';
        $('#user-skill').required=role.value==='technician';
        const needsStudent=student&&(!uid||!!u.class_name||u.role!=='user'||u.identity!=='学生');
        $('#user-number').required=needsStudent;$('#user-class').required=needsStudent;
    };
    role.onchange=sync;$('#user-identity').onchange=sync;sync();
    const done=async result=>{
        if(!document.body.contains(form))return;
        if(own){clearSession();toast(result.message);renderLogin();$('#account').value=uid;$('#password').value='';return;}
        await refresh();
        if(document.body.contains(form))closeDrawer();
        toast(result.message);if(page==='users')render();
    };
    form.onsubmit=async e=>{
        e.preventDefault();error.textContent='';
        const body={name:$('#user-name').value,role:role.value,identity:$('#user-identity').value,student_no:$('#user-number').value,class_name:$('#user-class').value,department:$('#user-department').value,room:$('#user-room').value,skill:$('#user-skill').value,enabled:Number($('#user-enabled').value),note:$('#user-note').value};
        if(uid)body.version=u.version;else Object.assign(body,{username:$('#user-username').value,password:$('#user-initial-password').value});
        const b=e.submitter;b.disabled=true;
        try{await done(await api(uid?'/users/'+encodeURIComponent(uid):'/users',body));}catch(e){error.textContent=e.message;}finally{b.disabled=false;}
    };
    if(uid){
        const display=(key,v)=>key==='role'?(userRoles[v]||'—'):key==='enabled'?(v===null?'—':v?'启用':'停用'):v||'—';
        $('#user-history').innerHTML=response.events.map(event=>`<div class="detail-box"><strong>${{create:'创建账号',update:'修改资料',password:'重置密码'}[event.action]||esc(event.action)}</strong><p class="small muted">${esc(event.actor_name)} · ${date(event.created)}</p>${Object.entries(event.changes).map(([k,v])=>`<p class="small">${esc(userFieldLabels[k]||k)}：${esc(display(k,v.before))} → ${esc(display(k,v.after))}</p>`).join('')}${event.note?`<p>${esc(event.note)}</p>`:''}</div>`).join('')||'<p class="subtitle">暂无管理员操作记录。</p>';
        $('#user-password-form').onsubmit=async e=>{
            e.preventDefault();const err=$('#user-password-error'),secret=$('#user-new-password').value;err.textContent='';
            if(secret!==$('#user-confirm-password').value){err.textContent='两次密码不一致';return;}
            const b=e.submitter;b.disabled=true;
            try{await done(await api('/users/'+encodeURIComponent(uid)+'/password',{version:u.version,password:secret,note:'管理员核实身份后重置密码'}));}catch(e){err.textContent=e.message;}finally{b.disabled=false;}
        };
    }
}
