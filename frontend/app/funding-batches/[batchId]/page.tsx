'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/AppShell'
import { isAuthenticated, getUser } from '@/lib/auth'
import { api } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { FundingBatch, FundingBatchItem } from '@/types/billing'
import type { User } from '@/types/auth'
import type { PatientCase } from '@/types/cases'

type BatchDetail = FundingBatch & { items: FundingBatchItem[]; case?: PatientCase }
interface BatchResponse { success: boolean; data: BatchDetail }

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', submitted: 'Submitted', funder_review: 'Under Review',
  partially_funded: 'Partially Funded', funded: 'Funded', rejected: 'Rejected', closed: 'Closed',
}
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  funder_review: 'bg-amber-50 text-amber-700 border-amber-200',
  partially_funded: 'bg-purple-50 text-purple-700 border-purple-200',
  funded: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
}
const ITEM_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-500',
  funded: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
}

function MathRow({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
      <div>
        <span className="text-sm text-gray-700">{label}</span>
        {sub && <span className="block text-xs text-gray-400">{sub}</span>}
      </div>
      <span className={`text-sm font-semibold tabular-nums ${accent ?? 'text-gray-900'}`}>{value}</span>
    </div>
  )
}

interface Props { params: Promise<{ batchId: string }> }

export default function BatchDetailPage({ params }: Props) {
  const { batchId } = use(params)
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [batch, setBatch] = useState<BatchDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  // Per-item reject form state
  const [rejectingItemId, setRejectingItemId] = useState<number | null>(null)
  const [itemRejectReason, setItemRejectReason] = useState('')

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/login'); return }
    setUser(getUser())
    api.get<BatchResponse>(`/api/funding-batches/${batchId}`)
      .then(r => setBatch(r.data))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load batch'))
      .finally(() => setLoading(false))
  }, [batchId, router])

  async function runBatchAction(path: string, body?: Record<string, string>) {
    setActionLoading(true); setActionError('')
    try {
      const res = await api.post<BatchResponse>(`/api/funding-batches/${batchId}/${path}`, body)
      setBatch(res.data)
      setShowRejectForm(false); setRejectReason('')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    } finally { setActionLoading(false) }
  }

  async function runItemAction(itemId: number, action: 'fund' | 'reject', reason?: string) {
    setActionLoading(true); setActionError('')
    try {
      const res = await api.post<BatchResponse>(
        `/api/funding-batches/${batchId}/items/${itemId}/${action}`,
        reason ? { reason } : undefined
      )
      setBatch(res.data)
      setRejectingItemId(null); setItemRejectReason('')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    } finally { setActionLoading(false) }
  }

  if (loading) return (
    <AppShell><main className="p-8"><div className="text-sm text-gray-400 text-center py-12">Loading…</div></main></AppShell>
  )
  if (error || !batch) return (
    <AppShell><main className="p-8">
      <Link href="/funding-batches" className="text-sm text-blue-600 hover:text-blue-700">← Funding Batches</Link>
      <p className="mt-4 text-sm text-red-600">{error || 'Batch not found'}</p>
    </main></AppShell>
  )

  const role = user?.role ?? ''
  const isFunder = role === 'funder' || role === 'admin'
  const isLawFirm = role === 'law_firm' || role === 'admin'
  const showLfSpread = isLawFirm
  const canSubmit = isLawFirm && batch.status === 'draft' && !!batch.assigned_funder_id && batch.item_count > 0
  const canStartReview = isFunder && batch.status === 'submitted'
  const batchOpen = ['submitted', 'funder_review', 'partially_funded'].includes(batch.status)
  const canBatchFundOrReject = isFunder && batchOpen
  const canItemAction = isFunder && batchOpen

  const statusClass = STATUS_COLORS[batch.status] ?? STATUS_COLORS.draft

  return (
    <AppShell>
      <main className="p-8">
        <div className="mb-6">
          <Link href="/funding-batches" className="text-sm text-blue-600 hover:text-blue-700">← Funding Batches</Link>
        </div>

        {/* Header card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900">
                  {batch.batch_name || `Batch #${batch.id}`}
                </h1>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${statusClass}`}>
                  {STATUS_LABELS[batch.status] ?? batch.status}
                </span>
              </div>
              <div className="mt-1 text-sm text-gray-500 flex flex-wrap gap-x-4 gap-y-0.5">
                {batch.case && (
                  <span>
                    Case{' '}
                    <Link href={`/cases/${batch.case_id}`} className="text-blue-600 hover:text-blue-700">
                      #{batch.case.case_number}
                    </Link>
                    {' — '}{batch.case.patient_name}
                  </span>
                )}
                {batch.provider_org && <span>Provider: <strong>{batch.provider_org}</strong></span>}
                {batch.assigned_funder_org && <span>Funder: <strong>{batch.assigned_funder_org}</strong></span>}
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {batch.item_count} item{batch.item_count !== 1 ? 's' : ''} · Created {formatDate(batch.created_at)}
                {batch.batch_start_date && batch.batch_end_date && (
                  <> · {batch.batch_start_date} – {batch.batch_end_date}</>
                )}
              </p>
              {batch.notes && (
                <p className="mt-2 text-sm text-gray-600 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg">{batch.notes}</p>
              )}
              {batch.rejection_reason && (
                <p className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
                  Rejection: {batch.rejection_reason}
                </p>
              )}
            </div>

            {/* Batch-level actions */}
            <div className="flex flex-col items-end gap-2 shrink-0">
              {canSubmit && (
                <button onClick={() => runBatchAction('submit')} disabled={actionLoading}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {actionLoading ? 'Submitting…' : 'Submit to Funder'}
                </button>
              )}
              {canStartReview && (
                <button onClick={() => runBatchAction('start-review')} disabled={actionLoading}
                  className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50">
                  {actionLoading ? '…' : 'Start Review'}
                </button>
              )}
              {canBatchFundOrReject && !showRejectForm && (
                <div className="flex gap-2">
                  <button onClick={() => runBatchAction('fund')} disabled={actionLoading}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                    {actionLoading ? '…' : 'Fund All'}
                  </button>
                  <button onClick={() => setShowRejectForm(true)} disabled={actionLoading}
                    className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100 disabled:opacity-50">
                    Reject All
                  </button>
                </div>
              )}
            </div>
          </div>

          {showRejectForm && (
            <form onSubmit={e => { e.preventDefault(); runBatchAction('reject', rejectReason ? { reason: rejectReason } : undefined) }}
              className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm font-medium text-red-700 mb-2">Reject entire batch?</p>
              <input type="text" value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                placeholder="Reason (optional)"
                className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm bg-white mb-3 focus:outline-none focus:ring-2 focus:ring-red-400" />
              <div className="flex gap-2">
                <button type="submit" disabled={actionLoading}
                  className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                  {actionLoading ? 'Rejecting…' : 'Confirm Reject'}
                </button>
                <button type="button" onClick={() => { setShowRejectForm(false); setRejectReason('') }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              </div>
            </form>
          )}

          {actionError && (
            <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{actionError}</p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Funding math summary */}
          <div className="lg:col-span-1 bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Funding Summary</h2>
            <div>
              <MathRow label="Total Billed" value={formatCurrency(batch.total_billed_amount)} />
              <MathRow label="Medicare Allowed Amount" sub="Basis for all calculations" value={formatCurrency(batch.total_medicare_amount)} />
              <MathRow label="Provider Negotiated Payout" sub="CPT-specific rates per line" value={formatCurrency(batch.total_provider_negotiated_payout)} />
              <MathRow label="Funder Funding Amount" sub="160% of Medicare Allowed" value={formatCurrency(batch.total_funder_funding_amount)} accent="text-blue-700" />
              {showLfSpread && <>
                <MathRow label="Spread" sub="Funder Funding − Provider Payout" value={formatCurrency(batch.total_spread_amount)} />
                <MathRow label="Law Firm Spread" sub="60% of Spread" value={formatCurrency(batch.total_law_firm_spread_amount)} accent="text-green-700" />
                <MathRow label="Remaining Spread" sub="40% of Spread" value={formatCurrency(batch.total_remaining_spread_amount)} />
              </>}
            </div>
            {batch.items?.some(i => i.used_default_rate) && (
              <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                ⚠ Some items used the default 100% Medicare rate — no CPT-specific negotiated rate was found.
              </div>
            )}
          </div>

          {/* Items table */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                Batch Items <span className="font-normal text-gray-400">({batch.items?.length ?? 0})</span>
              </h2>
              {batch.items?.some(i => i.used_default_rate) && (
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">⚠ Default rate used</span>
              )}
            </div>
            {!batch.items?.length ? (
              <div className="p-8 text-center text-sm text-gray-400">No items in this batch.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500">CPT</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500">Description</th>
                      <th className="text-right px-4 py-2.5 font-medium text-gray-500">Rate</th>
                      <th className="text-right px-4 py-2.5 font-medium text-gray-500">Medicare</th>
                      <th className="text-right px-4 py-2.5 font-medium text-gray-500">Provider Payout</th>
                      <th className="text-right px-4 py-2.5 font-medium text-gray-500">Funder Funds</th>
                      {showLfSpread && <th className="text-right px-4 py-2.5 font-medium text-gray-500">LF Spread</th>}
                      {canItemAction && <th className="px-4 py-2.5 font-medium text-gray-500">Status</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {batch.items.map(item => (
                      <tr key={item.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-mono text-gray-700">
                          {item.cpt_code ?? '—'}
                          {item.used_default_rate && <span className="ml-1 text-amber-500" title={item.warning ?? ''}>⚠</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 max-w-[140px] truncate" title={item.description ?? ''}>{item.description ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right text-blue-700">{(parseFloat(item.negotiated_cpt_multiplier) * 100).toFixed(0)}%</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(item.medicare_allowed_amount)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(item.provider_negotiated_payout)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-blue-700 font-medium">{formatCurrency(item.funder_funding_amount)}</td>
                        {showLfSpread && <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{formatCurrency(item.law_firm_spread_amount)}</td>}
                        {canItemAction && (
                          <td className="px-4 py-2.5">
                            {item.item_status !== 'pending' ? (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ITEM_STATUS_COLORS[item.item_status]}`}>
                                {item.item_status === 'funded' ? '✓ Funded' : '✕ Rejected'}
                              </span>
                            ) : rejectingItemId === item.id ? (
                              <div className="flex flex-col gap-1">
                                <input
                                  type="text" value={itemRejectReason} onChange={e => setItemRejectReason(e.target.value)}
                                  placeholder="Reason…" autoFocus
                                  className="px-2 py-1 border border-red-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-red-400 w-32"
                                />
                                <div className="flex gap-1">
                                  <button onClick={() => runItemAction(item.id, 'reject', itemRejectReason || undefined)} disabled={actionLoading}
                                    className="px-2 py-0.5 bg-red-600 text-white rounded text-xs hover:bg-red-700 disabled:opacity-50">Reject</button>
                                  <button onClick={() => { setRejectingItemId(null); setItemRejectReason('') }}
                                    className="px-2 py-0.5 text-gray-500 hover:text-gray-800 text-xs">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex gap-1">
                                <button onClick={() => runItemAction(item.id, 'fund')} disabled={actionLoading}
                                  className="px-2 py-1 bg-green-50 text-green-700 border border-green-200 rounded text-xs hover:bg-green-100 disabled:opacity-50 font-medium">Fund</button>
                                <button onClick={() => { setRejectingItemId(item.id); setItemRejectReason('') }} disabled={actionLoading}
                                  className="px-2 py-1 bg-red-50 text-red-600 border border-red-200 rounded text-xs hover:bg-red-100 disabled:opacity-50">Reject</button>
                              </div>
                            )}
                          </td>
                        )}
                        {!canItemAction && item.item_status !== 'pending' && (
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ITEM_STATUS_COLORS[item.item_status]}`}>
                              {item.item_status === 'funded' ? '✓ Funded' : '✕ Rejected'}
                            </span>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-200 font-semibold text-xs">
                      <td className="px-4 py-2.5 text-gray-700" colSpan={3}>Totals</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(batch.total_medicare_amount)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(batch.total_provider_negotiated_payout)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-blue-700">{formatCurrency(batch.total_funder_funding_amount)}</td>
                      {showLfSpread && <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{formatCurrency(batch.total_law_firm_spread_amount)}</td>}
                      {(canItemAction || batch.items.some(i => i.item_status !== 'pending')) && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  )
}
