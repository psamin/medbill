'use client'

import { use, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/AppShell'
import StatusBadge from '@/components/StatusBadge'
import { isAuthenticated, getUser } from '@/lib/auth'
import { api } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { PatientCase } from '@/types/cases'
import type { MedicalBill, FundingBatch } from '@/types/billing'
import type { User } from '@/types/auth'
import type { CaseAssignment, AssignableUser } from '@/types/assignments'

type Tab = 'overview' | 'bills' | 'assignments' | 'batches'

type CaseDetail = PatientCase & { bills: MedicalBill[]; assignments: CaseAssignment[] }
interface CaseDetailResponse  { success: boolean; data: CaseDetail }
interface BatchListResponse   { success: boolean; data: FundingBatch[] }
interface BatchCreateResponse { success: boolean; data: FundingBatch }
interface UsersResponse       { success: boolean; data: AssignableUser[] }
interface AssignResponse      { success: boolean; data: CaseAssignment }
interface Props { params: Promise<{ caseId: string }> }


const BATCH_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', submitted: 'Submitted', funder_review: 'Under Review',
  partially_funded: 'Partially Funded', funded: 'Funded', rejected: 'Rejected',
}
const BATCH_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', submitted: 'bg-blue-100 text-blue-700',
  funder_review: 'bg-amber-100 text-amber-700', partially_funded: 'bg-purple-100 text-purple-700',
  funded: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700',
}

