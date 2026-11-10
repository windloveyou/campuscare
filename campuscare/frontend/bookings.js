'use strict';

const bookings = (function () {
    const campusTime = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });
    const bookingLabels = {
        available: ['Available', 'green'],
        held: ['Time Slot Unavailable', 'orange'],
        past: ['Time Slot Started', ''],
        pending: ['Pending Review', 'orange'],
        approved: ['Approved', 'green'],
        rejected: ['Rejected', 'red'],
        cancelled: ['Canceled', ''],
        expired: ['Expired', ''],
    };

    function bookingBadge(status) {
        const [label, color] = bookingLabels[status] || [status, ''];
        return `<span class="badge ${color}">${esc(label)}</span>`;
    }

    function bookingTable(title, id, headers) {
        return `<section class="card" style="margin-bottom:20px">
            <div class="card-head"><h2>${title}</h2></div>
            <div class="table-wrap"><table aria-label="${title}">
                <thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead>
                <tbody id="${id}"><tr><td colspan="${headers.length}">Loading…</td></tr></tbody>
            </table></div>
        </section>`;
    }

    function view() {
        const isAdmin = state.user.role === 'admin';
        const title = isAdmin ? 'Venue Booking Review' : 'Campus Venue Booking';
        const subtitle = isAdmin
            ? 'Review venue requests. Decisions appear in the requester’s in-app notifications.'
            : 'Check classrooms, laboratories, meeting rooms, and sports venues, then submit a request.';
        return head(title, subtitle, '<button class="btn secondary" id="booking-refresh">Refresh</button>')
            + '<div id="booking-view"><p id="booking-feedback" role="status"></p>'
            + (isAdmin
                ? bookingTable(
                    'Requests Awaiting Review',
                    'booking-queue',
                    ['Venue', 'Time', 'Requester', 'Purpose', 'Action'],
                )
                : `<section class="card form-card" style="margin-bottom:20px">
                    <h2>Check a Time Slot and Apply</h2>
                    <p class="subtitle">Times use the campus time zone (UTC+8). A pending request holds its slot until it is reviewed or its start time passes.</p>
                    <form id="booking-form">
                        <div class="form-grid">
                            <div><label for="booking-start">Start Time</label><input type="datetime-local" id="booking-start" required></div>
                            <div><label for="booking-end">End Time</label><input type="datetime-local" id="booking-end" required></div>
                            <div><label for="booking-venue">Available Venue</label><select id="booking-venue" required disabled><option value="">Select a venue</option></select></div>
                            <div><label for="booking-purpose">Purpose</label><input id="booking-purpose" maxlength="200" required></div>
                        </div>
                        <button class="btn" type="submit" id="booking-submit" style="margin-top:16px" disabled>Submit Request</button>
                    </form>
                </section>`
                + bookingTable(
                    'Venue Availability',
                    'booking-venues',
                    ['Venue', 'Type', 'Location', 'Capacity', 'Selected Time'],
                )
                + bookingTable(
                    'My Bookings',
                    'booking-mine',
                    ['Venue', 'Time', 'Purpose', 'Status', 'Action'],
                )
                + bookingTable(
                    'Booking Notifications',
                    'booking-inbox',
                    ['Venue', 'Time', 'Decision', 'Review Note', 'Notification Time', 'Action'],
                ))
            + '</div>';
    }

    function bookingSlot(item) {
        return `${esc(campusTime.format(new Date(item.start_at)))} to ${esc(campusTime.format(new Date(item.end_at)))}`;
    }

    function bind() {
        const bookingView = $('#booking-view');
        const feedback = $('#booking-feedback');
        const refreshButton = $('#booking-refresh');
        const form = $('#booking-form');
        const start = $('#booking-start');
        const end = $('#booking-end');
        const venue = $('#booking-venue');
        const purpose = $('#booking-purpose');
        const submit = $('#booking-submit');
        const lastMarkup = new Map();
        let request = 0;
        let saving = false;

        function show(id, html) {
            if (lastMarkup.get(id) === html) return;
            bookingView.querySelector('#' + id).innerHTML = html;
            lastMarkup.set(id, html);
        }

        function rows(id, items, renderRow, columns, emptyText) {
            show(
                id,
                items.map(renderRow).join('')
                    || `<tr><td colspan="${columns}">${emptyText}</td></tr>`,
            );
        }

        function times() {
            return {start: start.value + '+08:00', end: end.value + '+08:00'};
        }

        function showVenues(venues, emptyText) {
            const selected = venue.value;
            const available = venues.filter(item => item.availability === 'available');
            show(
                'booking-venue',
                '<option value="">Select a venue</option>'
                    + available.map(item => `<option value="${esc(item.id)}">${esc(item.name)} (${esc(item.category)})</option>`).join(''),
            );
            venue.value = available.some(item => item.id === selected) ? selected : '';
            venue.disabled = !available.length || saving;
            submit.disabled = !available.length || saving;
            if (!venues.length && emptyText) feedback.textContent = emptyText;
        }

        async function load() {
            const currentRequest = ++request;
            const valid = form && start.value && end.value && end.value > start.value;
            const query = valid ? '?' + new URLSearchParams(times()) : '';
            try {
                const data = await api('/bookings' + query);
                if (!bookingView.isConnected || currentRequest !== request) return;
                feedback.textContent = form && !valid
                    ? 'Select a valid time slot. The end time must be later than the start time.'
                    : '';
                if (!form) {
                    rows(
                        'booking-queue',
                        data.pending,
                        item => `<tr><td>${esc(item.venue_name)}</td><td>${bookingSlot(item)}</td>
                            <td>${esc(item.requester_name)} (${esc(item.requester)})</td><td class="booking-text">${esc(item.purpose)}</td>
                            <td><button class="linkbtn" data-booking-review="${esc(item.id)}">Review</button></td></tr>`,
                        5,
                        'There are no venue requests awaiting review.',
                    );
                    return;
                }
                showVenues(data.venues || [], 'Select a valid time slot to view venues.');
                rows(
                    'booking-venues',
                    data.venues || [],
                    item => `<tr><td>${esc(item.name)}</td><td>${esc(item.category)}</td><td>${esc(item.location)}</td>
                        <td>${item.capacity}</td><td>${bookingBadge(item.availability)}</td></tr>`,
                    5,
                    'Select a valid time slot to view venues.',
                );
                rows(
                    'booking-mine',
                    data.bookings,
                    item => `<tr><td>${esc(item.venue_name)}</td><td>${bookingSlot(item)}</td>
                        <td class="booking-text">${esc(item.purpose)}</td><td>${bookingBadge(item.status)}</td><td>${item.can_cancel
                            ? `<button class="linkbtn" data-booking-cancel="${esc(item.id)}">Cancel</button>` : '—'}</td></tr>`,
                    5,
                    'You have not submitted a venue request.',
                );
                const inbox = data.bookings
                    .filter(item => item.decision)
                    .sort((a, b) => b.decided_at.localeCompare(a.decided_at));
                rows(
                    'booking-inbox',
                    inbox,
                    item => `<tr><td>${esc(item.venue_name)}</td><td>${bookingSlot(item)}</td>
                        <td>${bookingBadge(item.decision)}</td><td class="booking-text">${esc(item.review_note || '—')}</td>
                        <td>${esc(campusTime.format(new Date(item.decided_at)))}</td><td>${item.read_at
                            ? 'Read' : `<button class="linkbtn" data-booking-read="${esc(item.id)}">Mark as Read</button>`}</td></tr>`,
                    6,
                    'Booking decisions will appear here.',
                );
            } catch (error) {
                if (!bookingView.isConnected || currentRequest !== request) return;
                if (form) showVenues([], 'Unable to load venues. Refresh and try again.');
                feedback.textContent = error.message;
            }
        }

        refreshButton.onclick = load;
        if (form) {
            const nextHour = Math.floor(Date.now() / 3600000 + 1) * 3600000;
            const campusInput = milliseconds => new Date(milliseconds + 8 * 3600000).toISOString().slice(0, 16);
            start.value = campusInput(nextHour);
            end.value = campusInput(nextHour + 3600000);
            start.onchange = end.onchange = load;
            form.onsubmit = async event => {
                event.preventDefault();
                if (saving || !venue.value) return;
                saving = true;
                submit.disabled = venue.disabled = true;
                const submittedPurpose = purpose.value;
                try {
                    await api('/bookings', {
                        ...times(),
                        venue_id: venue.value,
                        purpose: submittedPurpose,
                    });
                    if (bookingView.isConnected) {
                        if (purpose.value === submittedPurpose) purpose.value = '';
                        toast('Your venue request was submitted for review.');
                    }
                } catch (error) {
                    if (bookingView.isConnected) toast(error.message);
                } finally {
                    saving = false;
                    if (bookingView.isConnected) await load();
                }
            };
        }

        bookingView.onclick = async event => {
            const button = event.target.closest('button');
            if (!button) return;
            const {bookingReview, bookingRead, bookingCancel} = button.dataset;
            if (bookingReview) {
                openReview(bookingReview, load);
                return;
            }
            if (!bookingRead && !bookingCancel) return;
            if (bookingCancel && !window.confirm('Cancel this booking and release its time slot?')) return;
            button.disabled = true;
            try {
                await api(bookingRead ? '/bookings/read' : '/bookings/cancel', {
                    id: bookingRead || bookingCancel,
                });
                toast(bookingRead ? 'The notification was marked as read.' : 'The booking was canceled.');
                await load();
            } catch (error) {
                if (button.isConnected) button.disabled = false;
                toast(error.message);
            }
        };

        load();
    }

    function openReview(id, reload) {
        drawer(`<div class="drawer-head"><h2>Review Venue Request</h2><button class="close" data-action="close" aria-label="Close">×</button></div>
            <form id="booking-review-form">
                <label for="booking-decision">Decision</label>
                <select id="booking-decision" required>
                    <option value="">Select a decision</option>
                    <option value="approved">Approve</option>
                    <option value="rejected">Reject</option>
                </select>
                <label for="booking-note">Review Note (required when rejecting)</label>
                <textarea id="booking-note" maxlength="300"></textarea>
                <p id="booking-review-error" class="error" role="alert"></p>
                <button class="btn" type="submit">Save Decision</button>
            </form>`);
        const form = $('#booking-review-form');
        const decision = $('#booking-decision');
        const note = $('#booking-note');
        const submit = form.querySelector('button[type="submit"]');
        const feedback = $('#booking-review-error');
        decision.onchange = () => {
            note.required = decision.value === 'rejected';
        };
        form.onsubmit = async event => {
            event.preventDefault();
            if (submit.disabled) return;
            submit.disabled = true;
            try {
                await api('/bookings/review', {
                    id,
                    decision: decision.value,
                    note: note.value,
                });
                if (form.isConnected) {
                    closeDrawer();
                    toast('The booking decision was saved.');
                }
                await reload();
            } catch (error) {
                if (form.isConnected) feedback.textContent = error.message;
            } finally {
                submit.disabled = false;
            }
        };
    }

    return {view, bind};
})();
