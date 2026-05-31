# MedBill

A medical bill processing platform that extracts line items from PDF bills, compares them against real Medicare rates, calculates overbilling, and manages a law firm → provider → funder funding workflow.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Flask, SQLAlchemy, SQLite, Redis |
| Frontend | Next.js 16 App Router, TypeScript, Tailwind CSS |
| PDF extraction | pdfplumber + Claude Haiku fallback |
| Rate data | Live CMS Medicare API (no key needed) |

---

## Quick Start

```bash
# 1. Start Redis
brew services start redis

# 2. Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add your ANTHROPIC_API_KEY
python app.py                 # runs on :5001

# 3. Frontend
cd frontend
npm install
cp .env.local.example .env.local
npm run dev                   # runs on :3000

# 4. Seed demo data
curl -X POST http://localhost:5001/api/demo/seed
```

Health check: `GET http://localhost:5001/api/health`

---

## Demo Accounts

All password: `Demo1234!`

| Role | Email | Notes |
|---|---|---|
| Law Firm | `firm@medbill.demo` | Creates cases, requests funding |
| Provider | `provider@medbill.demo` | Uploads bills to assigned cases |
| Funder | `funder@medbill.demo` | Reviews and funds bills |

**VIDEO-001** (Maria Gonzalez) is pre-created and assigned to all three video demo accounts.

---

## Roles

| Role | Can Do |
|---|---|
| `law_firm` | Create cases, assign providers/funders, request funding |
| `provider` | Upload bills to assigned cases only |
| `funder` | View assigned cases, mark bills funded or rejected |
| `admin` | Everything |

---

## Core Features

### 1. Authentication

Sessions are stored in Redis, not JWTs.

**Login flow:**
1. `POST /api/auth/login` validates credentials against bcrypt hash
2. A secure random token (`secrets.token_urlsafe(32)`) is generated
3. Session data (`user_id`, `email`, `role`, `organization_name`) is stored in Redis with a 24h TTL: `session:<token> → JSON`
4. The token is returned to the frontend and stored in `localStorage`
5. Every API request sends `Authorization: Bearer <token>`

**Auth decorators** (`backend/app.py`):
- `@require_auth` — validates Bearer token, injects `session` dict into the route
- `@require_role('law_firm', 'admin')` — validates role after auth check

**Logout:** deletes the Redis key immediately, invalidating the session server-side.

---

### 2. Authorization

Access control operates at two levels.

**Role-based:** `@require_role(...)` on routes that only certain roles may call (e.g. only `law_firm` can create assignments, only `funder` can mark bills funded).

**Case-level access:** Every user can only see cases they are linked to:

```
law_firm  → cases where PatientCase.law_firm_id = user.id
provider  → cases where CaseAssignment(case_id, user_id) exists
funder    → cases where CaseAssignment(case_id, user_id) exists
admin     → all cases
```

The `CaseAssignment` table is the source of truth for provider/funder access. Law firms assign providers and funders via `POST /api/cases/:id/assignments`.

Two helper functions enforce this everywhere:
- `can_user_access_case(user_id, role, case)` — returns bool
- `can_user_access_bill(user_id, role, bill)` — delegates to case check

Bills inherit their permissions from their parent case. A user who cannot see a case cannot see any of its bills either. Unauthorized access returns `404` (not `403`) to avoid confirming a resource exists.

---

### 3. Bill Upload & Processing

Uploading a bill triggers a synchronous pipeline:

```
POST /api/cases/:id/bills/upload  (multipart PDF)
        │
        ▼
1. Access check — funder blocked, provider/law_firm must be assigned to case
2. Save PDF to uploads/ with UUID prefix (prevents filename collisions)
3. Create MedicalBill record (status: uploaded)
4. Advance case status: active → bills_uploaded (first upload)
        │
        ▼
5. pdfplumber extracts all page text
        │
        ├─ regex finds items?  ──→ use them
        │   Pattern: \b(CPT|HCPCS code)\b ... $amount at end of line
        │
        └─ 0 items found ──→ Claude Haiku fallback
            Send full text to claude-haiku-4-5-20251001
            Returns JSON array of {code, description, quantity, billed_amount}
        │
        ▼
6. For each line item: look up Medicare rate
   Lookup chain:
     a. Local DB (MedicareRate table) — instant
     b. Redis cache (key: medicare_rate:<code>:<year>) — avoids repeat API calls
     c. Live CMS API (data.cms.gov — public, no key) — fetches Avg_Mdcr_Alowd_Amt
        On success: save to DB + cache in Redis (24h TTL)
        On failure: cache NOT_FOUND sentinel, return unmatched
        │
        ▼
7. Calculate per line item:
   medicare_allowed = rate × quantity
   savings          = billed - medicare_allowed
   billing_ratio    = billed / medicare_allowed
   match_status     = matched | unmatched
        │
        ▼
8. Aggregate bill totals:
   total_billed, total_medicare, total_savings, savings_percentage, avg_ratio
9. Update case totals (rolls up all completed bills on the case)
10. Return completed bill in the upload response
```

If any step fails after the file is saved, `bill.status` is set to `failed` and `bill.error_message` stores the reason. The app never crashes on a bad PDF.

---

### 4. Caching

Redis is used for two purposes: sessions and Medicare rate lookups.

