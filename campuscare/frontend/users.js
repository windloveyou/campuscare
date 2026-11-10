// User directory is requested only by administrators, never included in bootstrap.
const userRoles = {user:'Campus Member', technician:'Technicians', admin:'Administrator'};
const userFieldLabels = {name:'Full Name',role:'Role',identity:'Campus Affiliation',room:'Residence',skill:'Maintenance Specialty',student_no:'Student or Staff ID',class_name:'Class',department:'Department',enabled:'Account Status'};
let usersQuery = {q:'',role:'',enabled:'',page:1}, usersRequest = 0;
function clearUsersView() { usersQuery = {q:'',role:'',enabled:'',page:1}; usersRequest++; }
function usersPage() {
    return head('User Management','Verify campus affiliation, assign access, and review account changes.','<button class="btn" id="user-create">＋ New User</button>') +
        `<div class="stats" id="users-summary"></div><form class="toolbar" id="users-search-form">
        <input id="users-search" aria-label="Search Users" placeholder="Name, username, email, ID, or class" value="${esc(usersQuery.q)}">
        <select id="users-role" aria-label="Filter by Role"><option value="">All Roles</option>${Object.entries(userRoles).map(([k,v])=>`<option value="${k}" ${usersQuery.role===k?'selected':''}>${v}</option>`).join('')}</select>
        <select id="users-enabled" aria-label="Filter by Account Status"><option value="">All Statuses</option><option value="1" ${usersQuery.enabled==='1'?'selected':''}>Active</option><option value="0" ${usersQuery.enabled==='0'?'selected':''}>Inactive</option></select><button class="btn secondary" type="submit">Search</button></form>
        <p id="users-feedback" role="status"></p><div class="card table-wrap"><table><thead><tr><th>Name and Username</th><th>Affiliation and Role</th><th>Campus Details</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead><tbody id="users-body"><tr><td colspan="6">Loading users…</td></tr></tbody></table></div>
        <div class="flex between" style="margin-top:18px"><span id="users-total" class="subtitle"></span><div class="flex"><button class="btn secondary" id="users-prev">Previous</button><button class="btn secondary" id="users-next">Next</button></div></div>
        <p class="subtitle">Students and faculty can verify their email when registering. Administrators must share initial passwords privately. Deactivating an account preserves its work orders.</p>`;
}
function bindUsersPage() {
    $('#users-search-form').onsubmit = e => {e.preventDefault(); usersQuery={q:$('#users-search').value,role:$('#users-role').value,enabled:$('#users-enabled').value,page:1}; loadUsers();};
    $('#users-prev').onclick = ()=>{usersQuery.page--;loadUsers();};
    $('#users-next').onclick = ()=>{usersQuery.page++;loadUsers();};
    $('#user-create').onclick = ()=>openUserEditor();
    const deleteButton = document.createElement('button');
    deleteButton.className = 'btn secondary';
    deleteButton.textContent = 'Delete Record';
    $('#user-create').after(deleteButton);
    deleteButton.onclick = () => {
        drawer(`<h2>Delete Record</h2><p>Deletion is permanent. Records with related history may require deactivation instead.</p><form id="delete-record-form"><label>Record type<select name="kind"><option value="user">User</option><option value="certificate">Certificate Request</option><option value="application">Pre-review Application</option><option value="booking">Venue Booking</option><option value="ticket">Work Order</option></select></label><label>Record ID<input name="id" required></label><button class="btn" type="submit">Delete</button></form>`);
        $('#delete-record-form').onsubmit = async event => {
            event.preventDefault();
            const body = Object.fromEntries(new FormData(event.target));
            if (!confirm(`Permanently delete ${body.kind} ${body.id}?`)) return;
            try { await api('/delete-record', body); closeDrawer(); toast('Record deleted.'); loadUsers(); }
            catch (error) { toast(error.message); }
        };
    };
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
        $('#users-summary').innerHTML=[['All Users',s.total],['Active',s.enabled],['Technicians',s.technicians],['Administrator',s.admins]].map(([label,n])=>`<div class="stat card"><div class="small muted">${label}</div><h2 style="margin-top:12px">${n}</h2></div>`).join('');
        body.innerHTML=response.users.map(u=>`<tr><td><strong>${esc(u.name)}</strong><div class="small muted">${esc(u.id)}</div></td><td>${esc(u.identity)}<div class="small muted">${userRoles[u.role]}</div></td><td>${esc(u.student_no||'No student or staff ID')}<div class="small muted">${esc([u.class_name,u.department,u.room,u.skill].filter(Boolean).join(' · ')||'No additional details')}</div></td><td>${esc(u.email||'Not linked')}<div class="small muted">${u.email_verified?'Verified':'Unverified'}</div></td><td><span class="badge ${u.enabled?'green':'orange'}">${u.enabled?'Active':'Inactive'}</span></td><td><button class="linkbtn" data-edit-user="${esc(u.id)}">Manage</button></td></tr>`).join('')||'<tr><td colspan="6">No users match these filters.</td></tr>';
        body.querySelectorAll('[data-edit-user]').forEach(b=>b.onclick=()=>openUserEditor(b.dataset.editUser));
        $('#users-total').textContent=`Total:  ${response.total}  users · Page  ${response.page} / ${Math.max(1,Math.ceil(response.total/response.page_size))} `;
        $('#users-prev').disabled=response.page<=1; $('#users-next').disabled=response.page*response.page_size>=response.total;
    } catch(e) {if(document.body.contains(body)) {body.innerHTML='<tr><td colspan="6">Could not load users. Try searching again.</td></tr>';$('#users-feedback').textContent=e.message;}}
}
async function openUserEditor(uid) {
    drawer('<div class="drawer-head"><h2>User Management</h2><button class="close" data-action="close" aria-label="Close">×</button></div><p id="user-loading">Loading account details…</p>');
    const marker=$('#user-loading'); let response;
    try {response=await api(uid?'/users/'+encodeURIComponent(uid):'/users');}
    catch(e){if(document.body.contains(marker)) marker.textContent=e.message;return;}
    if(!document.body.contains(marker))return;
    const u=response.user||{role:'user',identity:'Student',enabled:1}, own=uid===state.user.id;
    drawer(`<div class="drawer-head"><div><div class="eyebrow">CAMPUS ACCOUNTS</div><h2>${uid?'Manage User · '+esc(u.name):'Create Campus User'}</h2></div><button class="close" data-action="close" aria-label="Close">×</button></div>
        ${uid?`<p class="subtitle">Account: ${esc(uid)} · ${u.enabled?'Active':'Inactive'}<br>Email: ${esc(u.email||'Not linked')} (${u.email_verified?'Verified':'Unverified'})${u.open_tasks?`<br>This technician has  ${u.open_tasks}  open work orders. Resolve them before deactivating the account or changing its role.`:''}</p>`:'<p class="subtitle">Students and faculty can also register and verify their email. Accounts created here have no linked email. Share the initial password privately.</p>'}
        <form id="user-editor" class="mail-settings-form"><div class="form-grid">
        ${!uid?'<div><label for="user-username">Username *</label><input id="user-username" pattern="[a-zA-Z][a-zA-Z0-9_]{3,31}" maxlength="32" required autocomplete="off"></div>':''}
        <div><label for="user-name">Full Name *</label><input id="user-name" value="${esc(u.name||'')}" minlength="2" maxlength="50" required></div>
        <div><label for="user-role">Role *</label><select id="user-role" ${own?'disabled':''}>${Object.entries(userRoles).map(([k,v])=>`<option value="${k}" ${u.role===k?'selected':''}>${v}</option>`).join('')}</select></div>
        <div id="user-identity-wrap"><label for="user-identity">Campus Affiliation</label><select id="user-identity"><option ${u.identity==='Student'?'selected':''}>Student</option><option ${u.identity==='Faculty'?'selected':''}>Faculty</option></select></div>
        <div><label for="user-number">Student or Staff ID</label><input id="user-number" value="${esc(u.student_no||'')}" pattern="[A-Za-z0-9-]{3,30}" maxlength="30"></div>
        <div><label for="user-class">Class</label><input id="user-class" value="${esc(u.class_name||'')}" maxlength="80"></div>
        <div><label for="user-department">School or Department</label><input id="user-department" value="${esc(u.department||'')}" maxlength="80"></div>
        <div id="user-room-wrap"><label for="user-room">Verified Residence Room</label><select id="user-room"><option value="">No access to private residence rooms</option>${response.rooms.map(r=>`<option ${u.room===r?'selected':''}>${esc(r)}</option>`).join('')}</select></div>
        <div id="user-skill-wrap"><label for="user-skill">Maintenance Specialty *</label><input id="user-skill" value="${esc(u.skill||'')}" placeholder="e.g., electrical, plumbing, or IT" maxlength="80"></div>
        <div><label for="user-enabled">Account Status</label><select id="user-enabled" ${own?'disabled':''}><option value="1" ${u.enabled?'selected':''}>Active</option><option value="0" ${!u.enabled?'selected':''}>Inactive</option></select></div></div>
        ${!uid?'<label for="user-initial-password">Initial Password *</label><input id="user-initial-password" type="password" minlength="10" maxlength="128" autocomplete="new-password" required placeholder="At least 10 characters, including letters and numbers">':''}
        <label for="user-note">Reason for Change</label><input id="user-note" maxlength="300" placeholder="e.g., enrollment and residence verified">
        <p class="subtitle">Roles control access. Verify residence details before granting room access. Editing an existing account signs that user out of all sessions.${own?'Sign in again after changing your own details.':''}</p>
        <p id="user-error" class="error" role="alert"></p><button class="btn" type="submit">${uid?'Save User Details':'Create User'}</button></form>
        ${uid?'<details class="detail-box"><summary>Reset Password</summary><form id="user-password-form" class="mail-settings-form"><p class="subtitle">Verify the account holder’s identity first. Share the new password privately. A reset invalidates active sessions and recovery codes.</p><label for="user-new-password">New Password</label><input type="password" id="user-new-password" minlength="10" maxlength="128" autocomplete="new-password" required><label for="user-confirm-password">Confirm New Password</label><input type="password" id="user-confirm-password" minlength="10" maxlength="128" autocomplete="new-password" required><p class="error" id="user-password-error" role="alert"></p><button class="btn secondary" type="submit">Confirm Password Reset</button></form></details><h3 style="margin-top:24px">Recent Account Activity</h3><div id="user-history"></div>':''}`);
    const form=$('#user-editor'), role=$('#user-role'), error=$('#user-error');
    const sync=()=>{
        const regular=role.value==='user', student=regular&&$('#user-identity').value==='Student';
        $('#user-identity-wrap').hidden=!regular;$('#user-room-wrap').hidden=!regular;$('#user-skill-wrap').hidden=role.value!=='technician';
        $('#user-skill').required=role.value==='technician';
        const needsStudent=student&&(!uid||!!u.class_name||u.role!=='user'||u.identity!=='Student');
        $('#user-number').required=needsStudent;$('#user-class').required=needsStudent;
    };
    role.onchange=sync;$('#user-identity').onchange=sync;sync();
    const done=async result=>{
        if(!document.body.contains(form))return;
        if(own){clearSession();toast(result.message);openLogin({role:'admin'},true);$('#account').value=uid;$('#password').value='';return;}
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
        const display=(key,v)=>key==='role'?(userRoles[v]||'—'):key==='enabled'?(v===null?'—':v?'Active':'Inactive'):v||'—';
        $('#user-history').innerHTML=response.events.map(event=>`<div class="detail-box"><strong>${{create:'Account Created',update:'Details Updated',password:'Password Reset'}[event.action]||esc(event.action)}</strong><p class="small muted">${esc(event.actor_name)} · ${date(event.created)}</p>${Object.entries(event.changes).map(([k,v])=>`<p class="small">${esc(userFieldLabels[k]||k)}: ${esc(display(k,v.before))} → ${esc(display(k,v.after))}</p>`).join('')}${event.note?`<p>${esc(event.note)}</p>`:''}</div>`).join('')||'<p class="subtitle">No administrator activity yet.</p>';
        $('#user-password-form').onsubmit=async e=>{
            e.preventDefault();const err=$('#user-password-error'),secret=$('#user-new-password').value;err.textContent='';
            if(secret!==$('#user-confirm-password').value){err.textContent='The passwords do not match.';return;}
            const b=e.submitter;b.disabled=true;
            try{await done(await api('/users/'+encodeURIComponent(uid)+'/password',{version:u.version,password:secret,note:'Password reset after identity verification.'}));}catch(e){err.textContent=e.message;}finally{b.disabled=false;}
        };
    }
}
