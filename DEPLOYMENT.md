# MedBill — GCP Deployment Guide

## Architecture

| Component | GCP Service          | Notes                                          |
|-----------|----------------------|------------------------------------------------|
| Backend   | Cloud Run            | Stateless Flask + Gunicorn                     |
| Frontend  | Cloud Run            | Next.js standalone build                       |
| Database  | Cloud SQL (Postgres) | Recommended for prod; SQLite OK for test only  |
| Redis     | Memorystore          | Or Redis Cloud free tier for quick testing     |
| PDFs      | Local `/uploads`     | Use Cloud Storage for durability in production |

---

## Prerequisites

```bash
# Install and authenticate
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com
```

---

## Step 1 — Create Artifact Registry repo

```bash
gcloud artifacts repositories create medbill \
  --repository-format=docker \
  --location=us-central1
```

---

## Step 2 — Build and push backend image

```bash
cd backend

# Build
docker build -t us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/backend:latest .

# Push
docker push us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/backend:latest
```

---

## Step 3 — Deploy backend to Cloud Run

```bash
gcloud run deploy medbill-backend \
  --image us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/backend:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --set-env-vars "FLASK_ENV=production" \
  --set-env-vars "DATABASE_URL=postgresql+psycopg2://USER:PASS@/DB?host=/cloudsql/PROJECT:REGION:INSTANCE" \
  --set-env-vars "REDIS_URL=redis://REDIS_IP:6379/0" \
  --set-env-vars "SECRET_KEY=CHANGE_ME" \
  --set-env-vars "FRONTEND_URL=https://FRONTEND_URL" \
  --set-env-vars "ANTHROPIC_API_KEY=sk-ant-..." \
  --set-env-vars "DEFAULT_NEGOTIATED_RATE_MULTIPLIER=1.00" \
  --set-env-vars "FUNDER_MEDICARE_MULTIPLIER=1.60" \
  --set-env-vars "LAW_FIRM_SPREAD_PERCENT=0.60"
```

> For Cloud SQL, also add `--add-cloudsql-instances PROJECT:REGION:INSTANCE`

Note the backend URL from the output (e.g. `https://medbill-backend-xxxx-uc.a.run.app`).

---

## Step 4 — Build and push frontend image

```bash
cd frontend

docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://medbill-backend-xxxx-uc.a.run.app \
  -t us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/frontend:latest .

docker push us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/frontend:latest
```

**Important:** `NEXT_PUBLIC_API_URL` is baked into the bundle at build time. Rebuild when the backend URL changes.

The Next.js standalone output requires `output: 'standalone'` in `next.config.ts` — add it if missing.

---

## Step 5 — Deploy frontend to Cloud Run

```bash
gcloud run deploy medbill-frontend \
  --image us-central1-docker.pkg.dev/YOUR_PROJECT_ID/medbill/frontend:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi
```

Note the frontend URL and go back to update the backend's `FRONTEND_URL` env var.

---

## Step 6 — Database setup (Cloud SQL Postgres)

```bash
# Create instance
gcloud sql instances create medbill-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1

# Create database and user
gcloud sql databases create medbill --instance=medbill-db
gcloud sql users create medbill --instance=medbill-db --password=CHANGE_ME
```

Tables are created automatically by `db.create_all()` on first backend startup.

---

## Step 7 — Redis (simple test alternative)

For quick testing without Memorystore, use Redis Cloud free tier (30MB):
1. Create free account at redis.com/try-free
2. Get the `redis://...` connection string
3. Set it as `REDIS_URL` in the backend env vars

For production, use Cloud Memorystore:
```bash
gcloud redis instances create medbill-redis \
  --size=1 \
  --region=us-central1 \
  --redis-version=redis_7_0
```

---

## Step 8 — Seed demo data

```bash
curl -X POST https://medbill-backend-xxxx-uc.a.run.app/api/demo/seed
```

---

## Step 9 — Test the deployment

1. Open the frontend URL
2. Login with `firm@medbill.demo` / `Demo1234!`
3. Open case DEMO-001
4. Confirm negotiated rate shows 100% of Medicare
5. Create a funding batch from completed bills
6. Logout, login as `alice@funder.demo` / `Demo1234!`
7. Open Batch Queue — confirm the submitted batch appears
8. Fund the batch and confirm status updates

---

## Environment variable reference

See `backend/.env.production.example` for all backend variables.

### Funding math constants

| Variable                            | Default | Meaning                                  |
|-------------------------------------|---------|------------------------------------------|
| `DEFAULT_NEGOTIATED_RATE_MULTIPLIER`| `1.00`  | Provider payout as fraction of Medicare  |
| `FUNDER_MEDICARE_MULTIPLIER`        | `1.60`  | Funder pays 160% of Medicare             |
| `LAW_FIRM_SPREAD_PERCENT`           | `0.60`  | Law firm keeps 60% of the spread         |

---

## Persistent PDF uploads

The current setup stores PDFs in the container's `/app/uploads` folder, which is lost on redeployment. For production:

1. Create a Cloud Storage bucket
2. Replace `file.save(file_path)` in `app.py` with `google-cloud-storage` writes
3. Mount the bucket or use signed URLs for downloads

For the test environment, the current local approach is acceptable.
