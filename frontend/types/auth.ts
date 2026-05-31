export type UserRole = 'law_firm' | 'provider' | 'funder' | 'admin'

export interface User {
  id: number
  email: string
  role: UserRole
  organization_name: string | null
  created_at: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
  role: UserRole
  organization_name?: string
}

export interface AuthResponse {
  success: boolean
  data: {
    token: string
    user: User
  }
}
