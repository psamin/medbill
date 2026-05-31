export type BillStatus = 'uploaded' | 'processing' | 'completed' | 'failed' | 'review_ready'
export type FundingStatus =
  | 'not_requested'
  | 'funding_requested'
  | 'under_review'
  | 'funded'
  | 'rejected'
export type CodeType = 'CPT' | 'HCPCS' | 'REV' | 'UNKNOWN'
export type MatchStatus = 'matched' | 'unmatched' | 'low_confidence'

export interface MedicalBill {
  id: number
  case_id: number
  uploaded_by_id: number
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
