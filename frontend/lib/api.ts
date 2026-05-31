const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('session_token')
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`)
  }

  return data as T
}

export const api = {
  get: <T>(path: string) =>
    request<T>(path, { method: 'GET' }),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),

  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const token = getToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: formData,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `Upload failed with status ${res.status}`)
    return data as T
  },
}
