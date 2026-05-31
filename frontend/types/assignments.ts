export interface CaseAssignment {
  id: number
  case_id: number
  user_id: number
  role_on_case: 'provider' | 'funder'
  assigned_by_user_id: number
  created_at: string
  user_email: string | null
  user_org: string | null
}

export interface AssignableUser {
  id: number
  email: string
  role: string
  organization_name: string | null
  created_at: string
}