export default function CaseDetailPage({ params }: Props) {
  const { caseId } = use(params)
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [caseData, setCaseData] = useState<CaseDetail | null>(null)
  const [batches, setBatches] = useState<FundingBatch[]>([])
  const [providers, setProviders] = useState<AssignableUser[]>([])
  const [funders, setFunders] = useState<AssignableUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('overview')

  // Assignment form state
  const [assignRole, setAssignRole] = useState<'provider' | 'funder'>('provider')
  const [assignUserId, setAssignUserId] = useState<number | ''>('')
  const [assignError, setAssignError] = useState('')
  const [assignLoading, setAssignLoading] = useState(false)

  // Close/Reopen state
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [closeReason, setCloseReason] = useState('')
  const [closeLoading, setCloseLoading] = useState(false)

  // Batch creation state
  const [autoOpenUpload, setAutoOpenUpload] = useState(false)
  const [showBatchForm, setShowBatchForm] = useState(false)
  const [selectedBillIds, setSelectedBillIds] = useState<Set<number>>(new Set())
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const [selectedFunderId, setSelectedFunderId] = useState<string>('')
  const [batchName, setBatchName] = useState('')
  const [batchNotes, setBatchNotes] = useState('')
  const [batchError, setBatchError] = useState('')
  const [batchLoading, setBatchLoading] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/login'); return }
    const u = getUser()
    setUser(u)
    const canManage = u?.role === 'law_firm' || u?.role === 'admin'

    const promises: Promise<unknown>[] = [
      api.get<CaseDetailResponse>(`/api/cases/${caseId}`),
      api.get<BatchListResponse>(`/api/cases/${caseId}/funding-batches`),
    ]
    if (canManage) {
      promises.push(api.get<UsersResponse>('/api/users?role=provider'))
      promises.push(api.get<UsersResponse>('/api/users?role=funder'))
    }

    Promise.all(promises)
      .then(([caseRes, batchRes, provRes, fundRes]) => {
        const cd = (caseRes as CaseDetailResponse).data
        setCaseData(cd)
        setBatches((batchRes as BatchListResponse).data)
        if (provRes) setProviders((provRes as UsersResponse).data)
        if (fundRes) setFunders((fundRes as UsersResponse).data)
        // Pre-select single provider/funder
        const provAssign = cd.assignments.filter(a => a.role_on_case === 'provider')
        const fundAssign = cd.assignments.filter(a => a.role_on_case === 'funder')
        if (provAssign.length === 1) setSelectedProviderId(String(provAssign[0].user_id))
        if (fundAssign.length === 1) setSelectedFunderId(String(fundAssign[0].user_id))
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load case'))
      .finally(() => setLoading(false))
  }, [caseId, router])

  const canManage    = user?.role === 'law_firm' || user?.role === 'admin'
  const isClosed     = caseData?.status === 'closed'
  const canUpload    = user?.role !== 'funder' && !isClosed
  const isProvider   = user?.role === 'provider'

  async function closeCase() {
    setCloseLoading(true)
    try {
      interface CaseResponse { success: boolean; data: CaseDetail }
      const res = await api.post<CaseResponse>(`/api/cases/${caseId}/close`, { reason: closeReason })
      setCaseData(prev => prev ? { ...prev, ...res.data } : prev)
      setShowCloseModal(false); setCloseReason('')
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed to close case') }
    finally { setCloseLoading(false) }
  }

  async function reopenCase() {
    try {
      interface CaseResponse { success: boolean; data: CaseDetail }
      const res = await api.post<CaseResponse>(`/api/cases/${caseId}/reopen`)
      setCaseData(prev => prev ? { ...prev, ...res.data } : prev)
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed to reopen case') }
  }
  const showLfSpread = user?.role === 'law_firm' || user?.role === 'admin'
  const showFunderAmount = !isProvider

  const funderAssignments   = caseData?.assignments.filter(a => a.role_on_case === 'funder') ?? []
  const providerAssignments = caseData?.assignments.filter(a => a.role_on_case === 'provider') ?? []
  const completedBills      = caseData?.bills.filter(b => b.status === 'completed') ?? []

  // Provider-facing: expected payout derived from active/funded batches on this case
  const totalProviderPayout = batches
    .filter(b => ['submitted', 'funder_review', 'partially_funded', 'funded'].includes(b.status))
    .reduce((sum, b) => sum + parseFloat(b.total_provider_negotiated_payout || '0'), 0)
    .toFixed(2)

  // ── Assignment helpers ─────────────────────────────────────────────────────
  async function handleAssign(e: React.FormEvent) {
    e.preventDefault()
    if (!assignUserId) return
    setAssignError(''); setAssignLoading(true)
    try {
      const res = await api.post<AssignResponse>(`/api/cases/${caseId}/assignments`, {
        user_id: assignUserId, role_on_case: assignRole,
      })
      setCaseData(prev => prev ? { ...prev, assignments: [...prev.assignments.filter(a => a.id !== res.data.id), res.data] } : prev)
      setAssignUserId('')
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : 'Failed to assign')
    } finally { setAssignLoading(false) }
  }

  async function handleRemoveAssignment(assignId: number) {
    try {
      await api.delete(`/api/cases/${caseId}/assignments/${assignId}`)
      setCaseData(prev => prev ? { ...prev, assignments: prev.assignments.filter(a => a.id !== assignId) } : prev)
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed to remove') }
  }

  // ── Batch helpers ──────────────────────────────────────────────────────────
  function toggleBill(id: number) {
    setSelectedBillIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function createBatch() {
    if (!selectedProviderId) { setBatchError('Select a provider'); return }
    if (selectedBillIds.size === 0) { setBatchError('Select at least one bill'); return }
    setBatchLoading(true); setBatchError('')
    try {
      const res = await api.post<BatchCreateResponse>(`/api/cases/${caseId}/funding-batches`, {
        provider_id: parseInt(selectedProviderId),
        bill_ids: Array.from(selectedBillIds),
        assigned_funder_id: selectedFunderId ? parseInt(selectedFunderId) : null,
        batch_name: batchName || null,
        notes: batchNotes || null,
      })
      setBatches(prev => [res.data, ...prev])
      setShowBatchForm(false)
      setSelectedBillIds(new Set()); setBatchName(''); setBatchNotes('')
      router.push(`/funding-batches/${res.data.id}`)
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : 'Failed to create batch')
    } finally { setBatchLoading(false) }
  }

  if (loading) return <AppShell><main className="p-4 sm:p-8"><div className="text-sm text-gray-400 text-center py-12">Loading…</div></main></AppShell>
  if (error || !caseData) return (
    <AppShell><main className="p-4 sm:p-8">
      <Link href="/cases" className="text-sm text-blue-600 hover:text-blue-700">← Cases</Link>
      <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-lg">{error || 'Case not found'}</p>
    </main></AppShell>
  )

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'bills', label: `Bills (${caseData.bills.length})` },
    ...(canManage ? [{ id: 'assignments' as Tab, label: 'Assignments' }] : []),
    { id: 'batches', label: `Funding Batches (${batches.length})` },
  ]

  return (
    <AppShell>
      <main className="p-4 sm:p-8">
        <div className="mb-4">
          <Link href="/cases" className="text-sm text-blue-600 hover:text-blue-700">← Cases</Link>
        </div>

        {/* Case header */}
        <div className="bg-white rounded-xl border border-gray-200 px-4 sm:px-6 pt-5 sm:pt-6 pb-0 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{caseData.patient_name}</h1>
                <StatusBadge status={caseData.status} />
              </div>
              <p className="mt-1 text-sm text-gray-500">Case #{caseData.case_number} · Created {formatDate(caseData.created_at)}</p>
              <div className="mt-1 flex gap-4 text-xs text-gray-400 flex-wrap">
                {providerAssignments.length > 0 && (
                  <span>Provider: <strong className="text-gray-600">{providerAssignments.map(a => a.user_org || a.user_email).join(', ')}</strong></span>
                )}
                {funderAssignments.length > 0 && (
                  <span>Funder: <strong className="text-gray-600">{funderAssignments.map(a => a.user_org || a.user_email).join(', ')}</strong></span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              {canManage && (
                <Link href="/negotiated-cpt-rates" className="border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50">
                  CPT Rates
                </Link>
              )}
              {canManage && isClosed && (
                <button onClick={reopenCase}
                  className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-50">
                  Reopen Case
                </button>
              )}
              {canManage && !isClosed && (
                <button onClick={() => setShowCloseModal(true)}
                  className="border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-50 hover:text-gray-900">
                  Close Case
                </button>
              )}
              {canUpload && tab !== 'bills' && (
                <button onClick={() => { setTab('bills'); setAutoOpenUpload(true) }}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">
                  Upload Bill
                </button>
              )}
            </div>
          </div>

          {/* Tab nav — scrollable on small screens */}
          <div className="flex gap-0 -mb-px overflow-x-auto scrollbar-none">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  tab === t.id
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Closed case banner */}
        {isClosed && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <span className="text-sm font-medium text-gray-700">This case is closed.</span>
              <span className="ml-2 text-sm text-gray-500">
                Bills and batches are read-only.
                {caseData?.close_reason && <> Reason: <em>{caseData.close_reason}</em></>}
              </span>
            </div>
            {canManage && (
              <button onClick={reopenCase} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                Reopen →
              </button>
            )}
          </div>
        )}

        {/* Close confirmation modal */}
        {showCloseModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div className="bg-white rounded-xl border border-gray-200 shadow-xl p-6 w-full max-w-md mx-4">
              <h2 className="text-base font-semibold text-gray-900 mb-2">Close this case?</h2>
              <p className="text-sm text-gray-500 mb-4">
                Closing will prevent new bills, batches, or assignment changes unless the case is reopened.
                All existing data remains accessible.
              </p>
              <label className="block text-xs font-medium text-gray-700 mb-1">Reason (optional)</label>
              <input
                type="text"
                value={closeReason}
                onChange={e => setCloseReason(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') closeCase(); if (e.key === 'Escape') setShowCloseModal(false) }}
                placeholder="e.g. Settled, funded, workflow complete"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowCloseModal(false); setCloseReason('') }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                  Cancel
                </button>
                <button onClick={closeCase} disabled={closeLoading}
                  className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50">
                  {closeLoading ? 'Closing…' : 'Close Case'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="space-y-6">
            {/* Totals */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Total Billed</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">{formatCurrency(caseData.total_billed_amount)}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Medicare Benchmark</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">{formatCurrency(caseData.total_medicare_amount)}</p>
              </div>
              {isProvider ? (
                <div className="bg-blue-50 rounded-xl border border-blue-200 p-5">
                  <p className="text-xs text-blue-600 uppercase tracking-wide">Expected Provider Payout</p>
                  <p className="mt-1 text-2xl font-semibold text-blue-700 tabular-nums">{formatCurrency(totalProviderPayout)}</p>
                </div>
              ) : (
                <div className="bg-green-50 rounded-xl border border-green-200 p-5">
                  <p className="text-xs text-green-600 uppercase tracking-wide">Case Savings vs Billed</p>
                  <p className="mt-1 text-2xl font-semibold text-green-700 tabular-nums">{formatCurrency(caseData.total_savings)}</p>
                </div>
              )}
            </div>

            {/* Quick stats */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Case Summary</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Bills</p>
                  <p className="font-semibold text-gray-900">{caseData.bills.length}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Completed Bills</p>
                  <p className="font-semibold text-gray-900">{completedBills.length}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Funding Batches</p>
                  <p className="font-semibold text-gray-900">{batches.length}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Funded Batches</p>
                  <p className="font-semibold text-gray-900">{batches.filter(b => b.status === 'funded').length}</p>
                </div>
              </div>
            </div>

            {/* Recent bills preview */}
            {caseData.bills.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900">Recent Bills</h2>
                  <button onClick={() => setTab('bills')} className="text-xs text-blue-600 hover:text-blue-700">View all →</button>
                </div>
                <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm">
                  <tbody>
                    {caseData.bills.slice(0, 3).map(bill => (
                      <tr key={bill.id}
                        className="border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
                        onClick={() => router.push(`/bills/${bill.id}`)}>
                        <td className="px-5 py-3 font-medium text-blue-700">{bill.display_name || bill.provider_name || bill.original_filename}</td>
                        <td className="px-5 py-3"><StatusBadge status={bill.status} /></td>
                        <td className="px-5 py-3 text-right tabular-nums text-gray-700">{formatCurrency(bill.total_billed_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            )}
          </div>
        )}

        {/* ── BILLS TAB ────────────────────────────────────────────────────── */}
        {tab === 'bills' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Bills</h2>
              {canUpload && (
                <UploadBillInline
                  caseId={caseId}
                  autoOpen={autoOpenUpload}
                  onAutoOpenConsumed={() => setAutoOpenUpload(false)}
                  onUploaded={bill => {
                    setCaseData(prev => prev ? { ...prev, bills: [...prev.bills, bill] } : prev)
                  }}
                />
              )}
            </div>
            {caseData.bills.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-sm text-gray-400">No bills yet. Upload a bill to get started.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500">Provider / File</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500">Status</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500 hidden sm:table-cell">Funding</th>
                      <th className="text-right px-4 sm:px-5 py-3 font-medium text-gray-500">Billed</th>
                      <th className="text-right px-4 sm:px-5 py-3 font-medium text-gray-500 hidden sm:table-cell">Medicare</th>
                      <th className="text-right px-4 sm:px-5 py-3 font-medium text-gray-500 hidden md:table-cell">Items</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500 hidden md:table-cell">Uploaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {caseData.bills.map(bill => (
                      <tr key={bill.id}
                        className="border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
                        onClick={() => router.push(`/bills/${bill.id}`)}>
                        <td className="px-4 sm:px-5 py-3">
                          <p className="font-medium text-blue-700">{bill.display_name || bill.provider_name || bill.original_filename}</p>
                          {(bill.display_name || bill.provider_name) && <p className="text-xs text-gray-400">{bill.original_filename}</p>}
                        </td>
                        <td className="px-4 sm:px-5 py-3"><StatusBadge status={bill.status} /></td>
                        <td className="px-4 sm:px-5 py-3 hidden sm:table-cell">
                          {bill.funding_status !== 'not_requested' && (
                            <StatusBadge status={bill.funding_status} />
                          )}
                        </td>
                        <td className="px-4 sm:px-5 py-3 text-right tabular-nums">{formatCurrency(bill.total_billed_amount)}</td>
                        <td className="px-4 sm:px-5 py-3 text-right tabular-nums hidden sm:table-cell">{formatCurrency(bill.total_medicare_amount)}</td>
                        <td className="px-4 sm:px-5 py-3 text-right text-gray-500 hidden md:table-cell">{bill.matched_line_item_count}/{bill.line_item_count}</td>
                        <td className="px-4 sm:px-5 py-3 text-xs text-gray-400 hidden md:table-cell">{formatDate(bill.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ASSIGNMENTS TAB ──────────────────────────────────────────────── */}
        {tab === 'assignments' && canManage && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Assignments</h2>

            {caseData.assignments.length === 0 ? (
              <p className="text-sm text-gray-400 mb-4">No providers or funders assigned yet.</p>
            ) : (
              <div className="space-y-2 mb-5">
                {caseData.assignments.map(a => (
                  <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5">
                    <div>
                      <span className="text-sm font-medium text-gray-900">{a.user_org || a.user_email}</span>
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${a.role_on_case === 'provider' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>
                        {a.role_on_case}
                      </span>
                    </div>
                    <button onClick={() => handleRemoveAssignment(a.id)}
                      className="text-xs text-red-500 hover:text-red-700">Remove</button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleAssign} className="border-t border-gray-100 pt-4">
              <p className="text-sm font-medium text-gray-700 mb-3">Add Assignment</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <select value={assignRole} onChange={e => { setAssignRole(e.target.value as 'provider' | 'funder'); setAssignUserId('') }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="provider">Provider</option>
                  <option value="funder">Funder</option>
                </select>
                <select value={assignUserId} onChange={e => setAssignUserId(Number(e.target.value) || '')}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Select {assignRole} —</option>
                  {(assignRole === 'provider' ? providers : funders).map(u => (
                    <option key={u.id} value={u.id}>{u.organization_name || u.email}</option>
                  ))}
                </select>
                <button type="submit" disabled={assignLoading || !assignUserId}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {assignLoading ? '…' : 'Assign'}
                </button>
              </div>
              {assignError && <p className="mt-2 text-sm text-red-600">{assignError}</p>}
            </form>
          </div>
        )}

        {/* ── FUNDING BATCHES TAB ──────────────────────────────────────────── */}
        {tab === 'batches' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Funding Batches</h2>
              {canManage && !isClosed && completedBills.length > 0 && (
                <button onClick={() => setShowBatchForm(!showBatchForm)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
                  {showBatchForm ? 'Cancel' : '+ Create 15-Day Batch'}
                </button>
              )}
            </div>

            {/* Batch creation form */}
            {showBatchForm && canManage && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-5">
                <h3 className="text-sm font-semibold text-blue-900 mb-1">Create Funding Batch</h3>
                <p className="text-xs text-blue-600 mb-4">
                  Each selected bill's line items will use CPT-specific negotiated rates. Batch totals update automatically.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs font-medium text-gray-700 mb-1 block">Provider *</label>
                    {providerAssignments.length === 0 ? (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                        No provider assigned. <button onClick={() => setTab('assignments')} className="underline">Go to Assignments →</button>
                      </p>
                    ) : (
                      <select value={selectedProviderId} onChange={e => setSelectedProviderId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                        <option value="">Select provider…</option>
                        {providerAssignments.map(a => (
                          <option key={a.user_id} value={String(a.user_id)}>{a.user_org || a.user_email}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700 mb-1 block">Assign Funder</label>
                    <select value={selectedFunderId} onChange={e => setSelectedFunderId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                      <option value="">No funder yet</option>
                      {funderAssignments.map(a => (
                        <option key={a.user_id} value={String(a.user_id)}>{a.user_org || a.user_email}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700 mb-1 block">Batch Name</label>
                    <input type="text" value={batchName} onChange={e => setBatchName(e.target.value)} placeholder="e.g. May 2026 Batch"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700 mb-1 block">Notes</label>
                    <input type="text" value={batchNotes} onChange={e => setBatchNotes(e.target.value)} placeholder="Optional"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                </div>

                <label className="text-xs font-medium text-gray-700 mb-2 block">
                  Select completed bills ({selectedBillIds.size} selected)
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto mb-3">
                  {completedBills.map(bill => (
                    <label key={bill.id} className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={selectedBillIds.has(bill.id)} onChange={() => toggleBill(bill.id)} className="rounded border-gray-300" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{bill.provider_name || bill.original_filename}</p>
                        <p className="text-xs text-gray-400">{bill.matched_line_item_count} matched · Medicare: {formatCurrency(bill.total_medicare_amount)}</p>
                      </div>
                      <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatCurrency(bill.total_billed_amount)}</span>
                    </label>
                  ))}
                </div>

                {batchError && (
                  <p className="text-xs text-red-600 mb-3 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{batchError}</p>
                )}
                <button onClick={createBatch} disabled={batchLoading || selectedBillIds.size === 0 || !selectedProviderId}
                  className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {batchLoading ? 'Creating…' : 'Create Draft Batch'}
                </button>
              </div>
            )}

            {batches.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
                <p className="text-sm text-gray-400">No funding batches yet.</p>
                {canManage && completedBills.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">Upload and process bills first.</p>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto"><table className="w-full min-w-[400px] text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500">Batch</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500">Status</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500 hidden sm:table-cell">Funder</th>
                      <th className="text-right px-4 sm:px-5 py-3 font-medium text-gray-500 hidden sm:table-cell">Medicare</th>
                      {showFunderAmount
                        ? <th className="text-right px-4 sm:px-5 py-3 font-medium text-gray-500">Funding</th>
                        : <th className="text-right px-4 sm:px-5 py-3 font-medium text-gray-500">Payout</th>
                      }
                      {showLfSpread && <th className="text-right px-4 sm:px-5 py-3 font-medium text-gray-500 hidden sm:table-cell">LF Spread</th>}
                      <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500 hidden md:table-cell">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map(batch => (
                      <tr key={batch.id}
                        className="border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
                        onClick={() => router.push(`/funding-batches/${batch.id}`)}>
                        <td className="px-4 sm:px-5 py-3">
                          <span className="font-medium text-blue-700">{batch.batch_name || `#${batch.id}`}</span>
                          <span className="text-xs text-gray-400 ml-2">{batch.item_count} items</span>
                        </td>
                        <td className="px-4 sm:px-5 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${BATCH_STATUS_COLORS[batch.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
                          </span>
                        </td>
                        <td className="px-4 sm:px-5 py-3 text-gray-600 text-xs hidden sm:table-cell">{batch.assigned_funder_org ?? '—'}</td>
                        <td className="px-4 sm:px-5 py-3 text-right tabular-nums hidden sm:table-cell">{formatCurrency(batch.total_medicare_amount)}</td>
                        {showFunderAmount
                          ? <td className="px-4 sm:px-5 py-3 text-right tabular-nums text-blue-700 font-medium">{formatCurrency(batch.total_funder_funding_amount)}</td>
                          : <td className="px-4 sm:px-5 py-3 text-right tabular-nums text-blue-700 font-medium">{formatCurrency(batch.total_provider_negotiated_payout)}</td>
                        }
                        {showLfSpread && <td className="px-4 sm:px-5 py-3 text-right tabular-nums text-green-700 hidden sm:table-cell">{formatCurrency(batch.total_law_firm_spread_amount)}</td>}
                        <td className="px-4 sm:px-5 py-3 text-xs text-gray-400 hidden md:table-cell">{formatDate(batch.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </AppShell>
  )
}

// ── Inline upload component ─────────────────────────────────────────────────
interface UploadBillInlineProps {
  caseId: string
  onUploaded: (bill: MedicalBill) => void
  autoOpen?: boolean
  onAutoOpenConsumed?: () => void
}

function UploadBillInline({ caseId, onUploaded, autoOpen, onAutoOpenConsumed }: UploadBillInlineProps) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [billName, setBillName] = useState('')
  const [providerName, setProviderName] = useState('')

  // Auto-open when navigated from the header Upload Bill button on another tab
  useEffect(() => {
    if (autoOpen) {
      setShowForm(true)
      onAutoOpenConsumed?.()
    }
  }, [autoOpen, onAutoOpenConsumed])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setUploadError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (billName)     fd.append('display_name', billName)
      if (providerName) fd.append('provider_name', providerName)
      interface BillResponse { success: boolean; data: MedicalBill }
      const res = await api.upload<BillResponse>(`/api/cases/${caseId}/bills/upload`, fd)
      onUploaded(res.data)
      setShowForm(false); setBillName(''); setProviderName('')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  if (!showForm) return (
    <button onClick={() => setShowForm(true)}
      className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
      Upload Bill
    </button>
  )

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <div>
          <label className="text-xs text-gray-600 mb-1 block">Bill name (optional)</label>
          <input type="text" value={billName} onChange={e => setBillName(e.target.value)}
            placeholder="e.g. ER Visit May 2026"
            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div>
          <label className="text-xs text-gray-600 mb-1 block">Provider name (optional)</label>
          <input type="text" value={providerName} onChange={e => setProviderName(e.target.value)}
            placeholder="e.g. City General Hospital"
            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border cursor-pointer transition-colors ${
          uploading ? 'bg-gray-100 text-gray-400 border-gray-200' : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
        }`}>
          {uploading ? 'Uploading…' : 'Choose PDF'}
          <input type="file" accept=".pdf" onChange={handleFile} disabled={uploading} className="hidden" />
        </label>
        <button onClick={() => { setShowForm(false); setUploadError('') }}
          className="px-3 py-2 text-sm text-gray-500 hover:text-gray-800">Cancel</button>
        {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
      </div>
    </div>
  )
}
