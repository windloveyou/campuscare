'use strict';

function learningPage() {
    return `<div class="learning-page">
        ${head('Intelligent Q&A Assistant', 'Ask about SmartCampus services and receive an answer grounded in the campus knowledge base.')}
        <section class="card learning-compose"><div class="card-body">
            <form id="learning-form">
                <label for="learning-question">Your question</label>
                <div class="learning-input-row"><textarea id="learning-question" rows="3" maxlength="500" required placeholder="How do I request a transcript or book a venue?"></textarea>
                <button class="btn campus-primary" type="submit">Ask SmartCampus</button></div>
                <p class="small muted">Answers cite the campus documents used. A configured local model can synthesize the retrieved text; otherwise a deterministic retrieval summary is shown.</p>
            </form>
        </div></section>
        <section class="card"><div class="card-head"><div><h2>Answers and sources</h2><p>Your most recent questions</p></div></div>
            <div id="learning-results" class="card-body"><p class="muted">Loading your questions…</p></div></section>
    </div>`;
}

function learningAnswer(item) {
    const labels = {'local-model': 'Local model + retrieval', retrieval: 'Document retrieval', 'retrieval-no-match': 'No matching source'};
    const citations = item.citations?.length ? `<ol class="learning-citations">${item.citations.map(source => `<li>
        <strong>[${source.number}] ${esc(source.title)}</strong><span>${esc(source.section)}</span><p>${esc(source.excerpt)}</p>
    </li>`).join('')}</ol>` : '<p class="muted">No source matched this question.</p>';
    return `<article class="learning-answer"><div class="learning-answer-head"><h3>${esc(item.question)}</h3><span class="status">${esc(labels[item.mode] || item.mode)}</span></div>
        <p class="learning-response">${esc(item.answer)}</p><details><summary>View cited sources</summary>${citations}</details></article>`;
}

async function bindLearningPage() {
    const form = $('#learning-form');
    const results = $('#learning-results');
    async function load() {
        const data = await api('/learning/questions');
        if (!results.isConnected) return;
        results.innerHTML = data.history.length ? data.history.map(learningAnswer).join('')
            : '<div class="empty"><h3>No questions yet</h3><p>Ask about accounts, venue booking, facility repairs, certificates, or application pre-review.</p></div>';
    }
    form.onsubmit = async event => {
        event.preventDefault();
        const button = event.submitter;
        button.disabled = true;
        try {
            const answer = await api('/learning/questions', {question: $('#learning-question').value});
            if (!form.isConnected) return;
            $('#learning-question').value = '';
            results.innerHTML = learningAnswer(answer) + (results.querySelector('.empty') ? '' : results.innerHTML);
        } catch (error) {
            toast(error.message);
        } finally {
            if (button.isConnected) button.disabled = false;
        }
    };
    try { await load(); } catch (error) { if (results.isConnected) results.innerHTML = `<p class="error">${esc(error.message)}</p>`; }
}

function academicRiskPage() {
    return `<div class="risk-page">
        ${head('Academic Risk Warning', 'A transparent engagement indicator based on recent SmartCampus activity.')}
        <div id="risk-dashboard"><section class="card"><div class="card-body"><p class="muted">Calculating the current report…</p></div></section></div>
    </div>`;
}

function riskBadge(level) {
    return `<span class="risk-badge risk-${esc(level)}">${esc(level[0].toUpperCase() + level.slice(1))} risk</span>`;
}

function riskReportCard(report, name = '') {
    return `<article class="card risk-card"><div class="card-body">
        <div class="risk-title"><div>${name ? `<h3>${esc(name)}</h3>` : '<h2>Your engagement report</h2>'}${riskBadge(report.level)}</div><strong class="risk-score">${report.score}<small>/100</small></strong></div>
        <div class="risk-counts"><span><strong>${report.counts.logins}</strong> Sign-ins</span><span><strong>${report.counts.questions}</strong> Q&A questions</span><span><strong>${report.counts.bookings}</strong> Booking activities</span></div>
        <ul>${report.factors.map(factor => `<li>${esc(factor)}</li>`).join('')}</ul>
        ${report.level === 'high' ? '<p class="risk-guidance">Engagement is currently limited. Review your course tasks and contact your faculty adviser if you need support.</p>' : report.level === 'medium' ? '<p class="risk-guidance">Some recent engagement is visible. Check outstanding learning tasks and services.</p>' : '<p class="risk-guidance">Recent engagement is within the expected range.</p>'}
    </div></article>`;
}

async function bindAcademicRiskPage() {
    const root = $('#risk-dashboard');
    try {
        const data = await api('/academic-risk');
        if (!root.isConnected) return;
        const method = `<section class="risk-method"><strong>How this works</strong><p>${esc(data.method)} This indicator supports outreach and is not a grade or disciplinary decision.</p></section>`;
        if (data.scope === 'self') root.innerHTML = riskReportCard(data.report) + method;
        else root.innerHTML = `<div class="risk-cohort">${data.students.length ? data.students.map(student => riskReportCard(student, `${student.name} · ${student.class_name || 'Class not provided'}`)).join('') : '<p class="empty">No active students found.</p>'}</div>${method}`;
    } catch (error) {
        if (root.isConnected) root.innerHTML = `<section class="card"><div class="card-body"><p class="error">${esc(error.message)}</p></div></section>`;
    }
}
