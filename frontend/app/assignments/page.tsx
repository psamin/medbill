'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import AppShell from '@/components/AppShell'
import StatusBadge from '@/components/StatusBadge'
import { isAuthenticated, getUser } from '@/lib/auth'
import { api } from '@/lib/api'
import type { PatientCase } from '@/types/cases'
import type { CaseAssignment, AssignableUser } from '@/types/assignments'

interface CasesResponse  { success: boolean; data: PatientCase[] }
interface UsersResponse  { success: boolean; data: AssignableUser[] }
interface AssignResponse { success: boolean; data: CaseAssignment }
interface AssignmentsResponse { success: boolean; data: CaseAssignment[] }

export default function AssignmentsPage() {
  const router = useRouter()
  const [cases, setCases] = useState<PatientCase[]>([])
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null)
  const [assignments, setAssignments] = useState<CaseAssignment[]>([])
  const [providers, setProviders] = useState<AssignableUser[]>([])
  const [funders, setFunders] = useState<AssignableUser[]>([])
  const [roleFilter, setRoleFilter] = useState<'provider' | 'funder'>('provider')
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('')
  const [formError, setFormError] = useState('')
  const [formLoading, setFormLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/login'); return }
    const user = getUser()
    if (user?.role !== 'law_firm' && user?.role !== 'admin') {
      router.push('/dashboard'); return
    }
    Promise.all([
      api.get<CasesResponse>('/api/cases'),
      api.get<UsersResponse>('/api/users?role=provider'),
      api.get<UsersResponse>('/api/users?role=funder'),
    ]).then(([c, p, f]) => {
      setCases(c.data)
      setProviders(p.data)
      setFunders(f.data)
      if (c.data.length > 0) setSelectedCaseId(c.data[0].id)
    }).catch(console.error)
      .finally(() => setLoading(false))
  }, [router])

  const fetchAssignments = useCallback(async (caseId: number) => {
    try {
      const res = await api.get<AssignmentsResponse>(`/api/cases/${caseId}/assignments`)
      setAssignments(res.data)
    } catch { setAssignments([]) }
  }, [])

  useEffect(() => {
    if (selectedCaseId) fetchAssignments(selectedCaseId)
  }, [selectedCaseId, fetchAssignments])

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCaseId || !selectedUserId) return
    setFormError(''); setFormLoading(true)
    try {
      const res = await api.post<AssignResponse>(`/api/cases/${selectedCaseId}/assignments`, {
        user_id: selectedUserId,
        role_on_case: roleFilter,
      })
      setAssignments(prev => {
        const exists = prev.find(a => a.id === res.data.id)
        return exists ? prev : [...prev, res.data]
      })
      setSelectedUserId('')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to assign')
    } finally { setFormLoading(false) }
  }

  async function handleRemove(assignmentId: number) {
    if (!selectedCaseId) return
    try {
      await api.delete(`/api/cases/${selectedCaseId}/assignments/${assignmentId}`)
      setAssignments(prev => prev.filter(a => a.id !== assignmentId))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  const userOptions = roleFilter === 'provider' ? providers : funders
  const selectedCase = cases.find(c => c.id === selectedCaseId)

  return (
    <AppShell>
      <main className="p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Assignments</h1>
          <p className="mt-1 text-sm text-gray-500">Assign providers and funders to your cases</p>
        </div>

        {loading ? (
          <div className="text-center py-12 text-sm text-gray-400">Loading…</div>
        ) : cases.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-sm text-gray-400">No cases yet. Create a case first before assigning providers or funders.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-6">
            {/* Case list */}
            <div className="col-span-1">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-900">Select Case</p>
                </div>
                <div className="divide-y divide-gray-100">
                  {cases.map(c => (
                    <button key={c.id} onClick={() => setSelectedCaseId(c.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                        selectedCaseId === c.id ? 'bg-blue-50' : ''
                      }`}>
                      <p className={`text-sm font-medium ${selectedCaseId === c.id ? 'text-blue-700' : 'text-gray-900'}`}>
                        {c.case_number}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">{c.patient_name}</p>
                      <div className="mt-1"><StatusBadge status={c.status} /></div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Assignments panel */}
            <div className="col-span-2 space-y-4">
              {selectedCase && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h2 className="text-base font-semibold text-gray-900 mb-1">
                    {selectedCase.case_number} — {selectedCase.patient_name}
                  </h2>
                  <StatusBadge status={selectedCase.status} />

                  {/* Current assignments */}
                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">Current Assignments</p>
                    {assignments.length === 0 ? (
                      <p className="text-sm text-gray-400">No assignments yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {assignments.map(a => (
                          <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2">
                            <div>
                              <span className="text-sm font-medium text-gray-900">
                                {a.user_org || a.user_email}
                              </span>
                              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                                a.role_on_case === 'provider'
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-blue-100 text-blue-700'
                              }`}>
                                {a.role_on_case}
                              </span>
                            </div>
                            <button onClick={() => handleRemove(a.id)}
                              className="text-xs text-red-500 hover:text-red-700 transition-colors">
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Add assignment form */}
                  <form onSubmit={handleAssign} className="mt-5 pt-4 border-t border-gray-100">
                    <p className="text-sm font-medium text-gray-700 mb-3">Add Assignment</p>
                    <div className="flex gap-3">
                      <select value={roleFilter} onChange={e => { setRoleFilter(e.target.value as 'provider' | 'funder'); setSelectedUserId('') }}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="provider">Provider</option>
                        <option value="funder">Funder</option>
                      </select>
                      <select value={selectedUserId} onChange={e => setSelectedUserId(Number(e.target.value) || '')}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">— Select {roleFilter} —</option>
                        {userOptions.map(u => (
                          <option key={u.id} value={u.id}>
                            {u.organization_name || u.email}
                          </option>
                        ))}
                      </select>
                      <button type="submit" disabled={formLoading || !selectedUserId}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap">
                        {formLoading ? '…' : 'Assign'}
                      </button>
                    </div>
                    {formError && (
                      <p className="mt-2 text-sm text-red-600">{formError}</p>
                    )}
                    {userOptions.length === 0 && (
                      <p className="mt-2 text-xs text-gray-400">
                        No {roleFilter}s registered yet. Ask them to create an account.
                      </p>
                    )}
                  </form>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </AppShell>
  )
}
