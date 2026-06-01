# MedBill — GCP Deployment Guide

## Architecture

| Component | GCP Service       | Notes                                         |
|-----------|-------------------|-----------------------------------------------|
| Backend   | Cloud Run         | Flask + Gunicorn, stateless                   |
| Frontend  | Cloud Run         | Next.js standalone build                      |
| Database  | Cloud SQL (PG 15) | Recommended; SQLite OK for demo only          |
| Redis     | Memorystore       | Redis Cloud free tier works for initial tests |
| PDFs      | `/app/uploads`    | Ephemeral on Cloud Run — see note at bottom   |

---

## Prerequisites

```bash
# Authenticate
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  vpcaccess.googleapis.com

# Configure Docker auth for Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.dev
```

---

## Step 1 — Artifact Registry

```bash
gcloud artifacts repositories create medbill \
  --repository-format=docker \
  --location=us-central1 \
  --description="MedBill container images"
```

---

## Step 2 — Redis (required before backend)

**Option A — Cloud Memorystore (production, private VPC)**

```bash
# Create a Serverless VPC Access connector first (needed for Cloud Run → Memorystore)
gcloud compute networks vpc-access connectors create medbill-connector \
  --region=us-central1 \
  --range=10.8.0.0/28

# Create Redis instance
gcloud redis instances create medbill-redis \
  --size=1 \
  --region=us-central1 \
  --redis-version=redis_7_0

# Get the private IP (you'll use this as REDIS_URL)
gcloud redis instances describe medbill-redis --region=us-central1 \
  --format="value(host)"
# → e.g. 10.127.0.3   →   REDIS_URL=redis://10.127.0.3:6379/0
```

**Option B — Redis Cloud (free tier, no VPC needed, good for testing)**
1. Sign up at redis.io/try-free → create a free 30MB database
2. Copy the `redis://default:PASSWORD@host:PORT` connection string as `REDIS_URL`

---

## Step 3 — Database (Cloud SQL Postgres)

```bash
# Create instance
gcloud sql instances create medbill-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1

# Create DB and user
gcloud sql databases create medbill --instance=medbill-db
gcloud sql users create medbill --instance=medbill-db --password=CHANGE_ME

# Get the connection name (used in DATABASE_URL)
gcloud sql instances describe medbill-db --format="value(connectionName)"
# → PROJECT_ID:us-central1:medbill-db
```

Tables are created automatically by `db.create_all()` on first backend startup.

---

## Step 4 — Build and deploy backend

```bash
cd backend

# Build image
docker build -t us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/backend:latest .

# Push
docker push us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/backend:latest

# Deploy to Cloud Run
gcloud run deploy medbill-backend \
  --image us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/backend:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --add-cloudsql-instances PROJECT_ID:us-central1:medbill-db \
  --vpc-connector medbill-connector \
  --set-env-vars "FLASK_ENV=production" \
  --set-env-vars "DATABASE_URL=postgresql+psycopg2://medbill:PASSWORD@/medbill?host=/cloudsql/PROJECT_ID:us-central1:medbill-db" \
  --set-env-vars "REDIS_URL=redis://REDIS_IP:6379/0" \
  --set-env-vars "SECRET_KEY=GENERATE_WITH_python3_-c_import_secrets_print_secrets.token_hex_32" \
  --set-env-vars "FRONTEND_URL=https://PLACEHOLDER_UPDATE_AFTER_STEP_6" \
  --set-env-vars "ANTHROPIC_API_KEY=sk-ant-api03-..." \
  --set-env-vars "CLAUDE_EXTRACTION_MODEL=claude-haiku-4-5-20251001" \
  --set-env-vars "CLAUDE_EXTRACTION_FALLBACK_MODEL=claude-sonnet-4-6" \
  --set-env-vars "DEFAULT_NEGOTIATED_RATE_MULTIPLIER=1.00" \
  --set-env-vars "FUNDER_MEDICARE_MULTIPLIER=1.60" \
  --set-env-vars "LAW_FIRM_SPREAD_PERCENT=0.60" \
  --set-env-vars "CMS_API_URL=https://data.cms.gov/data-api/v1/dataset/6fea9d79-0129-4e4c-b1b8-23cd86a4f435/data" \
  --set-env-vars "MAX_UPLOAD_MB=10"
```

Note the backend URL from output, e.g. `https://medbill-backend-xxxx-uc.a.run.app`.

**Verify backend health:**
```bash
curl https://medbill-backend-xxxx-uc.a.run.app/api/health
# Expected: {"status":"ok","database":"ok","redis":"ok"}
```

---

