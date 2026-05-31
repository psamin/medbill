# =============================================================================
# 1. IMPORTS
# =============================================================================
import os
import re
import json
import uuid
import secrets
from decimal import Decimal
from datetime import datetime
from functools import wraps

from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from sqlalchemy import text, Numeric
import redis

# =============================================================================
# 2. APP CONFIGURATION
# =============================================================================
load_dotenv()

app = Flask(__name__)

app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-change-me')
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///app.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = int(os.getenv('MAX_UPLOAD_MB', 10)) * 1024 * 1024
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'uploads')

FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost:3000')
SESSION_TTL = int(os.getenv('SESSION_TTL_SECONDS', 86400))

CORS(app, origins=[FRONTEND_URL], supports_credentials=True)

# =============================================================================
# 3. DATABASE SETUP
# =============================================================================
db = SQLAlchemy(app)

# =============================================================================
# 4. REDIS SETUP
# =============================================================================
REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
redis_client = None
REDIS_AVAILABLE = False

try:
    redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    redis_client.ping()
    REDIS_AVAILABLE = True
except Exception:
    redis_client = None
    REDIS_AVAILABLE = False

# =============================================================================
# 5. MODELS
# =============================================================================

class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(50), nullable=False)  # law_firm | provider | funder | admin
    organization_name = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    cases = db.relationship('PatientCase', backref='law_firm', lazy=True,
                            foreign_keys='PatientCase.law_firm_id')
    uploaded_bills = db.relationship('MedicalBill', backref='uploader', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'role': self.role,
            'organization_name': self.organization_name,
            'created_at': self.created_at.isoformat(),
        }


class PatientCase(db.Model):
    __tablename__ = 'patient_cases'

    id = db.Column(db.Integer, primary_key=True)
    patient_name = db.Column(db.String(255), nullable=False)
    case_number = db.Column(db.String(100), unique=True, nullable=False)
    law_firm_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    # active|bills_uploaded|provider_review|ready_for_funding|funder_review|funded|rejected|closed
    status = db.Column(db.String(50), default='active', nullable=False)
    total_billed_amount = db.Column(Numeric(12, 2), default=0)
    total_medicare_amount = db.Column(Numeric(12, 2), default=0)
    total_savings = db.Column(Numeric(12, 2), default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow,
                           onupdate=datetime.utcnow, nullable=False)

    bills = db.relationship('MedicalBill', backref='case', lazy=True)
    assignments = db.relationship('CaseAssignment', backref='case',
                                  lazy=True, foreign_keys='CaseAssignment.case_id')

    def to_dict(self):
        return {
            'id': self.id,
            'patient_name': self.patient_name,
            'case_number': self.case_number,
            'law_firm_id': self.law_firm_id,
            'status': self.status,
            'total_billed_amount': str(self.total_billed_amount),
            'total_medicare_amount': str(self.total_medicare_amount),
            'total_savings': str(self.total_savings),
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
        }


class MedicalBill(db.Model):
    __tablename__ = 'medical_bills'

    id = db.Column(db.Integer, primary_key=True)
    case_id = db.Column(db.Integer, db.ForeignKey('patient_cases.id'), nullable=False)
    uploaded_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    provider_name = db.Column(db.String(255), nullable=True)
    original_filename = db.Column(db.String(255), nullable=False)
    stored_filename = db.Column(db.String(255), nullable=False)
    file_path = db.Column(db.String(500), nullable=False)
    # uploaded | processing | completed | failed | review_ready
    status = db.Column(db.String(50), default='uploaded', nullable=False)
    # not_requested | funding_requested | under_review | funded | rejected
    funding_status = db.Column(db.String(50), default='not_requested', nullable=False)
    total_billed_amount = db.Column(Numeric(12, 2), default=0)
    total_medicare_amount = db.Column(Numeric(12, 2), default=0)
    total_savings = db.Column(Numeric(12, 2), default=0)
    savings_percentage = db.Column(Numeric(5, 2), default=0)
    average_billing_ratio = db.Column(Numeric(8, 4), default=0)
    line_item_count = db.Column(db.Integer, default=0)
    matched_line_item_count = db.Column(db.Integer, default=0)
    unmatched_line_item_count = db.Column(db.Integer, default=0)
    processing_confidence = db.Column(Numeric(5, 2), default=0)
    error_message = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow,
                           onupdate=datetime.utcnow, nullable=False)

    line_items = db.relationship('BillLineItem', backref='bill', lazy=True,
                                 cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'case_id': self.case_id,
            'uploaded_by_id': self.uploaded_by_id,
            'provider_name': self.provider_name,
            'original_filename': self.original_filename,
            'status': self.status,
            'funding_status': self.funding_status,
            'total_billed_amount': str(self.total_billed_amount),
            'total_medicare_amount': str(self.total_medicare_amount),
            'total_savings': str(self.total_savings),
            'savings_percentage': str(self.savings_percentage),
            'average_billing_ratio': str(self.average_billing_ratio),
            'line_item_count': self.line_item_count,
            'matched_line_item_count': self.matched_line_item_count,
            'unmatched_line_item_count': self.unmatched_line_item_count,
            'processing_confidence': str(self.processing_confidence),
            'error_message': self.error_message,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
        }


class BillLineItem(db.Model):
    __tablename__ = 'bill_line_items'

    id = db.Column(db.Integer, primary_key=True)
    medical_bill_id = db.Column(db.Integer, db.ForeignKey('medical_bills.id'), nullable=False)
    line_number = db.Column(db.Integer, nullable=True)
    description = db.Column(db.Text, nullable=True)
    code = db.Column(db.String(20), nullable=True)
    # CPT | HCPCS | REV | UNKNOWN
    code_type = db.Column(db.String(20), default='UNKNOWN', nullable=False)
    quantity = db.Column(Numeric(8, 2), default=1)
    billed_amount = db.Column(Numeric(12, 2), default=0)
    medicare_rate = db.Column(Numeric(12, 2), nullable=True)
    medicare_allowed_amount = db.Column(Numeric(12, 2), nullable=True)
    savings_amount = db.Column(Numeric(12, 2), nullable=True)
    billing_ratio = db.Column(Numeric(8, 4), nullable=True)
    # matched | unmatched | low_confidence
    match_status = db.Column(db.String(20), default='unmatched', nullable=False)
    confidence_score = db.Column(Numeric(5, 2), nullable=True)
    raw_text = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'medical_bill_id': self.medical_bill_id,
            'line_number': self.line_number,
            'description': self.description,
            'code': self.code,
            'code_type': self.code_type,
            'quantity': str(self.quantity),
            'billed_amount': str(self.billed_amount),
            'medicare_rate': str(self.medicare_rate) if self.medicare_rate is not None else None,
            'medicare_allowed_amount': str(self.medicare_allowed_amount) if self.medicare_allowed_amount is not None else None,
            'savings_amount': str(self.savings_amount) if self.savings_amount is not None else None,
            'billing_ratio': str(self.billing_ratio) if self.billing_ratio is not None else None,
            'match_status': self.match_status,
            'confidence_score': str(self.confidence_score) if self.confidence_score is not None else None,
            'created_at': self.created_at.isoformat(),
        }


