# MedBill

**Demo Video:** [Watch the MedBill demo](https://youtu.be/oXoKcJ_Ne78)

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

## Case Status Flow

```
active
  └─► bills_uploaded       (first bill uploaded to the case)
        └─► provider_review    (law firm marks ready for provider)
              └─► ready_for_funding   (law firm requests funding)
                    └─► funder_review      (funder begins review)
                          ├─► funded
                          └─► rejected
closed  (can be set at any stage)
```

---

## Bill Processing Workflow

Uploading a PDF triggers a synchronous pipeline that returns a fully-processed bill in the same response:

```
POST /api/cases/:id/bills/upload  (multipart PDF)
        │
        ▼
1. Access check
   — funder: blocked (403)
   — provider / law_firm: must be assigned to the case
        │
        ▼
2. Save PDF to uploads/ with UUID prefix
   Prevents filename collisions across uploads
        │
        ▼
3. Create MedicalBill record  (status: uploaded)
   Advance case status: active → bills_uploaded on first upload
        │
        ▼
4. TEXT EXTRACTION  (pdfplumber)
   Extract all page text from the PDF
        │
        ├─ Regex parser (fast path)
        │   Pattern: \b(CPT|HCPCS code)\b ... $amount at end of line
        │   Handles clean, text-based PDFs where code and amount are on one line
        │
        └─ Claude Haiku fallback  (triggered when regex finds 0 items)
            Sends full extracted text to claude-haiku-4-5-20251001
            Prompt asks for JSON: [{code, description, quantity, billed_amount}]
            Handles messy layouts: multi-column tables, code on separate line,
            amounts without $ signs, mixed Rev/CPT/HCPCS formats
        │
        ▼
5. RATE LOOKUP  (per line item — three-tier fallback)

   a. Local DB  ──────────────────────────────────── instant, most common path
      MedicareRate table, most recent year

   b. Redis cache  ────────────────────────────────── avoids repeat CMS calls
      Key: medicare_rate:<CODE>:<YEAR>
      Stores JSON of rate record, or "NOT_FOUND" sentinel (24h TTL)
      NOT_FOUND prevents hammering CMS for unknown codes

   c. CMS API  (data.cms.gov — public, no key required)
      Dataset: Medicare Physician & Other Practitioners by Geography and Service
      Field used: Avg_Mdcr_Alowd_Amt (national average allowed amount)
      On success → save to DB + cache in Redis
      On failure → log warning, mark line item unmatched, never crash
        │
        ▼
6. CALCULATIONS  (per line item)
   medicare_allowed = rate × quantity
   savings          = billed_amount − medicare_allowed
   billing_ratio    = billed_amount / medicare_allowed
   match_status     = matched | unmatched | low_confidence
        │
        ▼
7. BILL AGGREGATION
   total_billed_amount    = sum of all billed_amount
   total_medicare_amount  = sum of all medicare_allowed_amount
   total_savings          = total_billed − total_medicare
   savings_percentage     = (total_savings / total_billed) × 100
   average_billing_ratio  = mean ratio across matched line items
        │
        ▼
8. CASE ROLLUP
   Recompute case-level totals from all completed bills on the case

9. Return completed bill in the upload response
   bill.status = completed | failed
   bill.error_message set if extraction or parsing failed
```

---

## Caching

Redis handles two caching concerns.

### Session Cache

```
Key:   session:<token>
Value: {"user_id": 1, "email": "...", "role": "law_firm", "organization_name": "..."}
TTL:   SESSION_TTL_SECONDS  (default 86400 — 24 hours)
```

Every authenticated request reads this key. Logout deletes it immediately, invalidating the session server-side before the TTL expires. If Redis is unavailable, login is blocked (sessions are Redis-only by design).

### Medicare Rate Cache

```
Key:   medicare_rate:<CODE>:<YEAR>
Value: JSON of MedicareRate record  —or—  the string "NOT_FOUND"
TTL:   RATE_CACHE_TTL_SECONDS  (default 86400 — 24 hours)
```

The `NOT_FOUND` sentinel is stored after a CMS miss so the same unknown code does not re-hit the CMS API on every bill upload within the TTL window. Once a code is fetched from CMS it is also persisted to the DB, so subsequent app restarts still have the rate without touching Redis or CMS again.

If Redis is unavailable, rate lookups skip straight to the CMS API. `/api/health` reports `redis: unavailable` when degraded.

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

| Role | Email | Org |
|---|---|---|
| Law Firm | `firm@medbill.demo` | Smith Legal Group |
| Provider | `provider@medbill.demo` | Riverside Medical Center |
| Funder | `funder@medbill.demo` | MedFund Capital |

**VIDEO-001** (Maria Gonzalez) is pre-created and assigned to all three accounts. Use `sample_bills/messy_bill.pdf` to trigger the Claude extraction path.

Additional test accounts: `henry@lawfirm.demo`, `provider1@demo.com`, `provider2@demo.com`, `alice@funder.demo`, `funder2@funder.demo`

---

## Roles

| Role | Can Do |
|---|---|
| `law_firm` | Create cases, assign providers/funders, request funding |
| `provider` | Upload bills to assigned cases only |
| `funder` | View assigned cases, mark bills funded or rejected |
| `admin` | Everything |

---

## Authentication

Sessions are stored in Redis, not JWTs.

1. `POST /api/auth/login` validates credentials against a bcrypt hash
2. A secure random token (`secrets.token_urlsafe(32)`) is generated
3. Session data is stored in Redis with a 24h TTL (see Caching above)
4. The token is returned to the frontend and stored in `localStorage`
5. Every API request sends `Authorization: Bearer <token>`
6. `@require_auth` validates the token on each request and injects the session dict into the route
7. `@require_role('law_firm', 'admin')` enforces role checks after auth

---

## Authorization

Access control operates at two levels.

**Route-level:** `@require_role(...)` blocks roles that may not call an endpoint at all (e.g. only `funder`/`admin` can mark bills funded).

**Case-level:** Every user sees only cases they are linked to:

```
law_firm  →  cases where PatientCase.law_firm_id = user.id
provider  →  cases where CaseAssignment(case_id, user_id) exists
funder    →  cases where CaseAssignment(case_id, user_id) exists
admin     →  all cases
```

The `CaseAssignment` table is the source of truth for provider/funder access. Law firms assign providers and funders via `POST /api/cases/:id/assignments`.

Bills inherit permissions from their parent case. Two helpers enforce this everywhere:
- `can_user_access_case(user_id, role, case)` → bool
- `can_user_access_bill(user_id, role, bill)` → delegates to case check

Unauthorized access returns `404` (not `403`) to avoid confirming a resource exists.

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
| GET | `/api/cases/:id/assignments` | all | List assignments |
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
| POST | `/api/bills/:id/mark-funded` | funder, admin | Approve |
| POST | `/api/bills/:id/reject-funding` | funder, admin | Reject with reason |

### Medicare Rates
| Method | Path | Description |
|---|---|---|
| GET | `/api/medicare-rates/:code` | Lookup: DB → Redis → CMS |
| POST | `/api/medicare-rates/sync-from-cms` | Refresh all DB rates from CMS |

### Other
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | DB + Redis status |
| GET | `/api/dashboard/summary` | Role-scoped metrics |
| POST | `/api/demo/seed` | Seed demo users and cases (dev only) |

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
