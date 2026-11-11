# Maintenance workflow

The AI-assisted intake is an explicit submit flow rather than a passive suggestion box.
After the reporter confirms the registered asset and original description, the local
vision model reviews text and up to three photos. Missing essential details appear in a
modal dialog. Raw question-and-answer pairs are retained in the submitted description,
while a second model pass prepares the title and priority. Answered questions are not
repeated. A vague report keeps a deterministic clarification question even when the
model omits one. Potential duplicate work orders pause submission so the reporter can
follow an existing record or confirm that the issue is different. The manual submission
path remains available if the reporter does not want to use AI.

AI submission does not let the model choose a different asset, location, reporter, or
technician. Those values continue to come from authenticated records and the dispatch
transaction described below. The model organizes evidence; it does not diagnose a
hidden cause or bypass access control.

New reports and reopened work orders use `backend/dispatch.py`. The caller acquires a
SQLite `BEGIN IMMEDIATE` transaction before selecting a technician. Eligible technicians
must be active and match the asset's trade. Assignment chooses the lowest number of open
work orders, with account ID as a stable tie-breaker. Assignment and audit events commit
together. New records retain version 1; retrying an existing waiting record increments its
version so old clients cannot overwrite a new assignment.

If no specialist is available, the report remains pending. The reporter and active
administrators receive an in-app notice. Repeated retries do not repeat this warning.
Creating, restoring, or updating an active technician retries pending work, with high
priority first, then oldest first. Administrators may also retry from a pending work
order or make an explicit manual assignment. Disabling a technician who still has open
work remains blocked until the work is transferred or completed.

Reporters and administrators can cancel pending or assigned work before its first repair
start. Once repair has started, cancellation is blocked even if a manual reassignment
returns the status to assigned. Contact the technician to coordinate further action.
Cancellation clears the assignment and notifies the former assignee. Reopening clears
the previous completion result, preserves the event history, and runs dispatch again.

Tests in `test_dispatch.py` cover cancellation ownership, start/cancel races, concurrent
workload balancing, missing specialists, notification deduplication, new/restored staff,
and reopening. All tests use isolated temporary databases.

The forecast remains a synthetic reporting-event experiment. This workflow change does
not turn its output into a validated physical-failure probability, install a vision
model, or automatically create maintenance tasks from synthetic predictions.
