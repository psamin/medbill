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
from sqlalchemy import text, Numeric, or_
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
# 2.5  FUNDING MATH CONSTANTS
# Change these to update the entire funding pipeline in one place.
# =============================================================================
DEFAULT_NEGOTIATED_RATE_MULTIPLIER = Decimal(os.getenv('DEFAULT_NEGOTIATED_RATE_MULTIPLIER', '1.00'))
FUNDER_MEDICARE_MULTIPLIER         = Decimal(os.getenv('FUNDER_MEDICARE_MULTIPLIER', '1.60'))
LAW_FIRM_SPREAD_PERCENT            = Decimal(os.getenv('LAW_FIRM_SPREAD_PERCENT', '0.60'))

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


class NegotiatedCptRate(db.Model):
    """CPT/HCPCS-code-specific negotiated Medicare multiplier for a law firm + provider pair.
    One law firm and provider can have many CPT-specific rates forming their fee schedule."""
    __tablename__ = 'negotiated_cpt_rates'

    id = db.Column(db.Integer, primary_key=True)
    law_firm_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    provider_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    cpt_code = db.Column(db.String(20), nullable=False)
    # Provider receives (medicare_allowed_amount × this multiplier)
    medicare_anchor_multiplier = db.Column(Numeric(8, 4), nullable=False, default=Decimal('1.00'))
    negotiated_price = db.Column(Numeric(12, 2), nullable=True)  # optional absolute price
    notes = db.Column(db.Text, nullable=True)
    active = db.Column(db.Boolean, default=True, nullable=False)
    effective_start_date = db.Column(db.Date, nullable=True)
    effective_end_date = db.Column(db.Date, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow,
                           onupdate=datetime.utcnow, nullable=False)

    law_firm = db.relationship('User', foreign_keys=[law_firm_id])
    provider_user = db.relationship('User', foreign_keys=[provider_id])

    __table_args__ = (
        db.UniqueConstraint('law_firm_id', 'provider_id', 'cpt_code',
                            name='uq_negotiated_cpt_rate'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'law_firm_id': self.law_firm_id,
            'provider_id': self.provider_id,
            'cpt_code': self.cpt_code,
            'medicare_anchor_multiplier': str(self.medicare_anchor_multiplier),
            'negotiated_price': str(self.negotiated_price) if self.negotiated_price is not None else None,
            'notes': self.notes,
            'active': self.active,
            'effective_start_date': self.effective_start_date.isoformat() if self.effective_start_date else None,
            'effective_end_date': self.effective_end_date.isoformat() if self.effective_end_date else None,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
        }


class FundingBatch(db.Model):
    """A bundle of bills/line items submitted together for funder review and funding.
    Batches are typically created on 15-day cycles; the law firm manually selects which items."""
    __tablename__ = 'funding_batches'

    id = db.Column(db.Integer, primary_key=True)
    batch_name = db.Column(db.String(255), nullable=True)
    # law_firm and provider are explicit so a batch can span multiple cases
    law_firm_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    provider_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    case_id = db.Column(db.Integer, db.ForeignKey('patient_cases.id'), nullable=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    assigned_funder_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    # date window used to find eligible bills (guidance only, not enforced)
    batch_start_date = db.Column(db.Date, nullable=True)
    batch_end_date = db.Column(db.Date, nullable=True)
    batch_period_days = db.Column(db.Integer, default=15, nullable=False)
    # draft | submitted | funder_review | funded | rejected | closed
    status = db.Column(db.String(50), default='draft', nullable=False)
    bill_count = db.Column(db.Integer, default=0)
    line_item_count = db.Column(db.Integer, default=0)
    total_billed_amount = db.Column(Numeric(12, 2), default=0)
    total_medicare_amount = db.Column(Numeric(12, 2), default=0)
    total_provider_negotiated_payout = db.Column(Numeric(12, 2), default=0)
    total_funder_funding_amount = db.Column(Numeric(12, 2), default=0)
    total_spread_amount = db.Column(Numeric(12, 2), default=0)
    total_law_firm_spread_amount = db.Column(Numeric(12, 2), default=0)
    total_remaining_spread_amount = db.Column(Numeric(12, 2), default=0)
    rejection_reason = db.Column(db.Text, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow,
                           onupdate=datetime.utcnow, nullable=False)

    case = db.relationship('PatientCase', backref=db.backref('funding_batches', lazy=True))
    law_firm = db.relationship('User', foreign_keys=[law_firm_id])
    provider = db.relationship('User', foreign_keys=[provider_id])
    created_by = db.relationship('User', foreign_keys=[created_by_id])
    assigned_funder = db.relationship('User', foreign_keys=[assigned_funder_id])
    items = db.relationship('FundingBatchItem', backref='batch', lazy=True,
                            cascade='all, delete-orphan')

    def to_dict(self, include_items=False):
        d = {
            'id': self.id,
            'batch_name': self.batch_name,
            'law_firm_id': self.law_firm_id,
            'law_firm_org': self.law_firm.organization_name if self.law_firm else None,
            'provider_id': self.provider_id,
            'provider_org': self.provider.organization_name if self.provider else None,
            'case_id': self.case_id,
            'created_by_id': self.created_by_id,
            'assigned_funder_id': self.assigned_funder_id,
            'assigned_funder_org': self.assigned_funder.organization_name if self.assigned_funder else None,
            'batch_start_date': self.batch_start_date.isoformat() if self.batch_start_date else None,
            'batch_end_date': self.batch_end_date.isoformat() if self.batch_end_date else None,
            'batch_period_days': self.batch_period_days,
            'status': self.status,
            'bill_count': self.bill_count,
            'line_item_count': self.line_item_count,
            'item_count': len(self.items),
            'total_billed_amount': str(self.total_billed_amount),
            'total_medicare_amount': str(self.total_medicare_amount),
            'total_provider_negotiated_payout': str(self.total_provider_negotiated_payout),
            'total_funder_funding_amount': str(self.total_funder_funding_amount),
            'total_spread_amount': str(self.total_spread_amount),
            'total_law_firm_spread_amount': str(self.total_law_firm_spread_amount),
            'total_remaining_spread_amount': str(self.total_remaining_spread_amount),
            'rejection_reason': self.rejection_reason,
            'notes': self.notes,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
        }
        if include_items:
            d['items'] = [i.to_dict() for i in self.items]
        return d


class FundingBatchItem(db.Model):
    """A single bill (or line item within a bill) in a FundingBatch.
    Each item applies its own CPT-specific negotiated rate for the funding math."""
    __tablename__ = 'funding_batch_items'

    id = db.Column(db.Integer, primary_key=True)
    funding_batch_id = db.Column(db.Integer, db.ForeignKey('funding_batches.id'), nullable=False)
    case_id = db.Column(db.Integer, db.ForeignKey('patient_cases.id'), nullable=True)
    bill_id = db.Column(db.Integer, db.ForeignKey('medical_bills.id'), nullable=False)
    line_item_id = db.Column(db.Integer, db.ForeignKey('bill_line_items.id'), nullable=True)
    # Which CPT rate was applied (null if using default)
    negotiated_cpt_rate_id = db.Column(
        db.Integer, db.ForeignKey('negotiated_cpt_rates.id'), nullable=True
    )
    cpt_code = db.Column(db.String(20), nullable=True)
    description = db.Column(db.Text, nullable=True)
    quantity = db.Column(Numeric(8, 2), default=1)
    billed_amount = db.Column(Numeric(12, 2), default=0)
    medicare_allowed_amount = db.Column(Numeric(12, 2), default=0)
    negotiated_cpt_multiplier = db.Column(Numeric(8, 4), nullable=False)
    provider_negotiated_payout = db.Column(Numeric(12, 2), default=0)
    funder_medicare_multiplier = db.Column(Numeric(8, 4), nullable=False)
    funder_funding_amount = db.Column(Numeric(12, 2), default=0)
    spread_amount = db.Column(Numeric(12, 2), default=0)
    law_firm_spread_percent = db.Column(Numeric(8, 4), nullable=False)
    law_firm_spread_amount = db.Column(Numeric(12, 2), default=0)
    remaining_spread_amount = db.Column(Numeric(12, 2), default=0)
    used_default_rate = db.Column(db.Boolean, default=False, nullable=False)
    warning = db.Column(db.Text, nullable=True)
    # Item-level fund/reject (funder can act on individual items)
    item_status = db.Column(db.String(20), default='pending', nullable=False)
    item_rejection_reason = db.Column(db.Text, nullable=True)
    funded_at = db.Column(db.DateTime, nullable=True)
    funded_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow,
                           onupdate=datetime.utcnow, nullable=False)

    bill = db.relationship('MedicalBill')
    line_item = db.relationship('BillLineItem')
    negotiated_cpt_rate = db.relationship('NegotiatedCptRate')
    funded_by = db.relationship('User', foreign_keys=[funded_by_id])

    def to_dict(self):
        return {
            'id': self.id,
            'funding_batch_id': self.funding_batch_id,
            'case_id': self.case_id,
            'bill_id': self.bill_id,
            'line_item_id': self.line_item_id,
            'negotiated_cpt_rate_id': self.negotiated_cpt_rate_id,
            'cpt_code': self.cpt_code,
            'description': self.description,
            'quantity': str(self.quantity),
            'billed_amount': str(self.billed_amount),
            'medicare_allowed_amount': str(self.medicare_allowed_amount),
            'negotiated_cpt_multiplier': str(self.negotiated_cpt_multiplier),
            'provider_negotiated_payout': str(self.provider_negotiated_payout),
            'funder_medicare_multiplier': str(self.funder_medicare_multiplier),
            'funder_funding_amount': str(self.funder_funding_amount),
            'spread_amount': str(self.spread_amount),
            'law_firm_spread_percent': str(self.law_firm_spread_percent),
            'law_firm_spread_amount': str(self.law_firm_spread_amount),
            'remaining_spread_amount': str(self.remaining_spread_amount),
            'used_default_rate': self.used_default_rate,
            'warning': self.warning,
            'item_status': self.item_status,
            'item_rejection_reason': self.item_rejection_reason,
            'funded_at': self.funded_at.isoformat() if self.funded_at else None,
            'funded_by_id': self.funded_by_id,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
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


def _resolve_cpt_rate(
    law_firm_id: int,
    provider_id: int,
    cpt_code: 'str | None',
) -> 'tuple[Decimal, NegotiatedCptRate | None, bool, str | None]':
    """
    Look up the negotiated multiplier for a specific CPT/HCPCS code for a law firm + provider pair.
    Returns (multiplier, rate_obj_or_None, used_default, warning_or_None).

    Priority:
      1. Active NegotiatedCptRate for law_firm + provider + cpt_code
      2. DEFAULT_NEGOTIATED_RATE_MULTIPLIER with a warning
    """
    if cpt_code:
        today = datetime.utcnow().date()
        rate = NegotiatedCptRate.query.filter_by(
            law_firm_id=law_firm_id,
            provider_id=provider_id,
            cpt_code=cpt_code.upper(),
            active=True,
        ).filter(
            or_(
                NegotiatedCptRate.effective_end_date.is_(None),
                NegotiatedCptRate.effective_end_date >= today,
            )
        ).first()

        if rate:
            return Decimal(str(rate.medicare_anchor_multiplier)), rate, False, None

    warning = (
        f'No negotiated CPT rate found for {cpt_code or "unknown code"}, using default multiplier.'
    )
    return DEFAULT_NEGOTIATED_RATE_MULTIPLIER, None, True, warning


def _build_batch_items_from_bill(
    bill: 'MedicalBill',
    batch_id: int,
    law_firm_id: int,
    provider_id: int,
    case_id: 'int | None' = None,
) -> 'list[FundingBatchItem]':
    """
    Expand a bill into FundingBatchItems, resolving the CPT-specific negotiated rate per line item.
    Prefers matched line items; falls back to a single bill-level item when none are available.
    """
    matched = [
        li for li in bill.line_items
        if li.match_status == 'matched' and li.medicare_allowed_amount
    ]
    items: list[FundingBatchItem] = []

    if matched:
        for li in matched:
            mult, rate_obj, used_default, warn = _resolve_cpt_rate(
                law_firm_id, provider_id, li.code
            )
            math = calculate_funding_math(
                billed_amount=Decimal(str(li.billed_amount)),
                medicare_allowed_amount=Decimal(str(li.medicare_allowed_amount)),
                negotiated_cpt_multiplier=mult,
                cpt_code=li.code,
                used_default_rate=used_default,
                warning=warn,
            )
            items.append(FundingBatchItem(
                funding_batch_id=batch_id,
                case_id=case_id or bill.case_id,
                bill_id=bill.id,
                line_item_id=li.id,
                negotiated_cpt_rate_id=rate_obj.id if rate_obj else None,
                cpt_code=li.code,
                description=li.description,
                quantity=li.quantity,
                billed_amount=math['billed_amount'],
                medicare_allowed_amount=math['medicare_allowed_amount'],
                negotiated_cpt_multiplier=math['negotiated_cpt_multiplier'],
                provider_negotiated_payout=math['provider_negotiated_payout'],
                funder_medicare_multiplier=math['funder_medicare_multiplier'],
                funder_funding_amount=math['funder_funding_amount'],
                spread_amount=math['spread_amount'],
                law_firm_spread_percent=math['law_firm_spread_percent'],
                law_firm_spread_amount=math['law_firm_spread_amount'],
                remaining_spread_amount=math['remaining_spread_amount'],
                used_default_rate=math['used_default_rate'],
                warning=math['warning'],
            ))
    elif bill.total_medicare_amount and Decimal(str(bill.total_medicare_amount)) > 0:
        # Bill-level fallback: no CPT resolution possible, use default
        mult, _, _, warn = _resolve_cpt_rate(law_firm_id, provider_id, None)
        math = calculate_funding_math(
            billed_amount=Decimal(str(bill.total_billed_amount)),
            medicare_allowed_amount=Decimal(str(bill.total_medicare_amount)),
            negotiated_cpt_multiplier=mult,
            cpt_code=None,
            used_default_rate=True,
            warning='Bill-level aggregation; no CPT-specific rate available.',
        )
        items.append(FundingBatchItem(
            funding_batch_id=batch_id,
            case_id=case_id or bill.case_id,
            bill_id=bill.id,
            line_item_id=None,
            negotiated_cpt_rate_id=None,
            cpt_code=None,
            description=bill.provider_name or bill.original_filename,
            quantity=Decimal('1'),
            billed_amount=math['billed_amount'],
            medicare_allowed_amount=math['medicare_allowed_amount'],
            negotiated_cpt_multiplier=math['negotiated_cpt_multiplier'],
            provider_negotiated_payout=math['provider_negotiated_payout'],
            funder_medicare_multiplier=math['funder_medicare_multiplier'],
            funder_funding_amount=math['funder_funding_amount'],
            spread_amount=math['spread_amount'],
            law_firm_spread_percent=math['law_firm_spread_percent'],
            law_firm_spread_amount=math['law_firm_spread_amount'],
            remaining_spread_amount=math['remaining_spread_amount'],
            used_default_rate=True,
            warning=math['warning'],
        ))

    return items


def _recalculate_batch_totals(batch: 'FundingBatch') -> None:
    """Recompute batch aggregate and count columns from its current items."""
    items = batch.items
    batch.total_billed_amount               = sum(Decimal(str(i.billed_amount)) for i in items)
    batch.total_medicare_amount             = sum(Decimal(str(i.medicare_allowed_amount)) for i in items)
    batch.total_provider_negotiated_payout  = sum(Decimal(str(i.provider_negotiated_payout)) for i in items)
    batch.total_funder_funding_amount       = sum(Decimal(str(i.funder_funding_amount)) for i in items)
    batch.total_spread_amount               = sum(Decimal(str(i.spread_amount)) for i in items)
    batch.total_law_firm_spread_amount      = sum(Decimal(str(i.law_firm_spread_amount)) for i in items)
    # bill_count = distinct bills; line_item_count = items that are tied to a specific line item
    batch.bill_count       = len({i.bill_id for i in items})
    batch.line_item_count  = sum(1 for i in items if i.line_item_id is not None)
    batch.total_remaining_spread_amount     = sum(Decimal(str(i.remaining_spread_amount)) for i in items)
    batch.updated_at = datetime.utcnow()


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


def calculate_funding_math(
    billed_amount: Decimal,
    medicare_allowed_amount: Decimal,
    negotiated_cpt_multiplier: Decimal,
    cpt_code: 'str | None' = None,
    used_default_rate: bool = False,
    warning: 'str | None' = None,
) -> dict:
    """
    Single source of truth for all funding calculations.
    Takes a pre-resolved negotiated_cpt_multiplier (look it up with _resolve_cpt_rate first).
    medicare_allowed_amount = medicare_rate × quantity (must be pre-computed).
    Spread may be negative; it is stored and surfaced as-is — we never crash on it.
    """
    q2 = Decimal('0.01')
    q4 = Decimal('0.0001')

    provider_negotiated_payout = (medicare_allowed_amount * negotiated_cpt_multiplier).quantize(q2)
    funder_funding_amount      = (medicare_allowed_amount * FUNDER_MEDICARE_MULTIPLIER).quantize(q2)
    spread_amount              = (funder_funding_amount - provider_negotiated_payout).quantize(q2)
    law_firm_spread_amount     = (spread_amount * LAW_FIRM_SPREAD_PERCENT).quantize(q2)
    remaining_spread_amount    = (spread_amount - law_firm_spread_amount).quantize(q2)
    savings_vs_billed          = (billed_amount - funder_funding_amount).quantize(q2)
    billing_ratio              = (
        (billed_amount / medicare_allowed_amount).quantize(q4)
        if medicare_allowed_amount
        else None
    )

    return {
        'cpt_code':                   cpt_code,
        'billed_amount':              billed_amount,
        'medicare_allowed_amount':    medicare_allowed_amount,
        'negotiated_cpt_multiplier':  negotiated_cpt_multiplier,
        'provider_negotiated_payout': provider_negotiated_payout,
        'funder_medicare_multiplier': FUNDER_MEDICARE_MULTIPLIER,
        'funder_funding_amount':      funder_funding_amount,
        'spread_amount':              spread_amount,
        'law_firm_spread_percent':    LAW_FIRM_SPREAD_PERCENT,
        'law_firm_spread_amount':     law_firm_spread_amount,
        'remaining_spread_amount':    remaining_spread_amount,
        'savings_vs_billed':          savings_vs_billed,
        'billing_ratio':              billing_ratio,
        'used_default_rate':          used_default_rate,
        'warning':                    warning,
    }


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
    'ready_for_batching',
    'batch_created',
    'batch_submitted',
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
# 10.6  NEGOTIATED CPT RATE ROUTES
# Rates are per CPT/HCPCS code for a specific law firm + provider pair.
# =============================================================================

@app.route('/api/negotiated-cpt-rates', methods=['GET'])
@require_auth
def list_negotiated_cpt_rates(session):
    """
    Returns negotiated CPT rates visible to the caller.
    Query params: provider_id, law_firm_id (admin only), cpt_code.
    """
    role = session['role']
    user_id = session['user_id']
    q = NegotiatedCptRate.query

    if role == 'law_firm':
        q = q.filter_by(law_firm_id=user_id)
    elif role == 'admin':
        if request.args.get('law_firm_id'):
            q = q.filter_by(law_firm_id=request.args.get('law_firm_id', type=int))
    elif role in ('provider', 'funder'):
        q = q.filter_by(provider_id=user_id)

    if request.args.get('provider_id'):
        q = q.filter_by(provider_id=request.args.get('provider_id', type=int))
    if request.args.get('cpt_code'):
        q = q.filter_by(cpt_code=request.args.get('cpt_code').upper())
    if request.args.get('active_only', 'true').lower() == 'true':
        q = q.filter_by(active=True)

    rates = q.order_by(NegotiatedCptRate.cpt_code).all()
    return success_response(data=[r.to_dict() for r in rates])


@app.route('/api/negotiated-cpt-rates', methods=['POST'])
@require_role('law_firm', 'admin')
def create_negotiated_cpt_rate(session):
    data = request.get_json(silent=True) or {}
    provider_id = data.get('provider_id')
    cpt_code = (data.get('cpt_code') or '').strip().upper()

    if not provider_id:
        return error_response('provider_id is required')
    if not cpt_code:
        return error_response('cpt_code is required')

    provider = db.session.get(User, provider_id)
    if not provider or provider.role != 'provider':
        return error_response('provider_id must reference a provider user')

    try:
        multiplier = Decimal(str(data.get('medicare_anchor_multiplier', '1.00')))
        if multiplier <= 0:
            raise ValueError
    except (ValueError, Exception):
        return error_response('medicare_anchor_multiplier must be a positive number')

    law_firm_id = session['user_id'] if session['role'] == 'law_firm' else data.get('law_firm_id')
    if not law_firm_id:
        return error_response('law_firm_id is required for admin')

    # Upsert: deactivate any existing rate for this exact triple, then insert new
    NegotiatedCptRate.query.filter_by(
        law_firm_id=law_firm_id, provider_id=provider_id, cpt_code=cpt_code, active=True
    ).update({'active': False})

    rate = NegotiatedCptRate(
        law_firm_id=law_firm_id,
        provider_id=provider_id,
        cpt_code=cpt_code,
        medicare_anchor_multiplier=multiplier,
        negotiated_price=data.get('negotiated_price'),
        notes=(data.get('notes') or '').strip() or None,
        active=True,
        effective_start_date=data.get('effective_start_date') or None,
        effective_end_date=data.get('effective_end_date') or None,
    )
    db.session.add(rate)
    db.session.commit()
    return success_response(data=rate.to_dict(), status_code=201)


@app.route('/api/negotiated-cpt-rates/<int:rate_id>', methods=['PATCH'])
@require_role('law_firm', 'admin')
def update_negotiated_cpt_rate(rate_id, session):
    rate = db.session.get(NegotiatedCptRate, rate_id)
    if not rate:
        return error_response('Negotiated CPT rate not found', 404)
    if session['role'] == 'law_firm' and rate.law_firm_id != session['user_id']:
        return error_response('Forbidden', 403)

    data = request.get_json(silent=True) or {}
    if 'medicare_anchor_multiplier' in data:
        try:
            m = Decimal(str(data['medicare_anchor_multiplier']))
            if m <= 0:
                raise ValueError
            rate.medicare_anchor_multiplier = m
        except (ValueError, Exception):
            return error_response('medicare_anchor_multiplier must be a positive number')
    if 'notes' in data:
        rate.notes = (data['notes'] or '').strip() or None
    if 'active' in data:
        rate.active = bool(data['active'])
    if 'effective_end_date' in data:
        rate.effective_end_date = data['effective_end_date'] or None
    if 'negotiated_price' in data:
        rate.negotiated_price = data['negotiated_price']

    rate.updated_at = datetime.utcnow()
    db.session.commit()
    return success_response(data=rate.to_dict())


@app.route('/api/negotiated-cpt-rates/<int:rate_id>', methods=['DELETE'])
@require_role('law_firm', 'admin')
def deactivate_negotiated_cpt_rate(rate_id, session):
    rate = db.session.get(NegotiatedCptRate, rate_id)
    if not rate:
        return error_response('Negotiated CPT rate not found', 404)
    if session['role'] == 'law_firm' and rate.law_firm_id != session['user_id']:
        return error_response('Forbidden', 403)
    rate.active = False
    rate.updated_at = datetime.utcnow()
    db.session.commit()
    return success_response(message=f'CPT rate {rate.cpt_code} deactivated')


# =============================================================================
# 10.7  FUNDING BATCH ROUTES
# =============================================================================

BATCH_VALID_STATUSES = ('draft', 'submitted', 'funder_review', 'partially_funded', 'funded', 'rejected', 'closed')
# Statuses that mean a line item is "taken" and cannot be re-batched
_ACTIVE_BATCH_STATUSES = ('draft', 'submitted', 'funder_review', 'funded')


def _can_access_batch(user_id: int, role: str, batch: 'FundingBatch') -> bool:
    if role == 'admin':
        return True
    if role == 'law_firm':
        return batch.law_firm_id == user_id
    if role == 'funder':
        return batch.assigned_funder_id == user_id
    if role == 'provider':
        return batch.provider_id == user_id
    return False


def _already_batched_line_item_ids() -> 'set[int]':
    """Returns the set of line_item_ids already locked in an active/funded batch."""
    rows = (
        db.session.query(FundingBatchItem.line_item_id)
        .join(FundingBatch)
        .filter(
            FundingBatch.status.in_(_ACTIVE_BATCH_STATUSES),
            FundingBatchItem.line_item_id.isnot(None),
        )
        .all()
    )
    return {r[0] for r in rows}


def _already_batched_bill_ids() -> 'set[int]':
    """Returns bill_ids entirely covered by active batches (all matched LIs are batched)."""
    rows = (
        db.session.query(FundingBatchItem.bill_id)
        .join(FundingBatch)
        .filter(FundingBatch.status.in_(_ACTIVE_BATCH_STATUSES))
        .distinct()
        .all()
    )
    return {r[0] for r in rows}


# ── Preview endpoint ──────────────────────────────────────────────────────────

@app.route('/api/funding-batches/preview', methods=['POST'])
@require_role('law_firm', 'admin')
def preview_funding_batch(session):
    """
    Returns eligible completed bills/line items in the given date window,
    pre-calculated with CPT-specific negotiated rates.
    The law firm still selects which items to include — nothing is created here.
    """
    data = request.get_json(silent=True) or {}
    provider_id = data.get('provider_id')
    assigned_funder_id = data.get('assigned_funder_id')
    batch_start_date = data.get('batch_start_date')
    batch_end_date = data.get('batch_end_date')
    filter_case_id = data.get('case_id')

    if not provider_id:
        return error_response('provider_id is required')

    provider = db.session.get(User, provider_id)
    if not provider or provider.role != 'provider':
        return error_response('provider_id must reference a provider user')

    law_firm_id = session['user_id'] if session['role'] == 'law_firm' else (
        data.get('law_firm_id') or session['user_id']
    )

    # Build eligible bill query
    q = (
        MedicalBill.query
        .join(PatientCase, MedicalBill.case_id == PatientCase.id)
        .filter(
            MedicalBill.status == 'completed',
            PatientCase.law_firm_id == law_firm_id,
        )
    )
    if filter_case_id:
        q = q.filter(MedicalBill.case_id == filter_case_id)
    if batch_start_date:
        q = q.filter(MedicalBill.created_at >= batch_start_date)
    if batch_end_date:
        q = q.filter(MedicalBill.created_at <= batch_end_date + ' 23:59:59')

    bills = q.order_by(MedicalBill.created_at.desc()).all()

    taken_li_ids = _already_batched_line_item_ids()

    result_bills = []
    for bill in bills:
        case = db.session.get(PatientCase, bill.case_id)
        matched = [
            li for li in bill.line_items
            if li.match_status == 'matched' and li.medicare_allowed_amount
        ]
        if not matched:
            continue

        bill_items = []
        for li in matched:
            mult, rate_obj, used_default, warn = _resolve_cpt_rate(
                law_firm_id, provider_id, li.code
            )
            math = calculate_funding_math(
                billed_amount=Decimal(str(li.billed_amount)),
                medicare_allowed_amount=Decimal(str(li.medicare_allowed_amount)),
                negotiated_cpt_multiplier=mult,
                cpt_code=li.code,
                used_default_rate=used_default,
                warning=warn,
            )
            already_batched = li.id in taken_li_ids
            bill_items.append({
                'line_item_id': li.id,
                'cpt_code': li.code,
                'description': li.description,
                'quantity': str(li.quantity),
                'billed_amount': str(math['billed_amount']),
                'medicare_allowed_amount': str(math['medicare_allowed_amount']),
                'negotiated_cpt_multiplier': str(math['negotiated_cpt_multiplier']),
                'provider_negotiated_payout': str(math['provider_negotiated_payout']),
                'funder_funding_amount': str(math['funder_funding_amount']),
                'spread_amount': str(math['spread_amount']),
                'law_firm_spread_amount': str(math['law_firm_spread_amount']),
                'used_default_rate': used_default,
                'warning': warn,
                'already_batched': already_batched,
                'negotiated_cpt_rate_id': rate_obj.id if rate_obj else None,
            })

        result_bills.append({
            'bill_id': bill.id,
            'case_id': bill.case_id,
            'patient_name': case.patient_name if case else None,
            'case_number': case.case_number if case else None,
            'provider_name': bill.provider_name,
            'original_filename': bill.original_filename,
            'uploaded_at': bill.created_at.isoformat(),
            'line_items': bill_items,
        })

    return success_response(data={
        'bills': result_bills,
        'batch_period_days': 15,
        'funder_medicare_multiplier': str(FUNDER_MEDICARE_MULTIPLIER),
        'law_firm_spread_percent': str(LAW_FIRM_SPREAD_PERCENT),
    })


# ── Create batch ──────────────────────────────────────────────────────────────

def _create_batch_impl(session: dict, data: dict, restrict_case_id: 'int | None' = None):
    """
    Shared implementation for creating a funding batch.
    restrict_case_id: when coming from the case-scoped route, validate bills belong to this case.
    """
    bill_ids = data.get('bill_ids') or []
    line_item_ids = data.get('line_item_ids') or []
    provider_id = data.get('provider_id')
    assigned_funder_id = data.get('assigned_funder_id')
    batch_name = (data.get('batch_name') or '').strip() or None
    batch_start_date = data.get('batch_start_date') or None
    batch_end_date = data.get('batch_end_date') or None
    notes = (data.get('notes') or '').strip() or None

    if not bill_ids and not line_item_ids:
        return error_response('Provide bill_ids or line_item_ids to include in the batch')
    if not provider_id:
        return error_response('provider_id is required')

    provider = db.session.get(User, provider_id)
    if not provider or provider.role != 'provider':
        return error_response('provider_id must reference a provider user')

    law_firm_id = session['user_id'] if session['role'] == 'law_firm' else (
        data.get('law_firm_id') or session['user_id']
    )
    law_firm = db.session.get(User, law_firm_id)
    if not law_firm or law_firm.role not in ('law_firm', 'admin'):
        return error_response('law_firm_id must reference a law firm user')

    if assigned_funder_id:
        funder = db.session.get(User, assigned_funder_id)
        if not funder or funder.role != 'funder':
            return error_response('assigned_funder_id must reference a funder user')

    taken_li_ids = _already_batched_line_item_ids()

    batch = FundingBatch(
        batch_name=batch_name,
        law_firm_id=law_firm_id,
        provider_id=provider_id,
        case_id=restrict_case_id or data.get('case_id'),
        created_by_id=session['user_id'],
        assigned_funder_id=assigned_funder_id,
        batch_start_date=batch_start_date,
        batch_end_date=batch_end_date,
        batch_period_days=int(data.get('batch_period_days', 15)),
        notes=notes,
        status='draft',
    )
    db.session.add(batch)
    db.session.flush()

    new_items: list[FundingBatchItem] = []

    for bill_id in bill_ids:
        bill = db.session.get(MedicalBill, bill_id)
        if not bill:
            db.session.rollback()
            return error_response(f'Bill {bill_id} not found', 404)
        if restrict_case_id and bill.case_id != restrict_case_id:
            db.session.rollback()
            return error_response(f'Bill {bill_id} does not belong to this case', 404)
        if bill.status != 'completed':
            db.session.rollback()
            return error_response(f'Bill {bill_id} has not been fully processed yet')
        new_items.extend(_build_batch_items_from_bill(bill, batch.id, law_firm_id, provider_id))

    seen_li_ids = {i.line_item_id for i in new_items if i.line_item_id}
    for li_id in line_item_ids:
        if li_id in seen_li_ids:
            continue
        if li_id in taken_li_ids:
            db.session.rollback()
            return error_response(f'Line item {li_id} is already in an active batch')
        li = db.session.get(BillLineItem, li_id)
        if not li:
            db.session.rollback()
            return error_response(f'Line item {li_id} not found', 404)
        bill = db.session.get(MedicalBill, li.medical_bill_id)
        if not bill:
            db.session.rollback()
            return error_response(f'Bill for line item {li_id} not found', 404)
        if restrict_case_id and bill.case_id != restrict_case_id:
            db.session.rollback()
            return error_response(f'Line item {li_id} does not belong to this case', 404)
        if li.match_status != 'matched' or not li.medicare_allowed_amount:
            db.session.rollback()
            return error_response(f'Line item {li_id} has no Medicare rate and cannot be batched')

        mult, rate_obj, used_default, warn = _resolve_cpt_rate(law_firm_id, provider_id, li.code)
        math = calculate_funding_math(
            billed_amount=Decimal(str(li.billed_amount)),
            medicare_allowed_amount=Decimal(str(li.medicare_allowed_amount)),
            negotiated_cpt_multiplier=mult,
            cpt_code=li.code,
            used_default_rate=used_default,
            warning=warn,
        )
        new_items.append(FundingBatchItem(
            funding_batch_id=batch.id,
            case_id=bill.case_id,
            bill_id=li.medical_bill_id,
            line_item_id=li.id,
            negotiated_cpt_rate_id=rate_obj.id if rate_obj else None,
            cpt_code=li.code,
            description=li.description,
            quantity=li.quantity,
            billed_amount=math['billed_amount'],
            medicare_allowed_amount=math['medicare_allowed_amount'],
            negotiated_cpt_multiplier=math['negotiated_cpt_multiplier'],
            provider_negotiated_payout=math['provider_negotiated_payout'],
            funder_medicare_multiplier=math['funder_medicare_multiplier'],
            funder_funding_amount=math['funder_funding_amount'],
            spread_amount=math['spread_amount'],
            law_firm_spread_percent=math['law_firm_spread_percent'],
            law_firm_spread_amount=math['law_firm_spread_amount'],
            remaining_spread_amount=math['remaining_spread_amount'],
            used_default_rate=used_default,
            warning=warn,
        ))

    if not new_items:
        db.session.rollback()
        return error_response('No fundable items found — bills may have no matched Medicare rates')

    for item in new_items:
        db.session.add(item)

    db.session.flush()
    _recalculate_batch_totals(batch)
    db.session.commit()
    return success_response(data=batch.to_dict(include_items=True), status_code=201)


@app.route('/api/funding-batches', methods=['POST'])
@require_role('law_firm', 'admin')
def create_funding_batch_toplevel(session):
    return _create_batch_impl(session, request.get_json(silent=True) or {})


@app.route('/api/cases/<int:case_id>/funding-batches', methods=['POST'])
@require_role('law_firm', 'admin')
def create_funding_batch(case_id, session):
    case = db.session.get(PatientCase, case_id)
    if not case:
        return error_response('Case not found', 404)
    if session['role'] == 'law_firm' and case.law_firm_id != session['user_id']:
        return error_response('Forbidden', 403)
    data = request.get_json(silent=True) or {}
    # Inject provider from case assignments if not supplied
    if not data.get('provider_id'):
        pa = CaseAssignment.query.filter_by(case_id=case_id, role_on_case='provider').first()
        if pa:
            data = dict(data, provider_id=pa.user_id)
    return _create_batch_impl(session, data, restrict_case_id=case_id)


@app.route('/api/cases/<int:case_id>/funding-batches', methods=['GET'])
@require_auth
def list_case_funding_batches(case_id, session):
    case = db.session.get(PatientCase, case_id)
    if not case:
        return error_response('Case not found', 404)
    if not can_user_access_case(session['user_id'], session['role'], case):
        return error_response('Case not found', 404)

    batches = FundingBatch.query.filter_by(case_id=case_id).order_by(
        FundingBatch.created_at.desc()
    ).all()
    return success_response(data=[b.to_dict() for b in batches])


@app.route('/api/funding-batches', methods=['GET'])
@require_auth
def list_funding_batches(session):
    role = session['role']
    user_id = session['user_id']

    if role == 'admin':
        batches = FundingBatch.query.order_by(FundingBatch.created_at.desc()).all()
    elif role == 'law_firm':
        batches = FundingBatch.query.filter_by(
            law_firm_id=user_id
        ).order_by(FundingBatch.created_at.desc()).all()
    elif role == 'funder':
        batches = FundingBatch.query.filter_by(
            assigned_funder_id=user_id
        ).order_by(FundingBatch.created_at.desc()).all()
    else:  # provider — batches for their provider_id
        batches = FundingBatch.query.filter_by(
            provider_id=user_id
        ).order_by(FundingBatch.created_at.desc()).all()

    status_filter = request.args.get('status')
    if status_filter:
        batches = [b for b in batches if b.status == status_filter]

    return success_response(data=[b.to_dict() for b in batches])


@app.route('/api/funding-batches/<int:batch_id>', methods=['GET'])
@require_auth
def get_funding_batch(batch_id, session):
    batch = db.session.get(FundingBatch, batch_id)
    if not batch or not _can_access_batch(session['user_id'], session['role'], batch):
        return error_response('Funding batch not found', 404)

    data = batch.to_dict(include_items=True)
    # Include case summary
    case = db.session.get(PatientCase, batch.case_id)
    if case:
        data['case'] = case.to_dict()
    return success_response(data=data)


@app.route('/api/funding-batches/<int:batch_id>', methods=['PATCH'])
@require_role('law_firm', 'admin')
def update_funding_batch(batch_id, session):
    batch = db.session.get(FundingBatch, batch_id)
    if not batch or not _can_access_batch(session['user_id'], session['role'], batch):
        return error_response('Funding batch not found', 404)
    if batch.status != 'draft':
        return error_response('Only draft batches can be edited')

    data = request.get_json(silent=True) or {}
    if 'notes' in data:
        batch.notes = (data['notes'] or '').strip() or None
    if 'assigned_funder_id' in data:
        fid = data['assigned_funder_id']
        if fid:
            funder = db.session.get(User, fid)
            if not funder or funder.role != 'funder':
                return error_response('assigned_funder_id must reference a funder user')
            if not db.session.query(CaseAssignment).filter_by(
                case_id=batch.case_id, user_id=fid
            ).first():
                return error_response('Assigned funder is not assigned to this case')
        batch.assigned_funder_id = fid

    batch.updated_at = datetime.utcnow()
    db.session.commit()
    return success_response(data=batch.to_dict(include_items=True))


@app.route('/api/funding-batches/<int:batch_id>/submit', methods=['POST'])
@require_role('law_firm', 'admin')
def submit_funding_batch(batch_id, session):
    batch = db.session.get(FundingBatch, batch_id)
    if not batch or not _can_access_batch(session['user_id'], session['role'], batch):
        return error_response('Funding batch not found', 404)
    if batch.status != 'draft':
        return error_response(f'Batch is already {batch.status} and cannot be submitted')
    if not batch.assigned_funder_id:
        return error_response('Assign a funder before submitting')
    if not batch.items:
        return error_response('Batch has no items')

    batch.status = 'submitted'
    batch.updated_at = datetime.utcnow()
    db.session.commit()
    return success_response(data=batch.to_dict(), message='Batch submitted to funder')


@app.route('/api/funding-batches/<int:batch_id>/start-review', methods=['POST'])
@require_role('funder', 'admin')
def start_batch_review(batch_id, session):
    batch = db.session.get(FundingBatch, batch_id)
    if not batch or not _can_access_batch(session['user_id'], session['role'], batch):
        return error_response('Funding batch not found', 404)
    if batch.status != 'submitted':
        return error_response(f'Batch must be submitted before review (current: {batch.status})')

    batch.status = 'funder_review'
    batch.updated_at = datetime.utcnow()
    db.session.commit()
    return success_response(data=batch.to_dict(), message='Review started')


def _sync_batch_status_from_items(batch: 'FundingBatch') -> None:
    """Derive batch status from the aggregate of all item statuses."""
    items = batch.items
    if not items:
        return
    statuses = {i.item_status for i in items}
    if statuses == {'funded'}:
        batch.status = 'funded'
    elif statuses == {'rejected'}:
        batch.status = 'rejected'
    elif 'funded' in statuses:
        batch.status = 'partially_funded'
    # else leave as funder_review


@app.route('/api/funding-batches/<int:batch_id>/fund', methods=['POST'])
@require_role('funder', 'admin')
def fund_batch(batch_id, session):
    batch = db.session.get(FundingBatch, batch_id)
    if not batch or not _can_access_batch(session['user_id'], session['role'], batch):
        return error_response('Funding batch not found', 404)
    if batch.status not in ('submitted', 'funder_review', 'partially_funded'):
        return error_response(f'Batch cannot be funded from status: {batch.status}')

    now = datetime.utcnow()
    for item in batch.items:
        if item.item_status == 'pending':
            item.item_status = 'funded'
            item.funded_at = now
            item.funded_by_id = session['user_id']
    batch.status = 'funded'
    batch.updated_at = now
    db.session.commit()
    return success_response(data=batch.to_dict(include_items=True), message='Batch funded successfully')


@app.route('/api/funding-batches/<int:batch_id>/reject', methods=['POST'])
@require_role('funder', 'admin')
def reject_batch(batch_id, session):
    batch = db.session.get(FundingBatch, batch_id)
    if not batch or not _can_access_batch(session['user_id'], session['role'], batch):
        return error_response('Funding batch not found', 404)
    if batch.status not in ('submitted', 'funder_review', 'partially_funded'):
        return error_response(f'Batch cannot be rejected from status: {batch.status}')

    data = request.get_json(silent=True) or {}
    reason = (data.get('reason') or '').strip() or 'No reason provided'

    for item in batch.items:
        if item.item_status == 'pending':
            item.item_status = 'rejected'
            item.item_rejection_reason = reason
    batch.status = 'rejected'
    batch.rejection_reason = reason
    batch.updated_at = datetime.utcnow()
    db.session.commit()
    return success_response(data=batch.to_dict(include_items=True), message='Batch rejected')


@app.route('/api/funding-batches/<int:batch_id>/items/<int:item_id>/fund', methods=['POST'])
@require_role('funder', 'admin')
def fund_batch_item(batch_id, item_id, session):
    batch = db.session.get(FundingBatch, batch_id)
    if not batch or not _can_access_batch(session['user_id'], session['role'], batch):
        return error_response('Funding batch not found', 404)
    if batch.status not in ('submitted', 'funder_review', 'partially_funded'):
        return error_response('Batch is not open for item-level actions')

    item = FundingBatchItem.query.filter_by(id=item_id, funding_batch_id=batch_id).first()
    if not item:
        return error_response('Batch item not found', 404)
    if item.item_status == 'funded':
        return error_response('Item already funded')

    item.item_status = 'funded'
    item.funded_at = datetime.utcnow()
    item.funded_by_id = session['user_id']
    item.item_rejection_reason = None
    item.updated_at = datetime.utcnow()

    # Move batch to funder_review if it was just submitted
    if batch.status == 'submitted':
        batch.status = 'funder_review'
    _sync_batch_status_from_items(batch)
    batch.updated_at = datetime.utcnow()
    db.session.commit()
    return success_response(data=batch.to_dict(include_items=True), message='Item funded')


@app.route('/api/funding-batches/<int:batch_id>/items/<int:item_id>/reject', methods=['POST'])
@require_role('funder', 'admin')
def reject_batch_item(batch_id, item_id, session):
    batch = db.session.get(FundingBatch, batch_id)
    if not batch or not _can_access_batch(session['user_id'], session['role'], batch):
        return error_response('Funding batch not found', 404)
    if batch.status not in ('submitted', 'funder_review', 'partially_funded'):
        return error_response('Batch is not open for item-level actions')

    item = FundingBatchItem.query.filter_by(id=item_id, funding_batch_id=batch_id).first()
    if not item:
        return error_response('Batch item not found', 404)
    if item.item_status == 'funded':
        return error_response('Cannot reject an already-funded item')

    data = request.get_json(silent=True) or {}
    reason = (data.get('reason') or '').strip() or 'No reason provided'

    item.item_status = 'rejected'
    item.item_rejection_reason = reason
    item.updated_at = datetime.utcnow()

    if batch.status == 'submitted':
        batch.status = 'funder_review'
    _sync_batch_status_from_items(batch)
    batch.updated_at = datetime.utcnow()
    db.session.commit()
    return success_response(data=batch.to_dict(include_items=True), message='Item rejected')


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
        case_ids = [c.id for c in cases]
        data['bills_awaiting_funder'] = MedicalBill.query.join(PatientCase).filter(
            PatientCase.law_firm_id == user_id,
            MedicalBill.funding_status == 'funding_requested',
        ).count()
        data['active_cases'] = sum(1 for c in cases if c.status == 'active')
        data['ready_for_funding'] = sum(
            1 for c in cases if c.status == 'ready_for_funding'
        )
        data['draft_batches'] = FundingBatch.query.filter(
            FundingBatch.case_id.in_(case_ids),
            FundingBatch.status == 'draft',
        ).count()
        data['submitted_batches'] = FundingBatch.query.filter(
            FundingBatch.case_id.in_(case_ids),
            FundingBatch.status.in_(['submitted', 'funder_review']),
        ).count()
        data['funded_batches'] = FundingBatch.query.filter(
            FundingBatch.case_id.in_(case_ids),
            FundingBatch.status == 'funded',
        ).count()

    elif role == 'provider':
        assigned_case_ids = db.session.query(CaseAssignment.case_id).filter_by(user_id=user_id)
        data['my_bills_count'] = MedicalBill.query.filter_by(
            uploaded_by_id=user_id
        ).count()
        data['bills_pending_review'] = MedicalBill.query.filter_by(
            uploaded_by_id=user_id, status='uploaded'
        ).count()
        data['batch_count'] = FundingBatch.query.filter(
            FundingBatch.case_id.in_(assigned_case_ids)
        ).count()

    elif role == 'funder':
        data['pending_batches'] = FundingBatch.query.filter(
            FundingBatch.assigned_funder_id == user_id,
            FundingBatch.status.in_(['submitted', 'funder_review']),
        ).count()
        data['funded_batches'] = FundingBatch.query.filter(
            FundingBatch.assigned_funder_id == user_id,
            FundingBatch.status == 'funded',
        ).count()
        data['ready_for_funding'] = sum(
            1 for c in cases if c.status in ('ready_for_funding', 'funder_review')
        )
        # Legacy bill-level metric kept for compatibility
        assigned_ids = db.session.query(CaseAssignment.case_id).filter_by(user_id=user_id)
        data['pending_review'] = MedicalBill.query.filter(
            MedicalBill.case_id.in_(assigned_ids),
            MedicalBill.funding_status.in_(['funding_requested', 'under_review']),
        ).count()

    elif role == 'admin':
        data['pending_review'] = MedicalBill.query.filter(
            MedicalBill.funding_status.in_(['funding_requested', 'under_review'])
        ).count()
        data['pending_batches'] = FundingBatch.query.filter(
            FundingBatch.status.in_(['submitted', 'funder_review'])
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

    # Negotiated rate agreements (law-firm + provider level)
    henry    = users['henry@lawfirm.demo']
    provider1     = users['provider1@demo.com']
    firm_demo     = users['firm@medbill.demo']
    provider_demo = users['provider@medbill.demo']
    alice         = users['alice@funder.demo']

    # CPT-specific negotiated rates for Henry + City General
    HENRY_CPT_RATES = [
        ('99213', '1.20', 'Office visit – established patient'),
        ('99214', '1.30', 'Office visit – moderate complexity'),
        ('93000', '1.15', 'Electrocardiogram – routine ECG'),
        ('97110', '1.10', 'Therapeutic exercises'),
        # 97530 intentionally omitted to demonstrate default fallback in the demo
    ]
    for cpt, mult, notes in HENRY_CPT_RATES:
        if not NegotiatedCptRate.query.filter_by(
            law_firm_id=henry.id, provider_id=provider1.id, cpt_code=cpt, active=True
        ).first():
            db.session.add(NegotiatedCptRate(
                law_firm_id=henry.id,
                provider_id=provider1.id,
                cpt_code=cpt,
                medicare_anchor_multiplier=Decimal(mult),
                notes=notes,
                active=True,
            ))

    # CPT-specific rates for Smith Legal / Riverside Medical (video demo pair)
    FIRM_CPT_RATES = [
        ('99213', '1.25', 'Negotiated office visit'),
        ('99214', '1.35', 'Negotiated complex visit'),
        ('93000', '1.20', 'Negotiated ECG'),
    ]
    for cpt, mult, notes in FIRM_CPT_RATES:
        if not NegotiatedCptRate.query.filter_by(
            law_firm_id=firm_demo.id, provider_id=provider_demo.id, cpt_code=cpt, active=True
        ).first():
            db.session.add(NegotiatedCptRate(
                law_firm_id=firm_demo.id,
                provider_id=provider_demo.id,
                cpt_code=cpt,
                medicare_anchor_multiplier=Decimal(mult),
                notes=notes,
                active=True,
            ))

    db.session.flush()

    # Sample funding batches for DEMO-001 (henry's case — ready_for_funding)
    demo_case = cases['DEMO-001']
    existing_batch = FundingBatch.query.filter_by(case_id=demo_case.id).first()
    if not existing_batch:
        # Draft batch shell
        draft = FundingBatch(
            batch_name='May 2026 Batch — Draft',
            law_firm_id=henry.id,
            provider_id=provider1.id,
            case_id=demo_case.id,
            created_by_id=henry.id,
            assigned_funder_id=alice.id,
            batch_start_date=datetime(2026, 5, 1).date(),
            batch_end_date=datetime(2026, 5, 15).date(),
            status='draft',
            notes='Initial draft — pending review',
        )
        db.session.add(draft)
        db.session.flush()
        _recalculate_batch_totals(draft)

        # Submitted batch with CPT-specific negotiated rates
        submitted = FundingBatch(
            batch_name='Apr 2026 Batch — Submitted',
            law_firm_id=henry.id,
            provider_id=provider1.id,
            case_id=demo_case.id,
            created_by_id=henry.id,
            assigned_funder_id=alice.id,
            batch_start_date=datetime(2026, 4, 1).date(),
            batch_end_date=datetime(2026, 4, 15).date(),
            status='submitted',
            notes='Ready for funder review',
        )
        db.session.add(submitted)
        db.session.flush()

        # Find or create a completed bill on the demo case
        demo_bill = MedicalBill.query.filter_by(
            case_id=demo_case.id, status='completed'
        ).first()
        if demo_bill is None:
            demo_bill = MedicalBill(
                case_id=demo_case.id,
                uploaded_by_id=henry.id,
                provider_name='City General Hospital',
                original_filename='demo_bill.pdf',
                stored_filename='demo_bill.pdf',
                file_path='/dev/null',
                status='completed',
                funding_status='funding_requested',
            )
            db.session.add(demo_bill)
            db.session.flush()

        # Seed line items — each with its own CPT negotiated rate
        demo_items = [
            {'code': '99213', 'desc': 'Office visit, established patient', 'qty': Decimal('1'), 'billed': Decimal('250.00'), 'medicare': Decimal('85.00')},
            {'code': '99214', 'desc': 'Office visit, moderate complexity',  'qty': Decimal('1'), 'billed': Decimal('380.00'), 'medicare': Decimal('125.00')},
            {'code': '93000', 'desc': 'Electrocardiogram, routine ECG',     'qty': Decimal('2'), 'billed': Decimal('140.00'), 'medicare': Decimal('18.00')},
            # 97530 has no negotiated rate → triggers default fallback warning
            {'code': '97530', 'desc': 'Therapeutic activities',             'qty': Decimal('1'), 'billed': Decimal('95.00'),  'medicare': Decimal('32.00')},
        ]
        for item_data in demo_items:
            cpt = item_data['code']
            medicare_allowed = item_data['medicare'] * item_data['qty']
            mult, rate_obj, used_default, warn = _resolve_cpt_rate(
                henry.id, provider1.id, cpt
            )
            math = calculate_funding_math(
                billed_amount=item_data['billed'],
                medicare_allowed_amount=medicare_allowed,
                negotiated_cpt_multiplier=mult,
                cpt_code=cpt,
                used_default_rate=used_default,
                warning=warn,
            )
            db.session.add(FundingBatchItem(
                funding_batch_id=submitted.id,
                case_id=demo_case.id,
                bill_id=demo_bill.id,
                line_item_id=None,
                negotiated_cpt_rate_id=rate_obj.id if rate_obj else None,
                cpt_code=cpt,
                description=item_data['desc'],
                quantity=item_data['qty'],
                billed_amount=math['billed_amount'],
                medicare_allowed_amount=math['medicare_allowed_amount'],
                negotiated_cpt_multiplier=math['negotiated_cpt_multiplier'],
                provider_negotiated_payout=math['provider_negotiated_payout'],
                funder_medicare_multiplier=math['funder_medicare_multiplier'],
                funder_funding_amount=math['funder_funding_amount'],
                spread_amount=math['spread_amount'],
                law_firm_spread_percent=math['law_firm_spread_percent'],
                law_firm_spread_amount=math['law_firm_spread_amount'],
                remaining_spread_amount=math['remaining_spread_amount'],
                used_default_rate=used_default,
                warning=warn,
            ))

        db.session.flush()
        _recalculate_batch_totals(submitted)

    db.session.commit()
    return success_response(
        data={
            'video_demo': {
                'law_firm':  {'email': 'firm@medbill.demo',     'password': 'Demo1234!', 'org': 'Smith Legal Group'},
                'provider':  {'email': 'provider@medbill.demo', 'password': 'Demo1234!', 'org': 'Riverside Medical Center'},
                'funder':    {'email': 'funder@medbill.demo',   'password': 'Demo1234!', 'org': 'MedFund Capital'},
                'case':      'VIDEO-001 — Maria Gonzalez (active)',
            },
            'funding_math': {
                'funder_medicare_multiplier':         str(FUNDER_MEDICARE_MULTIPLIER),
                'law_firm_spread_percent':            str(LAW_FIRM_SPREAD_PERCENT),
                'default_negotiated_rate_multiplier': str(DEFAULT_NEGOTIATED_RATE_MULTIPLIER),
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