**Session cache**
```
Key:   session:<token>
Value: {"user_id": 1, "email": "...", "role": "law_firm", "organization_name": "..."}
TTL:   SESSION_TTL_SECONDS (default 86400 = 24h)
```
Checked on every authenticated request. Deleted on logout.

**Medicare rate cache**
```
Key:   medicare_rate:<CODE>:<YEAR>
Value: JSON of the MedicareRate record  (or the string "NOT_FOUND")
TTL:   RATE_CACHE_TTL_SECONDS (default 86400 = 24h)
```

The NOT_FOUND sentinel prevents hammering the CMS API for unknown codes. Once a code is fetched from CMS it is also persisted to the DB, so subsequent restarts still have it without hitting Redis or CMS again.

If Redis is unavailable the app degrades gracefully: sessions require DB-backed auth (which will fail if Redis is down since sessions are Redis-only), and rate lookups skip straight to the CMS API. `/api/health` reports `redis: unavailable` when degraded.

---

## API Reference

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | — | Create account |
| POST | `/api/auth/login` | — | Get session token |
| POST | `/api/auth/logout` | ✓ | Invalidate session |
| GET | `/api/auth/me` | ✓ | Current user |

### Cases
| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/api/cases` | law_firm, admin | Create case |
| GET | `/api/cases` | all | List accessible cases |
| GET | `/api/cases/:id` | all | Case detail + bills + assignments |
| PATCH | `/api/cases/:id` | law_firm, admin | Update case |

### Assignments
| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/api/cases/:id/assignments` | all | List case assignments |
| POST | `/api/cases/:id/assignments` | law_firm, admin | Assign provider or funder |
| DELETE | `/api/cases/:id/assignments/:aid` | law_firm, admin | Remove assignment |
| GET | `/api/users?role=provider\|funder` | law_firm, admin | List assignable users |

### Bills
| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/api/cases/:id/bills/upload` | law_firm, provider | Upload PDF |
| GET | `/api/bills` | all | List accessible bills |
| GET | `/api/bills/:id` | all | Bill detail + line items |
| GET | `/api/bills/:id/line-items` | all | Line items only |
| POST | `/api/bills/:id/request-funding` | law_firm | Request funder review |
| POST | `/api/bills/:id/mark-funded` | funder, admin | Approve funding |
| POST | `/api/bills/:id/reject-funding` | funder, admin | Reject with reason |

### Medicare Rates
| Method | Path | Description |
|---|---|---|
| GET | `/api/medicare-rates/:code` | Lookup with DB→Redis→CMS fallback |
| POST | `/api/medicare-rates/sync-from-cms` | Refresh all DB rates from CMS |

### Other
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | DB + Redis status |
| GET | `/api/dashboard/summary` | Role-scoped metrics |
| POST | `/api/demo/seed` | Seed demo users and cases (dev only) |

---

## Case Status Flow

```
active
  └─► bills_uploaded      (first bill uploaded)
        └─► provider_review   (law firm marks ready for provider)
              └─► ready_for_funding  (law firm requests funding)
                    └─► funder_review     (funder begins review)
                          ├─► funded
                          └─► rejected
closed  (any stage)
```

---

## Environment Variables

Copy `backend/.env.example` → `backend/.env`

| Variable | Required | Description |
|---|---|---|
| `SECRET_KEY` | Yes | Flask session secret |
| `DATABASE_URL` | Yes | SQLite path or Postgres URL |
| `REDIS_URL` | Yes | Redis connection string |
| `ANTHROPIC_API_KEY` | Recommended | Enables Claude fallback for messy PDFs |
| `CLAUDE_EXTRACTION_MODEL` | No | Default: `claude-haiku-4-5-20251001` |
| `CMS_API_URL` | No | Default: public CMS dataset |
| `SESSION_TTL_SECONDS` | No | Default: 86400 |
| `MAX_UPLOAD_MB` | No | Default: 10 |

---

## Project Structure

```
medbill/
├── backend/
│   ├── app.py              # All backend logic (single file, 15 sections)
│   ├── requirements.txt
│   ├── .env.example
│   ├── uploads/            # Uploaded PDFs (gitignored)
│   └── instance/           # SQLite DB (gitignored)
│
├── frontend/
│   ├── app/                # Next.js App Router pages
│   │   ├── dashboard/      # Role-specific dashboards
│   │   ├── cases/          # Case list + detail
│   │   ├── bills/          # Bill list + detail
│   │   ├── upload/         # PDF upload
│   │   └── assignments/    # Provider/funder assignment (law firm only)
│   ├── components/
│   │   ├── AppShell.tsx    # Left sidebar layout
│   │   ├── dashboards/     # LawFirmDashboard, ProviderDashboard, FunderDashboard
│   │   └── ...             # StatusBadge, CaseTable, BillTable, LineItemTable
│   ├── lib/
│   │   ├── api.ts          # Centralized API client (auto-attaches Bearer token)
│   │   ├── auth.ts         # Token/user helpers (localStorage)
│   │   └── formatters.ts   # Currency, date, ratio formatters
│   └── types/              # TypeScript interfaces
│
└── sample_bills/
    ├── clean_bill.pdf      # Works with regex parser
    └── messy_bill.pdf      # Triggers Claude fallback
```
