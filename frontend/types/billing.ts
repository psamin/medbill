export type BillStatus = 'uploaded' | 'processing' | 'completed' | 'failed' | 'review_ready'
export type FundingStatus =
  | 'not_requested'
  | 'funding_requested'
  | 'under_review'
  | 'funded'
  | 'rejected'
export type CodeType = 'CPT' | 'HCPCS' | 'REV' | 'UNKNOWN'
export type MatchStatus = 'matched' | 'unmatched' | 'low_confidence'
export type BatchStatus = 'draft' | 'submitted' | 'funder_review' | 'partially_funded' | 'funded' | 'rejected' | 'closed'
export type ItemStatus = 'pending' | 'funded' | 'rejected'

export interface MedicalBill {
  id: number
  case_id: number
  uploaded_by_id: number
  display_name: string | null
  provider_name: string | null
  original_filename: string
  status: BillStatus
  funding_status: FundingStatus
  total_billed_amount: string
  total_medicare_amount: string
  total_savings: string
  savings_percentage: string
  average_billing_ratio: string
  line_item_count: number
  matched_line_item_count: number
  unmatched_line_item_count: number
  processing_confidence: string
  error_message: string | null
  extraction_method: string | null
  extraction_model: string | null
  extraction_warnings: string[]
  extraction_status: string | null
  detected_row_count: number
  created_at: string
  updated_at: string
}

export interface BillLineItem {
  id: number
  medical_bill_id: number
  line_number: number | null
  description: string | null
  code: string | null
  code_type: CodeType
  quantity: string
  billed_amount: string
  medicare_rate: string | null
  medicare_allowed_amount: string | null
  savings_amount: string | null
  billing_ratio: string | null
  match_status: MatchStatus
  confidence_score: string | null
  created_at: string
}

/** CPT/HCPCS-code-specific negotiated rate for a law firm + provider pair. */
export interface NegotiatedCptRate {
  id: number
  law_firm_id: number
  provider_id: number
  cpt_code: string
  medicare_anchor_multiplier: string
  negotiated_price: string | null
  notes: string | null
  active: boolean
  effective_start_date: string | null
  effective_end_date: string | null
  created_at: string
  updated_at: string
}

export interface FundingBatchItem {
  id: number
  funding_batch_id: number
  case_id: number | null
  bill_id: number
  line_item_id: number | null
  negotiated_cpt_rate_id: number | null
  cpt_code: string | null
  description: string | null
  quantity: string
  billed_amount: string
  medicare_allowed_amount: string
  negotiated_cpt_multiplier: string
  provider_negotiated_payout: string
  funder_medicare_multiplier: string
  funder_funding_amount: string
  spread_amount: string
  law_firm_spread_percent: string
  law_firm_spread_amount: string
  remaining_spread_amount: string
  used_default_rate: boolean
  warning: string | null
  item_status: ItemStatus
  item_rejection_reason: string | null
  funded_at: string | null
  funded_by_id: number | null
  created_at: string
  updated_at: string
}

export interface FundingBatch {
  id: number
  batch_name: string | null
  law_firm_id: number
  law_firm_org: string | null
  provider_id: number
  provider_org: string | null
  case_id: number | null
  created_by_id: number
  assigned_funder_id: number | null
  assigned_funder_org: string | null
  batch_start_date: string | null
  batch_end_date: string | null
  batch_period_days: number
  status: BatchStatus
  bill_count: number
  line_item_count: number
  item_count: number
  total_billed_amount: string
  total_medicare_amount: string
  total_provider_negotiated_payout: string
  total_funder_funding_amount: string
  total_spread_amount: string
  total_law_firm_spread_amount: string
  total_remaining_spread_amount: string
  rejection_reason: string | null
  notes: string | null
  created_at: string
  updated_at: string
  items?: FundingBatchItem[]
}

/** A single eligible line item returned by the batch preview endpoint. */
export interface PreviewLineItem {
  line_item_id: number
  cpt_code: string | null
  description: string | null
  quantity: string
  billed_amount: string
  medicare_allowed_amount: string
  negotiated_cpt_multiplier: string
  provider_negotiated_payout: string
  funder_funding_amount: string
  spread_amount: string
  law_firm_spread_amount: string
  used_default_rate: boolean
  warning: string | null
  already_batched: boolean
  negotiated_cpt_rate_id: number | null
}

export interface PreviewBill {
  bill_id: number
  case_id: number
  patient_name: string | null
  case_number: string | null
  provider_name: string | null
  original_filename: string
  uploaded_at: string
  line_items: PreviewLineItem[]
}

export interface BatchPreviewResult {
  bills: PreviewBill[]
  batch_period_days: number
  funder_medicare_multiplier: string
  law_firm_spread_percent: string
}