class MedicareRate(db.Model):
    __tablename__ = 'medicare_rates'

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(20), nullable=False)
    # CPT | HCPCS
    code_type = db.Column(db.String(20), nullable=False)
    description = db.Column(db.Text, nullable=True)
    rate = db.Column(Numeric(12, 2), nullable=False)
    year = db.Column(db.Integer, nullable=False)
    locality = db.Column(db.String(100), nullable=True)
    # seeded | CMS_API
    source = db.Column(db.String(50), default='seeded', nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        db.UniqueConstraint('code', 'year', 'locality', name='uq_medicare_rate'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'code': self.code,
            'code_type': self.code_type,
            'description': self.description,
            'rate': str(self.rate),
            'year': self.year,
            'locality': self.locality,
            'source': self.source,
            'created_at': self.created_at.isoformat(),
        }


class CaseAssignment(db.Model):
    __tablename__ = 'case_assignments'

    id = db.Column(db.Integer, primary_key=True)
    case_id = db.Column(db.Integer, db.ForeignKey('patient_cases.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    # 'provider' | 'funder'
    role_on_case = db.Column(db.String(50), nullable=False)
    assigned_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    assignee = db.relationship('User', foreign_keys=[user_id])
    assigned_by = db.relationship('User', foreign_keys=[assigned_by_user_id])

    __table_args__ = (
        db.UniqueConstraint('case_id', 'user_id', name='uq_case_assignment'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'case_id': self.case_id,
            'user_id': self.user_id,
            'role_on_case': self.role_on_case,
            'assigned_by_user_id': self.assigned_by_user_id,
            'created_at': self.created_at.isoformat(),
            'user_email': self.assignee.email if self.assignee else None,
            'user_org': self.assignee.organization_name if self.assignee else None,
        }


# =============================================================================
# 6. HELPER FUNCTIONS
# =============================================================================

def success_response(data=None, message=None, status_code=200):
    payload = {'success': True}
    if message:
        payload['message'] = message
    if data is not None:
        payload['data'] = data
    return jsonify(payload), status_code


def error_response(message, status_code=400):
    return jsonify({'success': False, 'error': message}), status_code


def ensure_upload_dir():
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)


def can_user_access_case(user_id: int, role: str, case: 'PatientCase') -> bool:
    """Returns True if the user may read or act on this case."""
    if role == 'admin':
        return True
    if role == 'law_firm':
        return case.law_firm_id == user_id
    # provider and funder — must be explicitly assigned
    return db.session.query(CaseAssignment).filter_by(
        case_id=case.id, user_id=user_id
    ).first() is not None


def can_user_access_bill(user_id: int, role: str, bill: 'MedicalBill') -> bool:
    """Bill access is derived from case access."""
    if role == 'admin':
        return True
    case = db.session.get(PatientCase, bill.case_id)
    if not case:
        return False
    return can_user_access_case(user_id, role, case)


# Matches: <CPT or HCPCS code>  <description text>  $<amount>
_LINE_RE = re.compile(
    r'\b([A-Z]\d{4}|\d{5})\b'   # CPT (5 digits) or HCPCS (letter + 4 digits)
    r'\s+'
    r'(.+?)'                      # description (non-greedy)
    r'\s+\$\s*([0-9,]+\.\d{2})'  # dollar amount
    r'\s*$',
    re.MULTILINE,
)


def extract_text_from_pdf(file_path: str) -> str:
    import pdfplumber
    pages = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                pages.append(text)
    return '\n'.join(pages)


def parse_line_items(text: str) -> list:
    items = []
    for line_num, line in enumerate(text.splitlines(), 1):
        m = _LINE_RE.search(line.strip())
        if not m:
            continue
        code = m.group(1).upper()
        description = m.group(2).strip()
        amount_str = m.group(3).replace(',', '')
        try:
            billed_amount = Decimal(amount_str)
        except Exception:
            continue
        code_type = 'HCPCS' if code[0].isalpha() else 'CPT'
        items.append({
            'line_number': line_num,
            'code': code,
            'code_type': code_type,
            'description': description,
            'quantity': Decimal('1'),
            'billed_amount': billed_amount,
            'raw_text': line.strip(),
        })
    return items


def update_case_totals(case_id: int) -> None:
    case = db.session.get(PatientCase, case_id)
    if not case:
        return
    completed = MedicalBill.query.filter_by(case_id=case_id, status='completed').all()
    case.total_billed_amount = sum(Decimal(str(b.total_billed_amount or 0)) for b in completed)
    case.total_medicare_amount = sum(Decimal(str(b.total_medicare_amount or 0)) for b in completed)
    case.total_savings = sum(Decimal(str(b.total_savings or 0)) for b in completed)
    case.updated_at = datetime.utcnow()
    db.session.commit()


RATE_CACHE_TTL = int(os.getenv('RATE_CACHE_TTL_SECONDS', 86400))


def _lookup_cms_api(code: str, year: int) -> dict | None:
    """
    Look up a HCPCS/CPT code against the CMS Medicare Physician &
    Other Practitioners - by Geography and Service dataset.
    Returns {rate, description, code_type, locality, year} or None.
    Never raises.

    Dataset: https://data.cms.gov/data-api/v1/dataset/
             6fea9d79-0129-4e4c-b1b8-23cd86a4f435/data
    Field used: Avg_Mdcr_Alowd_Amt (national average Medicare allowed amount)
    """
    import urllib.request
    import urllib.parse

    cms_url = os.getenv(
        'CMS_API_URL',
        'https://data.cms.gov/data-api/v1/dataset/'
        '6fea9d79-0129-4e4c-b1b8-23cd86a4f435/data',
    ).strip()

    try:
        params = urllib.parse.urlencode({
            'filter[Rndrng_Prvdr_Geo_Lvl]': 'National',
            'filter[HCPCS_Cd]': code.upper(),
            'filter[Place_Of_Srvc]': 'O',   # office/outpatient
            'limit': '1',
        })
        req = urllib.request.Request(
            f'{cms_url}?{params}',
            headers={'Accept': 'application/json'},
        )
        api_key = os.getenv('CMS_API_KEY', '').strip()
        if api_key:
            req.add_header('Authorization', f'Bearer {api_key}')

        with urllib.request.urlopen(req, timeout=10) as resp:
            records = json.loads(resp.read().decode())

        if not records:
            return None

        row = records[0]
        raw_rate = row.get('Avg_Mdcr_Alowd_Amt')
        if not raw_rate:
            return None

        return {
            'rate':        str(round(float(raw_rate), 2)),
            'description': row.get('HCPCS_Desc', ''),
            'code_type':   'HCPCS' if code[0].isalpha() else 'CPT',
            'locality':    'national',
            'year':        year,
        }
    except Exception as exc:
        app.logger.warning('CMS API lookup failed for %s: %s', code, exc)
        return None


def get_or_fetch_rate(code: str, year: int | None = None) -> 'MedicareRate | None':
    """
    Look up a Medicare rate using a three-tier fallback:
      1. Local DB  (permanent store)
      2. Redis cache  (avoids repeat CMS calls within RATE_CACHE_TTL)
      3. CMS API  (saves to DB + Redis on success)
    Returns a MedicareRate ORM object, or None if nothing found.
    """
    code = code.upper()
    if year is None:
        year = datetime.utcnow().year

    # 1 — local DB (most common path)
    rate = MedicareRate.query.filter_by(code=code).order_by(
        MedicareRate.year.desc()
    ).first()
    if rate:
        return rate

    cache_key = f'medicare_rate:{code}:{year}'

    # 2 — Redis cache (avoids CMS round-trip for recently fetched unknown codes)
    if redis_client:
        cached = redis_client.get(cache_key)
        if cached == 'NOT_FOUND':
            return None  # previous CMS miss — don't retry until TTL expires
        if cached:
            try:
                d = json.loads(cached)
                rate = MedicareRate(
                    code=code,
                    code_type=d.get('code_type', 'HCPCS' if code[0].isalpha() else 'CPT'),
                    description=d.get('description'),
                    rate=d['rate'],
                    year=year,
                    locality=d.get('locality', 'national'),
                    source='CMS_API',
                )
                # Persist so future calls hit the DB
                db.session.add(rate)
                db.session.commit()
                return rate
            except Exception:
                pass  # bad cache entry — fall through to CMS

    # 3 — CMS API
    cms_data = _lookup_cms_api(code, year)

    if not cms_data or not cms_data.get('rate'):
        # Cache the miss so we don't hammer CMS for the same unknown code
        if redis_client:
            redis_client.setex(cache_key, RATE_CACHE_TTL, 'NOT_FOUND')
        return None

    try:
        rate = MedicareRate(
            code=code,
            code_type=cms_data.get('code_type', 'HCPCS' if code[0].isalpha() else 'CPT'),
            description=cms_data.get('description'),
            rate=str(cms_data['rate']),
            year=year,
            locality=cms_data.get('locality', 'national'),
            source='CMS_API',
        )
        db.session.add(rate)
        db.session.commit()

        if redis_client:
            redis_client.setex(cache_key, RATE_CACHE_TTL, json.dumps(rate.to_dict()))

        return rate
    except Exception as exc:
        app.logger.warning('Failed to persist CMS rate for %s: %s', code, exc)
        db.session.rollback()
        return None


def _extract_with_claude(text: str) -> list:
    """
    Fallback line-item extractor for bills the regex cannot parse.
    Sends the bill text to Claude Haiku and returns a normalised list
    of item dicts in the same shape parse_line_items() returns.
    Never raises — returns [] on any failure or missing API key.
    """
    api_key = os.getenv('ANTHROPIC_API_KEY', '').strip()
    if not api_key:
        return []

    try:
        import anthropic
    except ImportError:
        app.logger.warning('anthropic package not installed — run pip install anthropic')
        return []

    try:
        client = anthropic.Anthropic(api_key=api_key)
        model = os.getenv('CLAUDE_EXTRACTION_MODEL', 'claude-haiku-4-5-20251001')

        response = client.messages.create(
            model=model,
            max_tokens=2048,
            system=(
                'You are a medical billing specialist. '
                'Extract every line item from the bill text the user provides. '
                'Return ONLY a valid JSON array — no explanation, no markdown fences. '
                'Each element must have exactly these keys:\n'
                '  code        — CPT or HCPCS procedure code string (e.g. "99213", "J0696")\n'
                '  code_type   — "CPT" for 5-digit numeric, "HCPCS" for letter+4-digit, '
                '"REV" for revenue codes, "UNKNOWN" if unclear\n'
                '  description — procedure description string\n'
                '  quantity    — numeric units billed (default 1)\n'
                '  billed_amount — charged amount as a string without $ or commas (e.g. "350.00")\n'
                'Omit rows that have no medical code or no dollar amount. '
                'Do NOT include subtotals, totals, or header rows. '
                'If nothing is found return [].'
            ),
            messages=[{
                'role': 'user',
                'content': f'Extract all line items from this medical bill:\n\n{text[:8000]}',
            }],
        )

        raw = response.content[0].text.strip()
        # Strip accidental markdown fences
        if '```' in raw:
            raw = raw.split('```')[1]
            if raw.lower().startswith('json'):
                raw = raw[4:]
        raw = raw.strip()

        items = json.loads(raw)
        if not isinstance(items, list):
            return []

        result = []
        for i, item in enumerate(items, 1):
            code = str(item.get('code') or '').strip().upper()
            amount_raw = str(item.get('billed_amount') or '').replace(',', '').replace('$', '').strip()
            if not code or not amount_raw:
                continue
            try:
                billed = Decimal(amount_raw)
                qty = Decimal(str(item.get('quantity', 1)))
            except Exception:
                continue
            result.append({
                'line_number': i,
                'code':        code,
                'code_type':   str(item.get('code_type', 'UNKNOWN')),
                'description': str(item.get('description', '')).strip(),
                'quantity':    qty,
                'billed_amount': billed,
                'raw_text':    str(item.get('description', '')).strip(),
            })

        return result

    except Exception as exc:
        app.logger.warning('Claude extraction failed: %s', exc)
        return []


def process_bill(bill: 'MedicalBill') -> None:
    """Extract text from PDF, parse line items, match Medicare rates, update bill."""
    bill.status = 'processing'
    db.session.commit()

    try:
        text = extract_text_from_pdf(bill.file_path)
        if not text.strip():
            raise ValueError('No text could be extracted from this PDF')

        raw_items = parse_line_items(text)

        if not raw_items:
            app.logger.info('Regex found 0 items for bill %s — trying Claude', bill.id)
            raw_items = _extract_with_claude(text)

        if not raw_items:
            raise ValueError(
                'No line items could be extracted. '
                'If this is a scanned bill, please upload a text-based PDF.'
            )

        total_billed = Decimal('0')
        total_medicare = Decimal('0')
        matched = 0
        unmatched = 0
        ratios = []

        for item in raw_items:
            code = item['code']
            qty = item['quantity']
            billed = item['billed_amount']

            rate_obj = get_or_fetch_rate(code)

            li = BillLineItem(
                medical_bill_id=bill.id,
                line_number=item['line_number'],
                description=item['description'],
                code=code,
                code_type=item['code_type'],
                quantity=qty,
                billed_amount=billed,
                raw_text=item['raw_text'],
            )

            if rate_obj:
                medicare_rate = Decimal(str(rate_obj.rate))
                medicare_allowed = (medicare_rate * qty).quantize(Decimal('0.01'))
                savings = (billed - medicare_allowed).quantize(Decimal('0.01'))
                ratio = (billed / medicare_allowed).quantize(Decimal('0.0001')) if medicare_allowed else None

                li.medicare_rate = medicare_rate
                li.medicare_allowed_amount = medicare_allowed
                li.savings_amount = savings
                li.billing_ratio = ratio
                li.match_status = 'matched'
                li.confidence_score = Decimal('95.00')

                total_medicare += medicare_allowed
                if ratio:
                    ratios.append(ratio)
                matched += 1
            else:
                li.match_status = 'unmatched'
                unmatched += 1

            total_billed += billed
            db.session.add(li)

        total_savings = (total_billed - total_medicare).quantize(Decimal('0.01'))
        savings_pct = (total_savings / total_billed * 100).quantize(Decimal('0.01')) if total_billed else Decimal('0')
        avg_ratio = (sum(ratios) / len(ratios)).quantize(Decimal('0.0001')) if ratios else Decimal('0')

        bill.status = 'completed'
        bill.total_billed_amount = total_billed
        bill.total_medicare_amount = total_medicare
        bill.total_savings = total_savings
        bill.savings_percentage = savings_pct
        bill.average_billing_ratio = avg_ratio
        bill.line_item_count = len(raw_items)
        bill.matched_line_item_count = matched
        bill.unmatched_line_item_count = unmatched
        bill.processing_confidence = Decimal('95.00') if matched == len(raw_items) else Decimal('70.00')
        db.session.commit()

        update_case_totals(bill.case_id)

    except Exception as e:
        bill.status = 'failed'
        bill.error_message = str(e)
        db.session.commit()


# =============================================================================
# 7. AUTH / SESSION HELPERS
# =============================================================================

def _extract_bearer_token():
    """Returns (token, None) or (None, error_response tuple)."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return None, error_response('Missing or invalid Authorization header', 401)
    return auth_header.split(' ', 1)[1], None


def generate_session_token():
    return secrets.token_urlsafe(32)


def create_session(user):
    """Stores session data in Redis. Returns the session token."""
    token = generate_session_token()
    session_data = {
        'user_id': user.id,
        'email': user.email,
        'role': user.role,
        'organization_name': user.organization_name or '',
    }
    redis_client.setex(f'session:{token}', SESSION_TTL, json.dumps(session_data))
    return token


def get_session(token):
    """Returns session dict from Redis, or None if missing/expired."""
    if not redis_client:
        return None
    raw = redis_client.get(f'session:{token}')
    return json.loads(raw) if raw else None


def delete_session(token):
    if redis_client:
        redis_client.delete(f'session:{token}')


def require_auth(f):
    """Decorator: validates Bearer token, injects `session` kwarg."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token, err = _extract_bearer_token()
        if err:
            return err
        session = get_session(token)
        if session is None:
            return error_response('Session expired or invalid', 401)
        kwargs['session'] = session
        return f(*args, **kwargs)
    return decorated


def require_role(*roles):
    """Decorator factory: validates role after auth check."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            token, err = _extract_bearer_token()
            if err:
                return err
            session = get_session(token)
            if session is None:
                return error_response('Session expired or invalid', 401)
            if session.get('role') not in roles:
                return error_response('Insufficient permissions', 403)
            kwargs['session'] = session
            return f(*args, **kwargs)
        return decorated
    return decorator


# =============================================================================
# 8. AUTH ROUTES
# =============================================================================

VALID_ROLES = ('law_firm', 'provider', 'funder', 'admin')


@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    role = data.get('role') or ''
    organization_name = (data.get('organization_name') or '').strip() or None

    if not email or not password or not role:
        return error_response('email, password, and role are required')
    if role not in VALID_ROLES:
        return error_response(f'role must be one of: {", ".join(VALID_ROLES)}')
    if len(password) < 8:
        return error_response('password must be at least 8 characters')
    if db.session.query(User).filter_by(email=email).first():
        return error_response('Email already registered', 409)

    user = User(
        email=email,
        password_hash=generate_password_hash(password),
        role=role,
        organization_name=organization_name,
    )
    db.session.add(user)
    db.session.commit()
    return success_response(data=user.to_dict(), message='Registration successful', status_code=201)


@app.route('/api/auth/login', methods=['POST'])
def login():
    if not REDIS_AVAILABLE:
        return error_response('Auth service unavailable: Redis is not connected', 503)

    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    if not email or not password:
        return error_response('email and password are required')

    user = db.session.query(User).filter_by(email=email).first()
    if not user or not check_password_hash(user.password_hash, password):
        return error_response('Invalid email or password', 401)

    token = create_session(user)
    return success_response(data={'token': token, 'user': user.to_dict()})


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    token, err = _extract_bearer_token()
    if err:
        return err
    delete_session(token)
    return success_response(message='Logged out successfully')


@app.route('/api/auth/me', methods=['GET'])
@require_auth
def me(session):
    user = db.session.get(User, session['user_id'])
    if not user:
        return error_response('User not found', 404)
    return success_response(data=user.to_dict())


# =============================================================================
# 9. CASE ROUTES
# =============================================================================

VALID_STATUSES = (
    'active',
    'bills_uploaded',
    'provider_review',
    'ready_for_funding',
    'funder_review',
    'funded',
    'rejected',
    'closed',
    'reviewing_bills',  # legacy compat
)


@app.route('/api/cases', methods=['POST'])
@require_role('law_firm', 'admin')
def create_case(session):
    data = request.get_json(silent=True) or {}
    patient_name = (data.get('patient_name') or '').strip()
    case_number = (data.get('case_number') or '').strip()

    if not patient_name or not case_number:
        return error_response('patient_name and case_number are required')
    if PatientCase.query.filter_by(case_number=case_number).first():
        return error_response('Case number already exists', 409)

    case = PatientCase(
        patient_name=patient_name,
        case_number=case_number,
        law_firm_id=session['user_id'],
    )
    db.session.add(case)
    db.session.commit()
    return success_response(data=case.to_dict(), status_code=201)


@app.route('/api/cases', methods=['GET'])
@require_auth
def list_cases(session):
    role = session['role']
    user_id = session['user_id']

    if role == 'admin':
        cases = PatientCase.query.order_by(PatientCase.created_at.desc()).all()
    elif role == 'law_firm':
        cases = PatientCase.query.filter_by(
            law_firm_id=user_id
        ).order_by(PatientCase.created_at.desc()).all()
    else:  # provider or funder — only assigned cases
        assigned_ids = db.session.query(CaseAssignment.case_id).filter_by(user_id=user_id)
        cases = PatientCase.query.filter(
            PatientCase.id.in_(assigned_ids)
        ).order_by(PatientCase.created_at.desc()).all()

    return success_response(data=[c.to_dict() for c in cases])


@app.route('/api/cases/<int:case_id>', methods=['GET'])
@require_auth
def get_case(case_id, session):
    case = db.session.get(PatientCase, case_id)
    if not case:
        return error_response('Case not found', 404)
    if not can_user_access_case(session['user_id'], session['role'], case):
        return error_response('Case not found', 404)

    case_data = case.to_dict()
    case_data['bills'] = [b.to_dict() for b in case.bills]
    case_data['assignments'] = [a.to_dict() for a in case.assignments]
    return success_response(data=case_data)


@app.route('/api/cases/<int:case_id>', methods=['PATCH'])
@require_auth
def update_case(case_id, session):
    case = db.session.get(PatientCase, case_id)
    if not case:
        return error_response('Case not found', 404)

    if not can_user_access_case(session['user_id'], session['role'], case):
        return error_response('Forbidden', 403)
    if session['role'] not in ('law_firm', 'admin'):
        return error_response('Forbidden', 403)

    data = request.get_json(silent=True) or {}

    if 'patient_name' in data:
        case.patient_name = data['patient_name'].strip()
    if 'case_number' in data:
        new_number = data['case_number'].strip()
        existing = PatientCase.query.filter_by(case_number=new_number).first()
        if existing and existing.id != case_id:
            return error_response('Case number already exists', 409)
        case.case_number = new_number
    if 'status' in data:
        if data['status'] not in VALID_STATUSES:
            return error_response(f'status must be one of: {", ".join(VALID_STATUSES)}')
        case.status = data['status']

    case.updated_at = datetime.utcnow()
    db.session.commit()
    return success_response(data=case.to_dict())


# =============================================================================
# 10. BILL ROUTES
# =============================================================================

ALLOWED_EXTENSIONS = {'pdf'}


def allowed_file(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/api/cases/<int:case_id>/bills/upload', methods=['POST'])
@require_auth
def upload_bill(case_id, session):
    case = db.session.get(PatientCase, case_id)
    if not case:
        return error_response('Case not found', 404)

    role = session['role']
    if role == 'funder':
        return error_response('Funders cannot upload bills', 403)
    if not can_user_access_case(session['user_id'], role, case):
        return error_response('Forbidden', 403)

    if 'file' not in request.files:
        return error_response('No file provided')
    file = request.files['file']
    if not file.filename:
        return error_response('No file selected')
    if not allowed_file(file.filename):
        return error_response('Only PDF files are allowed')

    provider_name = (request.form.get('provider_name') or '').strip() or None
    # Auto-populate provider name from uploader's org if they are a provider
    if not provider_name and role == 'provider':
        provider_name = session.get('organization_name') or None
    # Advance case status on first upload
    if case.status == 'active':
        case.status = 'bills_uploaded'
    original_filename = secure_filename(file.filename)
    stored_filename = f"{uuid.uuid4().hex}_{original_filename}"
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], stored_filename)
    file.save(file_path)

    bill = MedicalBill(
        case_id=case_id,
        uploaded_by_id=session['user_id'],
        provider_name=provider_name,
        original_filename=original_filename,
        stored_filename=stored_filename,
        file_path=file_path,
        status='uploaded',
    )
    db.session.add(bill)
    db.session.commit()

    process_bill(bill)
    db.session.refresh(bill)
    return success_response(data=bill.to_dict(), status_code=201)


@app.route('/api/bills', methods=['GET'])
@require_auth
def list_bills(session):
    role = session['role']
    user_id = session['user_id']

    if role == 'admin':
        bills = MedicalBill.query.order_by(MedicalBill.created_at.desc()).all()
    elif role == 'law_firm':
        bills = (
            MedicalBill.query
            .join(PatientCase)
            .filter(PatientCase.law_firm_id == user_id)
            .order_by(MedicalBill.created_at.desc())
            .all()
        )
    else:  # provider or funder — bills on assigned cases only
        assigned_ids = db.session.query(CaseAssignment.case_id).filter_by(user_id=user_id)
        bills = (
            MedicalBill.query
            .filter(MedicalBill.case_id.in_(assigned_ids))
            .order_by(MedicalBill.created_at.desc())
            .all()
        )

    return success_response(data=[b.to_dict() for b in bills])


@app.route('/api/bills/<int:bill_id>', methods=['GET'])
@require_auth
def get_bill(bill_id, session):
    bill = db.session.get(MedicalBill, bill_id)
    if not bill:
        return error_response('Bill not found', 404)

    if not can_user_access_bill(session['user_id'], session['role'], bill):
        return error_response('Bill not found', 404)

    bill_data = bill.to_dict()
    bill_data['line_items'] = [li.to_dict() for li in bill.line_items]
    return success_response(data=bill_data)


@app.route('/api/bills/<int:bill_id>/line-items', methods=['GET'])
@require_auth
def get_bill_line_items(bill_id, session):
    bill = db.session.get(MedicalBill, bill_id)
    if not bill:
        return error_response('Bill not found', 404)

    if not can_user_access_bill(session['user_id'], session['role'], bill):
        return error_response('Bill not found', 404)

    return success_response(data=[li.to_dict() for li in bill.line_items])


@app.route('/api/bills/<int:bill_id>/request-funding', methods=['POST'])
@require_auth
def request_funding(bill_id, session):
    bill = db.session.get(MedicalBill, bill_id)
    if not bill:
        return error_response('Bill not found', 404)

    if session['role'] != 'law_firm':
        return error_response('Only law firms can request funding', 403)
    if not can_user_access_bill(session['user_id'], session['role'], bill):
        return error_response('Forbidden', 403)
    if bill.status != 'completed':
        return error_response('Bill must be fully processed before requesting funding')
    if bill.funding_status != 'not_requested':
        return error_response(f'Funding already {bill.funding_status.replace("_", " ")}')

    bill.funding_status = 'funding_requested'
    bill.status = 'review_ready'
    bill.updated_at = datetime.utcnow()
    db.session.commit()
    return success_response(data=bill.to_dict(), message='Funding requested successfully')


@app.route('/api/bills/<int:bill_id>/mark-funded', methods=['POST'])
@require_role('funder', 'admin')
def mark_funded(bill_id, session):
    bill = db.session.get(MedicalBill, bill_id)
    if not bill:
        return error_response('Bill not found', 404)
    if not can_user_access_bill(session['user_id'], session['role'], bill):
        return error_response('Bill not found', 404)
    if bill.funding_status not in ('funding_requested', 'under_review'):
        return error_response(f'Bill is not awaiting review (status: {bill.funding_status})')

    bill.funding_status = 'funded'
    bill.updated_at = datetime.utcnow()
    db.session.commit()
    return success_response(data=bill.to_dict(), message='Bill marked as funded')


@app.route('/api/bills/<int:bill_id>/reject-funding', methods=['POST'])
@require_role('funder', 'admin')
def reject_funding(bill_id, session):
    bill = db.session.get(MedicalBill, bill_id)
    if not bill:
        return error_response('Bill not found', 404)
    if not can_user_access_bill(session['user_id'], session['role'], bill):
        return error_response('Bill not found', 404)
    if bill.funding_status not in ('funding_requested', 'under_review'):
        return error_response(f'Bill is not awaiting review (status: {bill.funding_status})')

    data = request.get_json(silent=True) or {}
    reason = (data.get('reason') or '').strip() or None

    bill.funding_status = 'rejected'
    bill.error_message = f'Funding rejected: {reason}' if reason else 'Funding rejected'
    bill.updated_at = datetime.utcnow()
    db.session.commit()
    return success_response(data=bill.to_dict(), message='Funding rejected')


# =============================================================================
# 10.5  ASSIGNMENT ROUTES
# =============================================================================

@app.route('/api/cases/<int:case_id>/assignments', methods=['GET'])
@require_auth
def list_case_assignments(case_id, session):
    case = db.session.get(PatientCase, case_id)
    if not case:
        return error_response('Case not found', 404)
    if not can_user_access_case(session['user_id'], session['role'], case):
        return error_response('Forbidden', 403)
    return success_response(data=[a.to_dict() for a in case.assignments])


@app.route('/api/cases/<int:case_id>/assignments', methods=['POST'])
@require_role('law_firm', 'admin')
def create_assignment(case_id, session):
    case = db.session.get(PatientCase, case_id)
    if not case:
        return error_response('Case not found', 404)
    if session['role'] == 'law_firm' and case.law_firm_id != session['user_id']:
        return error_response('Forbidden', 403)

    data = request.get_json(silent=True) or {}
    user_id = data.get('user_id')
    role_on_case = data.get('role_on_case')

    if not user_id or not role_on_case:
        return error_response('user_id and role_on_case are required')
    if role_on_case not in ('provider', 'funder'):
        return error_response('role_on_case must be provider or funder')

    target = db.session.get(User, user_id)
    if not target:
        return error_response('User not found', 404)
    if target.role != role_on_case:
        return error_response(
            f'User role ({target.role}) does not match role_on_case ({role_on_case})'
        )

    existing = CaseAssignment.query.filter_by(case_id=case_id, user_id=user_id).first()
    if existing:
        return success_response(data=existing.to_dict(), message='Already assigned')

    assignment = CaseAssignment(
        case_id=case_id,
        user_id=user_id,
        role_on_case=role_on_case,
        assigned_by_user_id=session['user_id'],
    )
    db.session.add(assignment)
    db.session.commit()
    return success_response(data=assignment.to_dict(), status_code=201)


@app.route('/api/cases/<int:case_id>/assignments/<int:assignment_id>', methods=['DELETE'])
@require_role('law_firm', 'admin')
def delete_assignment(case_id, assignment_id, session):
    case = db.session.get(PatientCase, case_id)
    if not case:
        return error_response('Case not found', 404)
    if session['role'] == 'law_firm' and case.law_firm_id != session['user_id']:
        return error_response('Forbidden', 403)

    assignment = CaseAssignment.query.filter_by(id=assignment_id, case_id=case_id).first()
    if not assignment:
        return error_response('Assignment not found', 404)

    db.session.delete(assignment)
    db.session.commit()
    return success_response(message='Assignment removed')


@app.route('/api/users', methods=['GET'])
@require_role('law_firm', 'admin')
def list_assignable_users(session):
    """Returns providers and funders for the assignment dropdown."""
    role_filter = request.args.get('role')
    query = User.query.filter(User.role.in_(['provider', 'funder']))
    if role_filter in ('provider', 'funder'):
        query = query.filter_by(role=role_filter)
    users = query.order_by(User.organization_name).all()
    return success_response(data=[u.to_dict() for u in users])


# =============================================================================
# 11. MEDICARE RATE ROUTES
# =============================================================================

def _run_cms_sync(codes: list | None = None) -> dict:
    """Shared logic for both /seed and /sync-from-cms endpoints."""
    if codes:
        records = MedicareRate.query.filter(
            MedicareRate.code.in_([c.upper() for c in codes])
        ).all()
    else:
        records = MedicareRate.query.all()

    updated = not_found = failed = 0
    for rec in records:
        cms = _lookup_cms_api(rec.code, rec.year)
        if cms and cms.get('rate'):
            try:
                rec.rate = cms['rate']
                rec.description = cms.get('description') or rec.description
                rec.source = 'CMS_API'
                if redis_client:
                    redis_client.delete(f'medicare_rate:{rec.code}:{rec.year}')
                updated += 1
            except Exception:
                failed += 1
        else:
            not_found += 1

    db.session.commit()
    return {'updated': updated, 'not_found_in_cms': not_found, 'failed': failed}


@app.route('/api/medicare-rates/seed', methods=['POST'])
@require_auth
def seed_medicare_rates(session):
    """Alias for sync-from-cms — kept for backwards compatibility."""
    result = _run_cms_sync()
    return success_response(data=result, message=f'Synced {result["updated"]} rates from CMS')


@app.route('/api/medicare-rates/sync-from-cms', methods=['POST'])
@require_auth
def sync_rates_from_cms(session):
    """
    Refresh every rate in the DB with the real CMS average allowed amount.
    Accepts optional JSON body: {"codes": ["99213", "99214"]} to sync a subset.
    """
    data = request.get_json(silent=True) or {}
    codes = [c.strip() for c in data.get('codes', []) if c.strip()] or None
    result = _run_cms_sync(codes)
    return success_response(data=result, message=f'Synced {result["updated"]} rates from CMS')


@app.route('/api/medicare-rates/<string:code>', methods=['GET'])
@require_auth
def get_medicare_rate(code, session):
    year = request.args.get('year', type=int)
    rate = get_or_fetch_rate(code.strip(), year)
    if not rate:
        return error_response(f'No Medicare rate found for code {code.upper()}', 404)
    return success_response(data=rate.to_dict(), message='CMS_API' if rate.source == 'CMS_API' else None)


# =============================================================================
# 12. DASHBOARD ROUTES
# =============================================================================

@app.route('/api/dashboard/summary', methods=['GET'])
@require_auth
def dashboard_summary(session):
    role = session['role']
    user_id = session['user_id']

    if role == 'admin':
        cases = PatientCase.query.all()
    elif role == 'law_firm':
        cases = PatientCase.query.filter_by(law_firm_id=user_id).all()
    else:  # provider or funder — only assigned cases
        assigned_ids = db.session.query(CaseAssignment.case_id).filter_by(user_id=user_id)
        cases = PatientCase.query.filter(PatientCase.id.in_(assigned_ids)).all()

    total_billed   = sum(Decimal(str(c.total_billed_amount   or 0)) for c in cases)
    total_medicare = sum(Decimal(str(c.total_medicare_amount or 0)) for c in cases)
    total_savings  = sum(Decimal(str(c.total_savings         or 0)) for c in cases)

    status_counts: dict = {}
    for c in cases:
        status_counts[c.status] = status_counts.get(c.status, 0) + 1

    data = {
        'total_cases':    len(cases),
        'total_billed':   str(total_billed),
        'total_medicare': str(total_medicare),
        'total_savings':  str(total_savings),
        'status_counts':  status_counts,
    }

    if role == 'law_firm':
        data['bills_awaiting_funder'] = MedicalBill.query.join(PatientCase).filter(
            PatientCase.law_firm_id == user_id,
            MedicalBill.funding_status == 'funding_requested',
        ).count()
        data['active_cases'] = sum(1 for c in cases if c.status == 'active')
        data['ready_for_funding'] = sum(
            1 for c in cases if c.status == 'ready_for_funding'
        )

    elif role == 'provider':
        data['my_bills_count'] = MedicalBill.query.filter_by(
            uploaded_by_id=user_id
        ).count()
        data['bills_pending_review'] = MedicalBill.query.filter_by(
            uploaded_by_id=user_id, status='uploaded'
        ).count()

    elif role == 'funder':
        assigned_ids = db.session.query(CaseAssignment.case_id).filter_by(user_id=user_id)
        data['pending_review'] = MedicalBill.query.filter(
            MedicalBill.case_id.in_(assigned_ids),
            MedicalBill.funding_status.in_(['funding_requested', 'under_review']),
        ).count()
        data['ready_for_funding'] = sum(
            1 for c in cases if c.status in ('ready_for_funding', 'funder_review')
        )

    elif role == 'admin':
        data['pending_review'] = MedicalBill.query.filter(
            MedicalBill.funding_status.in_(['funding_requested', 'under_review'])
        ).count()

    return success_response(data=data)


# =============================================================================
# 13. HEALTH ROUTE
# =============================================================================

@app.route('/api/health', methods=['GET'])
def health():
    status = {
        'status': 'ok',
        'database': 'unknown',
        'redis': 'unknown',
    }

    try:
        db.session.execute(text('SELECT 1'))
        status['database'] = 'ok'
    except Exception as e:
        status['database'] = f'error: {str(e)}'
        status['status'] = 'degraded'

    try:
        if redis_client and redis_client.ping():
            status['redis'] = 'ok'
        else:
            status['redis'] = 'unavailable'
            status['status'] = 'degraded'
    except Exception as e:
        status['redis'] = f'error: {str(e)}'
        status['status'] = 'degraded'

    http_status = 200 if status['status'] == 'ok' else 503
    return jsonify(status), http_status


# =============================================================================
# 13.5  DEMO SEED ROUTE
# =============================================================================

@app.route('/api/demo/seed', methods=['POST'])
def seed_demo():
    """Idempotent demo data seed. Only available in development."""
    if os.getenv('FLASK_ENV') != 'development':
        return error_response('Not available', 404)

    DEMO_USERS = [
        # Existing demo users
        {'email': 'henry@lawfirm.demo',      'password': 'Demo1234!', 'role': 'law_firm',  'org': 'Henry & Associates'},
        {'email': 'provider1@demo.com',       'password': 'Demo1234!', 'role': 'provider',  'org': 'City General Hospital'},
        {'email': 'provider2@demo.com',       'password': 'Demo1234!', 'role': 'provider',  'org': 'Metro Orthopedics'},
        {'email': 'alice@funder.demo',        'password': 'Demo1234!', 'role': 'funder',    'org': 'Alice Capital'},
        {'email': 'funder2@funder.demo',      'password': 'Demo1234!', 'role': 'funder',    'org': 'Second Fund LLC'},
        # Video demo users — clean credentials for recording
        {'email': 'firm@medbill.demo',        'password': 'Demo1234!', 'role': 'law_firm',  'org': 'Smith Legal Group'},
        {'email': 'provider@medbill.demo',    'password': 'Demo1234!', 'role': 'provider',  'org': 'Riverside Medical Center'},
        {'email': 'funder@medbill.demo',      'password': 'Demo1234!', 'role': 'funder',    'org': 'MedFund Capital'},
    ]
    users: dict = {}
    for u in DEMO_USERS:
        obj = User.query.filter_by(email=u['email']).first()
        if not obj:
            obj = User(
                email=u['email'],
                password_hash=generate_password_hash(u['password']),
                role=u['role'],
                organization_name=u['org'],
            )
            db.session.add(obj)
            db.session.flush()
        users[u['email']] = obj

    henry = users['henry@lawfirm.demo']
    firm  = users['firm@medbill.demo']

    DEMO_CASES = [
        # Existing cases (owned by henry)
        {'patient_name': 'John Smith',     'case_number': 'DEMO-001', 'status': 'ready_for_funding', 'owner': henry},
        {'patient_name': 'Jane Doe',       'case_number': 'DEMO-002', 'status': 'provider_review',   'owner': henry},
        {'patient_name': 'Bob Johnson',    'case_number': 'DEMO-003', 'status': 'active',            'owner': henry},
        # Video demo case — starts clean for recording
        {'patient_name': 'Maria Gonzalez', 'case_number': 'VIDEO-001', 'status': 'active',           'owner': firm},
    ]
    cases: dict = {}
    for c in DEMO_CASES:
        obj = PatientCase.query.filter_by(case_number=c['case_number']).first()
        if not obj:
            obj = PatientCase(
                patient_name=c['patient_name'],
                case_number=c['case_number'],
                law_firm_id=c['owner'].id,
                status=c['status'],
            )
            db.session.add(obj)
            db.session.flush()
        cases[c['case_number']] = obj

    ASSIGNMENTS = [
        # Existing assignments
        ('DEMO-001', 'alice@funder.demo',       'funder'),
        ('DEMO-001', 'provider1@demo.com',      'provider'),
        ('DEMO-002', 'provider2@demo.com',      'provider'),
        ('DEMO-002', 'alice@funder.demo',       'funder'),
        ('DEMO-003', 'provider1@demo.com',      'provider'),
        ('DEMO-003', 'funder2@funder.demo',     'funder'),
        # Video demo assignments
        ('VIDEO-001', 'provider@medbill.demo',  'provider'),
        ('VIDEO-001', 'funder@medbill.demo',    'funder'),
    ]
    for case_num, user_email, role_on_case in ASSIGNMENTS:
        case = cases[case_num]
        user = users[user_email]
        owner = firm if case_num == 'VIDEO-001' else henry
        if not CaseAssignment.query.filter_by(case_id=case.id, user_id=user.id).first():
            db.session.add(CaseAssignment(
                case_id=case.id,
                user_id=user.id,
                role_on_case=role_on_case,
                assigned_by_user_id=owner.id,
            ))

    db.session.commit()
    return success_response(
        data={
            'video_demo': {
                'law_firm':  {'email': 'firm@medbill.demo',     'password': 'Demo1234!', 'org': 'Smith Legal Group'},
                'provider':  {'email': 'provider@medbill.demo', 'password': 'Demo1234!', 'org': 'Riverside Medical Center'},
                'funder':    {'email': 'funder@medbill.demo',   'password': 'Demo1234!', 'org': 'MedFund Capital'},
                'case':      'VIDEO-001 — Maria Gonzalez (active)',
            },
        },
        message='Demo data seeded — password for all: Demo1234!',
        status_code=201,
    )


# =============================================================================
# 14. ERROR HANDLERS
# =============================================================================

@app.errorhandler(400)
def bad_request(e):
    return error_response(str(e), 400)


@app.errorhandler(404)
def not_found(e):
    return error_response('Resource not found', 404)


@app.errorhandler(413)
def too_large(e):
    max_mb = os.getenv('MAX_UPLOAD_MB', 10)
    return error_response(f'File too large. Maximum size is {max_mb}MB', 413)


@app.errorhandler(500)
def internal_error(e):
    db.session.rollback()
    return error_response('Internal server error', 500)


# =============================================================================
# 15. APP STARTUP
# =============================================================================

# Auto-create tables and upload dir on first import (idempotent).
with app.app_context():
    db.create_all()
    ensure_upload_dir()

if __name__ == '__main__':
    port = int(os.getenv('FLASK_RUN_PORT', 5001))
    app.run(debug=os.getenv('FLASK_ENV') == 'development', port=port)
