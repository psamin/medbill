export type CaseStatus =
  | 'active'
  | 'reviewing_bills'
  | 'ready_for_funding'
  | 'funded'
  | 'closed'

export interface PatientCase {
  id: number
  patient_name: string
  case_number: string
  law_firm_id: number
  status: CaseStatus
  total_billed_amount: string
  total_medicare_amount: string
  total_savings: string
  created_at: string
  updated_at: string
}

export interface CreateCaseRequest {
  patient_name: string
  case_number: string
}
