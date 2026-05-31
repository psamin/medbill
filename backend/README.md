# MedBill Backend

Flask + SQLAlchemy + Redis backend for the medical bill processing platform.

## Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```bash
flask run --port 5000
# or
python app.py
```

## Health check

```
GET http://localhost:5000/api/health
```

## Environment

Copy `.env` and adjust values as needed. Never commit production secrets.

## Database

SQLite file lives at `instance/app.db` (auto-created on first run).

## Redis

Required for session auth. Start locally with:
```bash
redis-server
```
