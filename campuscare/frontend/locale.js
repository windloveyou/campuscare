'use strict';
// Local UI labels only. User input and stored records keep their original language.
const campusLocale = (() => {
    const zh = {
        'Dashboard':'工作台','Campus Map':'校园地图','Campus Services':'校园服务','Campus Sign In':'校园登录',
        'Intelligent Learning Support':'智能学习支持','Facility & Resource Management':'设施与资源管理','Administrative Services':'行政服务',
        '01 · Intelligent Q&A':'01 · 智能问答','02 · Academic Risk Warning':'02 · 学业风险预警',
        '03 · Maintenance & Repair':'03 · 设施维护与报修','04 · Venue Booking':'04 · 场地预约',
        '05 · Certificate Requests':'05 · 证明申请','06 · Application Pre-review':'06 · 材料预审',
        'Intelligent Q&A':'智能问答','Intelligent Q&A Assistant':'智能问答助手','Academic Risk':'学业风险','Academic Risk Warning':'学业风险预警',
        'Report a Facility Issue':'设施报修','Report an Issue':'提交报修','Work Orders':'维修工单','My Maintenance Tasks':'我的维修任务',
        'Venue Booking':'场地预约','Facilities Overview':'设施概览','Maintenance and Forecasting':'维护与预测','Operations Assistant':'运维助手',
        'Application Pre-review':'材料预审','Application Review':'申请审核','User Management':'人员管理','Platform Administration':'平台管理',
        'Student and Faculty Services':'师生服务','Campus Operations':'校园运维','Maintenance Workspace':'维修工作区',
        'Student Services':'学生服务','Faculty Services':'教职工服务','Maintenance Tasks':'维修任务','Explore by subsystem':'按子系统浏览',
        'YOUR WORKSPACE':'我的工作台','SUBSYSTEM 01':'子系统 01','SUBSYSTEM 02':'子系统 02','SUBSYSTEM 03':'子系统 03',
        'Find answers and stay connected to your studies.':'查询校园信息，了解学习参与情况。',
        'Report issues, track repairs, and reserve campus spaces.':'提交设施问题、跟踪维修、预约校园场地。',
        'Request certificates, check materials, and follow progress.':'申请证明、检查材料、跟踪办理进度。',
        'Request a Transcript':'申请成绩单','Transcript Request':'成绩单申请','Proof of Enrollment':'在读证明','View Applications':'查看申请',
        'My Activity':'我的动态','Track requests available to your account.':'查看当前账号的申请及处理状态。',
        'Open Work Orders':'未完成工单','View Work Orders':'查看工单','Additional Documents Required':'需要补交材料',
        'Find a Service':'查找服务','Profile':'个人资料','Sign out':'退出登录','Notices':'通知','Email Settings':'邮件设置',
        'Campus Operations Overview':'校园运维概览','Open Review Queue':'打开审核队列','Applications Pending Review':'待审核申请',
        'Reports Awaiting Review':'待处理报修','Inspections Awaiting Review':'待验收巡检','Operations Workspace':'运维工作区',
        'Administrators only':'仅管理员可用','Home':'首页','About':'关于','Service Directory':'服务目录','Campus Gallery':'校园相册',
        'All Subsystems':'全部子系统','Open Service':'进入服务','Campus Service Directory':'校园服务目录','Overview':'概览',
        'Students and Faculty':'学生与教职工','Students':'学生','Student':'学生','Faculty':'教职工','Campus Members':'校园成员',
        'Technicians':'维修人员','Administrators':'管理员','Administrator':'管理员','Campus Member':'校园成员',
        'Username or Email':'用户名或邮箱','Password':'密码','Show':'显示','Hide':'隐藏','Sign In':'登录',
        'Create an account':'注册账号','Forgot your password?':'忘记密码？','← Back to Home':'← 返回首页','Account type':'账号类型',
        'Full Name':'姓名','Account':'账号','Campus Affiliation':'身份','Class':'班级','School or Department':'学院或部门',
        'Student or Staff ID':'学号或工号','Email':'邮箱','Status':'状态','Actions':'操作','Action':'操作','Search':'搜索',
        'Previous':'上一页','Next':'下一页','New User':'新增人员','＋ New User':'＋ 新增人员','Manage':'管理','Delete Record':'删除记录',
        'Record type':'记录类型','Record ID':'记录编号','Delete':'删除','Save':'保存','Cancel':'取消','Close':'关闭',
        'Active':'启用','Inactive':'停用','All Users':'全部人员','All Roles':'全部角色','All Statuses':'全部状态',
        'Name and Username':'姓名与用户名','Affiliation and Role':'身份与角色','Campus Details':'校园信息','Verified':'已验证','Unverified':'未验证',
        'Pending':'待处理','Pending Review':'待审核','Approved':'已批准','Rejected':'已拒绝','Canceled':'已取消','Cancelled':'已取消',
        'Assigned':'已派单','In Progress':'维修中','Awaiting Parts':'等待配件','Awaiting Verification':'待验收','Completed':'已完成',
        'Campus Venue Booking':'校园场地预约','Refresh':'刷新','Check a Time Slot and Apply':'查询时段并申请',
        'Start Time':'开始时间','End Time':'结束时间','Available Venue':'可用场地','Select a venue':'选择场地',
        'Purpose':'用途','Submit Request':'提交申请','Venue Availability':'场地可用情况','Venue':'场地','Type':'类型',
        'Location':'位置','Capacity':'容纳人数','Selected Time':'所选时段','Available':'可用','My Bookings':'我的预约',
        'Booking Notifications':'预约通知','Time':'时间','Decision':'审核结果','Review Note':'审核备注','Notification Time':'通知时间',
        'You have not submitted a venue request.':'暂无预约申请。','Booking decisions will appear here.':'预约审核结果将在此显示。',
        'Check classrooms, laboratories, meeting rooms, and sports venues, then submit a request.':'查询教室、实验室、会议室及体育场地后提交预约。',
        'Classroom':'教室','Laboratory':'实验室','Meeting Room':'会议室','Sports Venue':'体育场地',
        'Your question':'你的问题','Ask SmartCampus':'提问','Answers and sources':'回答与来源','Your most recent questions':'最近提问',
        'View cited sources':'查看引用来源','No questions yet':'暂无提问','Document retrieval':'文档检索','No matching source':'无匹配来源',
        'Your engagement report':'我的学习参与报告','How this works':'评分说明','Sign-ins':'登录次数','Q&A questions':'问答次数','Booking activities':'预约次数',
        'Low risk':'低风险','Medium risk':'中风险','High risk':'高风险','My Applications':'我的申请','New Application':'新建申请',
        'Submit Application':'提交申请','Application Type':'申请类型','Application ID':'申请编号','Submitted':'已提交',
        'Materials':'材料','Required Materials':'必需材料','Pre-review':'预审','Withdraw':'撤回','Resubmit':'重新提交',
        'Review':'审核','Approve':'批准','Reject':'拒绝','Return for Correction':'退回修改','Application Details':'申请详情',
        'Transcript':'成绩单','Enrollment Verification':'在读证明','Deferral':'延期申请','Browse Campus Gallery':'浏览校园相册',
        'GCU Campus Gallery':'GCU 校园相册','Pause homepage slideshow':'暂停首页轮播','Play homepage slideshow':'播放首页轮播',
        'Campus Walkway':'校园步道','Design Studio':'设计工作室','Academic Atrium':'教学楼中庭',
        'Issue Details':'问题详情','Campus Area':'校园区域','Affected Asset *':'报修设施 *','What happened? *':'问题描述 *',
        'Report Title *':'报修标题 *','Requested Priority':'优先级','Submit Report':'提交报修','Reporting Assistant':'报修助手',
        'Use My Location':'使用我的位置','Location or Asset ID':'位置或设施编号','Find':'查找','LOCATION DETAILS':'位置详情',
        'Public Area':'公共区域','Outdoor Facilities':'室外设施','GCU · Demo Campus':'GCU · 演示校区',
        'Browse buildings, rooms, and individual assets on this illustrative campus map.':'通过校园示意图查看建筑、房间和设施。',
        'Search the asset register by keyword.':'按关键词搜索设施。','Confirm Asset':'确认设施','Describe the Issue':'描述问题','Review and Submit':'核对并提交',
        'Select the affected asset and describe the issue.':'选择报修设施并描述问题。','Select an area':'选择区域',
        'Track your reports and the work orders you follow.':'跟踪自己提交或关注的工单。',
        'Search by title, asset, or work order ID':'按标题、设施或工单编号搜索',
        'Ask about SmartCampus services and receive an answer grounded in the campus knowledge base.':'询问校园服务，获取基于校园知识库的回答。',
        'Administrative services, maintenance requests, and facilities':'行政服务、设施报修与校园资源',
        'Concept images of the fictional campus. Select a photo to enlarge it.':'虚拟校园概念图，点击可查看大图。',
    };
    let language = 'zh';
    try { language = localStorage.getItem('campus-language') === 'en' ? 'en' : 'zh'; } catch (_) {}
    const originals = new WeakMap();
    const attributes = new WeakMap();
    function translate(value) {
        const trimmed = value.trim();
        return language === 'zh' && zh[trimmed] ? value.replace(trimmed, zh[trimmed]) : value;
    }
    function apply(root = document.body) {
        observer.disconnect();
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            if (node.parentElement?.closest('script,style,textarea,[contenteditable],.locale-switch,.learning-response,.learning-citations,#user-history')) continue;
            const saved = originals.get(node);
            const original = saved && node.nodeValue === saved.rendered ? saved.original : node.nodeValue;
            const rendered = translate(original);
            if (node.nodeValue !== rendered) node.nodeValue = rendered;
            originals.set(node, {original, rendered});
        }
        root.querySelectorAll('option:not([value])').forEach(option => {
            // Preserve submitted business values when translating visible option labels.
            const saved = originals.get(option.firstChild);
            option.value = saved?.original || option.textContent;
        });
        root.querySelectorAll('[placeholder],[aria-label],[title]').forEach(element => {
            if (element === toggle) return;
            const saved = attributes.get(element) || {};
            for (const name of ['placeholder', 'aria-label', 'title']) {
                if (!element.hasAttribute(name)) continue;
                const current = element.getAttribute(name);
                const original = saved[name]?.rendered === current ? saved[name].original : current;
                const rendered = translate(original);
                if (current !== rendered) element.setAttribute(name, rendered);
                saved[name] = {original, rendered};
            }
            attributes.set(element, saved);
        });
        document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en-US';
        toggle.textContent = language === 'zh' ? 'English' : '中文';
        toggle.setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换为中文');
        observer.observe(document.body, {childList:true, subtree:true, characterData:true});
    }
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'locale-switch';
    toggle.onclick = () => {
        language = language === 'zh' ? 'en' : 'zh';
        try { localStorage.setItem('campus-language', language); } catch (_) {}
        apply();
    };
    document.body.append(toggle);
    const observer = new MutationObserver(() => apply());
    apply();
    return {apply, get language() {return language;}};
})();
