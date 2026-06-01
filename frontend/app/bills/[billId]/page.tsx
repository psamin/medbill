'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/AppShell'
import StatusBadge from '@/components/StatusBadge'
import LineItemTable from '@/components/LineItemTable'
import { isAuthenticated, getUser } from '@/lib/auth'
import { api } from '@/lib/api'
import { formatCurrency, formatPercentage, formatRatio, formatDate } from '@/lib/formatters'
import type { MedicalBill, BillLineItem } from '@/types/billing'
import type { User } from '@/types/auth'

type BillDetail = MedicalBill & { line_items: BillLineItem[] }
interface BillDetailResponse { success: boolean; data: BillDetail }
interface ReprocessResponse  { success: boolean; data: BillDetail; message?: string }
interface Props { params: Promise<{ billId: string }> }

const EXTRACTION_METHOD_LABELS: Record<string, string> = {
  table_parser:        'Table parser',
  regex_parser:        'Regex parser',
  claude_page_by_page: 'Claude AI',
  regex:               'Regex parser',        // legacy
  regex_fallback:      'Table/regex parser',  // legacy
  failed:              'Failed',
}

export default function BillDetailPage({ params }: Props) {
  const { billId } = use(params)
  const router = useRouter()
  const [bill, setBill] = useState<BillDetail | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [reprocessLoading, setReprocessLoading] = useState(false)
  const [reprocessError, setReprocessError] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameLoading, setRenameLoading] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/login'); return }
    setUser(getUser())
    api.get<BillDetailResponse>(`/api/bills/${billId}`)
      .then(res => setBill(res.data))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load bill'))
      .finally(() => setLoading(false))
  }, [billId, router])

  async function runAction(endpoint: string, body?: Record<string, string>) {
    setActionLoading(true); setActionError('')
    try {
      const res = await api.post<BillDetailResponse>(`/api/bills/${billId}/${endpoint}`, body)
      setBill(prev => prev ? { ...res.data, line_items: prev.line_items } : null)
      setShowRejectForm(false); setRejectReason('')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    } finally { setActionLoading(false) }
  }

  async function handleReprocess() {
    setReprocessLoading(true); setReprocessError('')
    try {
      const res = await api.post<ReprocessResponse>(`/api/bills/${billId}/reprocess-with-claude`)
      setBill(res.data)
    } catch (err) {
      setReprocessError(err instanceof Error ? err.message : 'Reprocess failed')
    } finally { setReprocessLoading(false) }
  }

  if (loading) return (
    <AppShell><main className="p-8"><div className="text-sm text-gray-400 text-center py-12">Loading…</div></main></AppShell>
  )
  if (error || !bill) return (
    <AppShell><main className="p-8"><p className="text-sm text-red-600">{error || 'Bill not found'}</p></main></AppShell>
  )

  const isLawFirm  = user?.role === 'law_firm' || user?.role === 'admin'
  const isFunder   = user?.role === 'funder' || user?.role === 'admin'
  const canRename  = user?.role !== 'funder'

  async function saveRename() {
    setRenameLoading(true)
    try {
      interface PatchResponse { success: boolean; data: BillDetail }
      const res = await api.patch<PatchResponse>(`/api/bills/${billId}`, { display_name: renameValue.trim() })
      setBill(prev => prev ? { ...prev, display_name: res.data.display_name } : prev)
      setRenaming(false)
    } catch { /* ignore — keep form open */ }
    finally { setRenameLoading(false) }
  }
  const canRequestFunding = isLawFirm && bill.status === 'completed' && bill.funding_status === 'not_requested'
  const canActAsFunder    = isFunder && ['funding_requested', 'under_review'].includes(bill.funding_status)
  const canReprocess      = isLawFirm && bill.status !== 'processing' && bill.funding_status !== 'funded'

  const extractionLabel = bill.extraction_method
    ? (EXTRACTION_METHOD_LABELS[bill.extraction_method] ?? bill.extraction_method)
    : null
  const lowConfidenceItems = (bill.line_items ?? []).filter(
    li => li.match_status === 'low_confidence'
  )
  // Old bills may have extraction_status=null but status='completed'
  const extractionSucceeded =
    (bill.extraction_status === 'completed' || bill.status === 'completed') &&
    (bill.line_item_count ?? 0) > 0

  // Technical patterns that are log-only — never shown to users
  const _TECH = ['Claude', 'JSON', 'delimiter', 'Traceback', 'Page ', 'extraction failed', 'parse']
  const visibleWarnings = extractionSucceeded
    ? (bill.extraction_warnings ?? []).filter(w => !_TECH.some(t => w.includes(t)))
    : (bill.extraction_warnings ?? [])

  const hasExtractionWarnings = visibleWarnings.length > 0 || lowConfidenceItems.length > 0
  const extractionIsStale =
    bill.extraction_status === 'failed' ||
    (bill.extraction_method === 'regex_fallback' && (bill.line_item_count ?? 0) < 30 && (bill.detected_row_count ?? 0) > 30)

  return (
    <AppShell>
      <main className="p-8">
        <div className="mb-6">
          <Link href={`/cases/${bill.case_id}`} className="text-sm text-blue-600 hover:text-blue-700">← Case</Link>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              {renaming ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(false) }}
                    className="text-xl font-bold border border-blue-400 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 w-72"
                  />
                  <button onClick={saveRename} disabled={renameLoading}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50">
                    {renameLoading ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setRenaming(false)} className="text-sm text-gray-400 hover:text-gray-700">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group">
                  <h1 className="text-xl font-bold text-gray-900">
                    {bill.display_name || bill.provider_name || bill.original_filename}
                  </h1>
                  {canRename && (
                    <button
                      onClick={() => { setRenameValue(bill.display_name || bill.provider_name || bill.original_filename || ''); setRenaming(true) }}
                      className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-blue-600 transition-opacity px-1.5 py-0.5 rounded border border-transparent hover:border-gray-200"
                      title="Rename bill"
                    >
                      Rename
                    </button>
                  )}
                </div>
              )}
              {(bill.display_name || bill.provider_name) && (
                <p className="mt-0.5 text-xs text-gray-400">{bill.original_filename}</p>
              )}
              <p className="mt-1 text-xs text-gray-400">Uploaded {formatDate(bill.created_at)}</p>
              {extractionLabel && (
                <p className="mt-0.5 text-xs text-gray-400">
                  Extracted by: <span className="font-medium text-gray-600">{extractionLabel}</span>
                  {bill.extraction_model && (
                    <span className="ml-1 text-gray-400">({bill.extraction_model})</span>
                  )}
                  {bill.detected_row_count > 0 && (
                    <span className="ml-2 text-gray-400">
                      · {bill.line_item_count}/{bill.detected_row_count} rows
                    </span>
                  )}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <StatusBadge status={bill.status} />
                <StatusBadge status={bill.funding_status} />
              </div>
              {canReprocess && (
                <button
                  onClick={handleReprocess}
                  disabled={reprocessLoading}
                  className="border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {reprocessLoading ? 'Reprocessing…' : 'Reprocess with Claude'}
                </button>
              )}
              {canRequestFunding && (
                <button onClick={() => runAction('request-funding')} disabled={actionLoading}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {actionLoading ? 'Requesting…' : 'Request Funding'}
                </button>
              )}
              {canActAsFunder && !showRejectForm && (
                <div className="flex gap-2">
                  <button onClick={() => runAction('mark-funded')} disabled={actionLoading}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
                    {actionLoading ? '…' : 'Mark Funded'}
                  </button>
                  <button onClick={() => setShowRejectForm(true)} disabled={actionLoading}
                    className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100 disabled:opacity-50 transition-colors">
                    Reject
                  </button>
                </div>
              )}
            </div>
          </div>

          {showRejectForm && (
            <form onSubmit={e => { e.preventDefault(); runAction('reject-funding', rejectReason ? { reason: rejectReason } : undefined) }}
              className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm font-medium text-red-700 mb-2">Reject this bill?</p>
              <input type="text" value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                placeholder="Reason (optional)"
                className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm bg-white mb-3 focus:outline-none focus:ring-2 focus:ring-red-400" />
              <div className="flex gap-2">
                <button type="submit" disabled={actionLoading}
                  className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors">
                  {actionLoading ? 'Rejecting…' : 'Confirm Reject'}
                </button>
                <button type="button" onClick={() => { setShowRejectForm(false); setRejectReason('') }}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          )}

          {(actionError || reprocessError) && (
            <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
              {actionError || reprocessError}
            </p>
          )}

          {/* Stale/failed extraction banner */}
          {extractionIsStale && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-amber-800">
                  {bill.extraction_status === 'failed'
                    ? 'Extraction failed — no line items were saved.'
                    : `Extraction may be incomplete: ${bill.line_item_count} items found from ~${bill.detected_row_count} detected rows.`}
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  {bill.extraction_method?.startsWith('regex')
                    ? 'Extracted using regex/table parser. Try reprocessing with Claude for higher accuracy.'
                    : 'Try reprocessing with Claude to improve accuracy.'}
                </p>
              </div>
              {canReprocess && (
                <button onClick={handleReprocess} disabled={reprocessLoading}
                  className="shrink-0 text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 disabled:opacity-50">
                  {reprocessLoading ? 'Reprocessing…' : 'Reprocess with Claude'}
                </button>
              )}
            </div>
          )}

          {/* Extraction quality warnings (clean, user-facing only) */}
          {hasExtractionWarnings && !extractionIsStale && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <p className="text-sm font-medium text-amber-800 mb-1">
                Extraction notes ({visibleWarnings.length + lowConfidenceItems.length})
              </p>
              <ul className="text-xs text-amber-700 space-y-0.5 list-disc list-inside">
                {visibleWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {lowConfidenceItems.length > 0 && (
                  <li>{lowConfidenceItems.length} row(s) extracted with low confidence — verify codes and amounts</li>
                )}
              </ul>
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Billed</p>
              <p className="mt-1 text-lg font-semibold text-gray-900 tabular-nums">{formatCurrency(bill.total_billed_amount)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Medicare Allowed</p>
              <p className="mt-1 text-lg font-semibold text-gray-900 tabular-nums">{formatCurrency(bill.total_medicare_amount)}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <p className="text-xs text-green-600 uppercase tracking-wide">Medicare Savings</p>
              <p className="mt-1 text-lg font-semibold text-green-700 tabular-nums">{formatCurrency(bill.total_savings)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Savings %</p>
              <p className="mt-1 text-lg font-semibold text-gray-900 tabular-nums">{formatPercentage(bill.savings_percentage)}</p>
            </div>
          </div>

          {bill.line_item_count > 0 && (
            <div className="mt-4 flex flex-wrap gap-6 text-sm text-gray-500 border-t border-gray-100 pt-4">
              <span>{bill.line_item_count} line items</span>
              <span>{bill.matched_line_item_count} matched to Medicare</span>
              <span>{bill.unmatched_line_item_count} unmatched</span>
              {lowConfidenceItems.length > 0 && (
                <span className="text-amber-600">{lowConfidenceItems.length} low confidence</span>
              )}
              <span>Avg ratio: {formatRatio(bill.average_billing_ratio)}</span>
            </div>
          )}

          {bill.error_message && (
            <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{bill.error_message}</p>
          )}
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Line Items <span className="text-sm font-normal text-gray-400">({bill.line_items.length})</span>
          </h2>
          <LineItemTable items={bill.line_items} />
        </div>
      </main>
    </AppShell>
  )
}
