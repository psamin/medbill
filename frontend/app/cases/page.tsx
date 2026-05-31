'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'
import CaseTable from '@/components/CaseTable'
import { isAuthenticated, getUser } from '@/lib/auth'
import { api } from '@/lib/api'
import type { PatientCase } from '@/types/cases'
import type { User } from '@/types/auth'

interface CasesResponse {
  success: boolean
  data: PatientCase[]
}

interface CreateCaseResponse {
  success: boolean
  data: PatientCase
}

export default function CasesPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [cases, setCases] = useState<PatientCase[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [patientName, setPatientName] = useState('')
  const [caseNumber, setCaseNumber] = useState('')
  const [formError, setFormError] = useState('')
  const [formLoading, setFormLoading] = useState(false)

  const fetchCases = useCallback(async () => {
    try {
      const res = await api.get<CasesResponse>('/api/cases')
      setCases(res.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }
    setUser(getUser())
    fetchCases()
  }, [router, fetchCases])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    setFormLoading(true)
    try {
      const res = await api.post<CreateCaseResponse>('/api/cases', {
        patient_name: patientName,
        case_number: caseNumber,
      })
      setCases((prev) => [res.data, ...prev])
      setPatientName('')
      setCaseNumber('')
      setShowForm(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create case')
    } finally {
      setFormLoading(false)
    }
  }

  const canCreate = user?.role === 'law_firm' || user?.role === 'admin'

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Cases</h1>
              {!loading && (
                <p className="mt-1 text-sm text-gray-500">
                  {cases.length} case{cases.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
            {canCreate && (
              <button
                onClick={() => { setShowForm((v) => !v); setFormError('') }}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                {showForm ? 'Cancel' : 'New Case'}
              </button>
            )}
          </div>

          {showForm && (
            <form
              onSubmit={handleCreate}
              className="bg-white rounded-xl border border-gray-200 p-6 mb-6"
            >
              <h2 className="text-base font-semibold text-gray-900 mb-4">New Patient Case</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Patient Name
                  </label>
                  <input
                    type="text"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Jane Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Case Number
                  </label>
                  <input
                    type="text"
                    value={caseNumber}
                    onChange={(e) => setCaseNumber(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="2024-001"
                  />
                </div>
              </div>
              {formError && (
                <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
                  {formError}
                </p>
              )}
              <div className="mt-4 flex gap-3">
                <button
                  type="submit"
                  disabled={formLoading}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {formLoading ? 'Creating…' : 'Create Case'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="text-center py-12 text-sm text-gray-400">Loading cases…</div>
          ) : (
            <CaseTable cases={cases} />
          )}
        </div>
      </main>
    </>
  )
}