## Step 5 — Build and deploy frontend

`NEXT_PUBLIC_API_URL` is baked into the JavaScript bundle at build time. It must be the backend URL from Step 4.

```bash
cd frontend

# Build image with backend URL
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://medbill-backend-xxxx-uc.a.run.app \
  -t us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/frontend:latest .

# Push
docker push us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/frontend:latest

# Deploy
gcloud run deploy medbill-frontend \
  --image us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/frontend:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi
```

Note the frontend URL, e.g. `https://medbill-frontend-xxxx-uc.a.run.app`.

---

## Step 6 — Update backend CORS

Once you have the frontend URL, update the backend's `FRONTEND_URL`:

```bash
gcloud run services update medbill-backend \
  --region us-central1 \
  --update-env-vars "FRONTEND_URL=https://medbill-frontend-xxxx-uc.a.run.app"
```

---

## Step 7 — Seed demo data

```bash
curl -X POST https://medbill-backend-xxxx-uc.a.run.app/api/demo/seed
```

Expected output includes demo credentials. All demo accounts use password `Demo1234!`.

---

## Step 8 — Smoke test

1. Open `https://medbill-frontend-xxxx-uc.a.run.app`
2. Log in as `firm@medbill.demo` / `Demo1234!`
3. Open case DEMO-001 → confirm bills and batches load
4. Log in as `funder@medbill.demo` / `Demo1234!` → confirm Batch Queue shows submitted batch
5. Log in as `provider@medbill.demo` / `Demo1234!` → confirm Assigned Cases loads

---

## Updating after code changes

**Backend only:**
```bash
cd backend
docker build -t us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/backend:latest .
docker push us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/backend:latest
gcloud run services update medbill-backend \
  --image us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/backend:latest \
  --region us-central1
```

**Frontend only** (or if backend URL changed):
```bash
cd frontend
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://medbill-backend-xxxx-uc.a.run.app \
  -t us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/frontend:latest .
docker push us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/frontend:latest
gcloud run services update medbill-frontend \
  --image us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/frontend:latest \
  --region us-central1
```

---

## Environment variable reference

| Variable | Required | Description |
|----------|----------|-------------|
| `SECRET_KEY` | ✅ | Flask session signing key — generate randomly |
| `DATABASE_URL` | ✅ | Postgres URL or `sqlite:///app.db` |
| `REDIS_URL` | ✅ | Redis connection URL (sessions) |
| `FRONTEND_URL` | ✅ | Deployed frontend URL for CORS |
| `ANTHROPIC_API_KEY` | ✅ | Claude AI extraction |
| `CLAUDE_EXTRACTION_MODEL` | — | Default: `claude-haiku-4-5-20251001` |
| `CLAUDE_EXTRACTION_FALLBACK_MODEL` | — | Default: `claude-sonnet-4-6` |
| `DEFAULT_NEGOTIATED_RATE_MULTIPLIER` | — | Default: `1.00` |
| `FUNDER_MEDICARE_MULTIPLIER` | — | Default: `1.60` |
| `LAW_FIRM_SPREAD_PERCENT` | — | Default: `0.60` |
| `CMS_API_URL` | — | CMS Medicare data API |
| `MAX_UPLOAD_MB` | — | Default: `10` |

---

## Notes

### PDF uploads are ephemeral on Cloud Run
Uploaded PDFs are stored in `/app/uploads` inside the container. They are lost when the container is replaced (redeploy, scale-to-zero, etc.). For production durability:
1. Create a Cloud Storage bucket
2. Replace `file.save(file_path)` in `app.py` with `google-cloud-storage` writes
3. Bill extraction re-reads the PDF on reprocess — update `bill.file_path` to a GCS URI and update `_extract_pages_from_pdf` to open from GCS

For demo/testing purposes, the current local-disk approach is acceptable.

### SQLite vs Postgres
SQLite (`sqlite:///app.db`) works for demos but the file lives inside the container and is lost on redeploy. Use Cloud SQL Postgres for any persistent data.

### Memorystore requires a VPC connector
Cloud Run cannot reach Memorystore's private IP without a Serverless VPC Access connector. The `--vpc-connector` flag in Step 4 handles this. Redis Cloud avoids this complexity.

### Secret Manager (optional hardening)
Instead of passing secrets as `--set-env-vars`, store them in Secret Manager and reference with `--set-secrets`:
```bash
echo -n "YOUR_SECRET" | gcloud secrets create medbill-secret-key --data-file=-
gcloud run services update medbill-backend \
  --update-secrets="SECRET_KEY=medbill-secret-key:latest"
```
