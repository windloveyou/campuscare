# SmartCampus Module Integration

This document maps the six modules in the project proposal to their backend, frontend, API, persistence, and verification boundaries.

## Source layout

```text
backend/        Python API, authentication, authorization, SQLite migrations, and business rules
frontend/       HTML, CSS, JavaScript, and static media; no Python business logic
server.py       Compatibility launcher that delegates to backend.server
test_*.py       Unit and HTTP integration tests
data/           Runtime SQLite data; excluded from source control
```

The frontend communicates with the backend only through `/api/*`. The backend serves the static frontend in the local demo so the project still starts with one command. This is a deployment convenience, not a shared business-logic layer.

## Proposal coverage

| Module | Backend | Frontend | Main API | Verification |
| --- | --- | --- | --- | --- |
| 1. Intelligent Q&A Assistant | `backend/learning_support.py` retrieves campus documents, records history, cites sources, and optionally uses the configured local Ollama model | `frontend/learning.js` | `GET/POST /api/learning/questions` | `test_learning_support.py` |
| 2. Academic Risk Warning | `backend/academic_risk.py` calculates a transparent 30-day rule score from sign-ins, Q&A usage, and booking activity | `frontend/learning.js` | `GET /api/academic-risk` | `test_learning_support.py` |
| 3. Multimodal Predictive Maintenance and Smart Repair | `backend/server.py` handles assets, work orders, attachments, model-assisted drafts, dispatch, inspections, and permissions; `backend/forecast.py` contains the synthetic prediction experiment | `frontend/facilities.js` | `/api/tickets`, `/api/analyze`, `/api/transition`, `/api/forecast` | `test_system.py` |
| 4. Smart Venue Booking | `backend/bookings.py` handles inventory, availability, conflict checks, approval, cancellation, and private notifications | `frontend/bookings.js` | `GET/POST /api/bookings` and booking actions | `test_bookings.py` |
| 5. Unified Certificate Request Portal | `backend/admin_services.py` handles transcripts, enrollment certificates, materials, assignment, review, progress, and cancellation | `frontend/admin-services.js` | `/api/admin-services/*` | `test_admin_services.py` |
| 6. Intelligent Application Pre-review and Notification | `backend/applications.py` and `backend/prereview.py` handle rule checks, corrections, resubmission, decisions, events, and notices | `frontend/applications.js` | `/api/applications*` and `/api/notices*` | `test_applications.py` |

## Honest AI boundary

Modules 1 and 3 can call a locally configured Ollama endpoint. If no model is configured or the model fails, Module 1 returns a cited retrieval summary and Module 3 returns its explicit rule-based draft. Module 2 is intentionally a transparent rule score. Module 6 uses deterministic validation rules. The interface identifies these modes and does not present a rule result as a trained AI prediction.

The maintenance forecast uses reproducible synthetic data for a course demonstration. It is not trained on real university records and must not be presented as evidence of real-world prediction performance.

## Shared platform layer

All six modules use the same authenticated session, CSRF protection, role checks, SQLite transaction boundary, and account directory. Each module owns its tables and business transitions. Adding a navigation item never grants backend permission.
