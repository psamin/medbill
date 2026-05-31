'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import type { MedicalBill } from '@/types/billing'
import type { AssignableUser } from '@/types/assignments'

interface UploadFormProps {
  caseId: number
  userRole: string
}

interface UploadResponse { success: boolean; data: MedicalBill }
interface UsersResponse  { success: boolean; data: AssignableUser[] }

export default function UploadForm({ caseId, userRole }: UploadFormProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [providerName, setProviderName] = useState('')
  const [providers, setProviders] = useState<AssignableUser[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (userRole === 'law_firm') {
      api.get<UsersResponse>('/api/users?role=provider')
        .then(r => setProviders(r.data))
        .catch(() => {})
    }
  }, [userRole])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null)
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { setError('Please select a PDF file'); return }
    setError(''); setLoading(true)

    const formData = new FormData()
    formData.append('file', file)
    if (providerName) formData.append('provider_name', providerName)

    try {
      const res = await api.upload<UploadResponse>(`/api/cases/${caseId}/bills/upload`, formData)
      router.push(`/bills/${res.data.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally { setLoading(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="space-y-5">

        {/* Provider name — dropdown for law_firm, hidden for provider (auto-filled backend) */}
        {userRole === 'law_firm' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Provider <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            {providers.length > 0 ? (
              <select value={providerName} onChange={e => setProviderName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Select a provider or enter manually —</option>
                {providers.map(p => (
                  <option key={p.id} value={p.organization_name || p.email}>
                    {p.organization_name || p.email}
                  </option>
                ))}
              </select>
            ) : (
              <input type="text" value={providerName} onChange={e => setProviderName(e.target.value)}
                placeholder="e.g. City General Hospital"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">PDF File</label>
          <div onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
              file ? 'border-blue-300 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-white'
            }`}>
            <input ref={fileRef} type="file" accept=".pdf,application/pdf" onChange={handleFileChange} className="hidden" />
            {file ? (
              <>
                <p className="text-sm font-medium text-blue-700">{file.name}</p>
                <p className="text-xs text-blue-500 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                <p className="text-xs text-gray-400 mt-2">Click to change</p>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500">Click to select a PDF</p>
                <p className="text-xs text-gray-400 mt-1">Max 10 MB</p>
              </>
            )}
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{error}</p>
        )}

        <button type="submit" disabled={loading || !file}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {loading ? 'Uploading…' : 'Upload Bill'}
        </button>
      </div>
    </form>
  )
}
