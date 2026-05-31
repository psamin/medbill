'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Navbar from '@/components/Navbar'
import StatusBadge from '@/components/StatusBadge'
import LineItemTable from '@/components/LineItemTable'
import { isAuthenticated, getUser } from '@/lib/auth'
import { api } from '@/lib/api'
import { formatCurrency, formatPercentage, formatRatio, formatDate } from '@/lib/formatters'
import type { MedicalBill, BillLineItem } from '@/types/billing'
import type { User } from '@/types/auth'

type BillDetail = MedicalBill & { line_items: BillLineItem[] }

interface BillDetailResponse { success: boolean; data: BillDetail }
interface BillResponse      { success: boolean; data: MedicalBill }

interface Props {
  params: Promise<{ billId: string }>
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

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/login'); return }
    setUser(getUser())
    api.get<BillDetailResponse>(`/api/bills/${billId}`)
      .then((res) => setBill(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load bill'))
      .finally(() => setLoading(false))
  }, [billId, router])

  async function runAction(endpoint: string, body?: Record<string, string>) {
    setActionLoading(true)
    setActionError('')
    try {
      const res = await api.post<BillResponse>(`/api/bills/${billId}/${endpoint}`, body)
      setBill((prev) => prev ? { ...res.data, line_items: prev.line_items } : null)
      setShowRejectForm(false)
      setRejectReason('')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault()
    await runAction('reject-funding', rejectReason ? { reason: rejectReason } : undefined)
  }

  if (loading) return (
    <><Navbar /><main className="min-h-screen bg-gray-50 p-8">
      <div className="text-sm text-gray-400 text-center py-12">Loading…</div>
    </main></>
  )

  if (error || !bill) return (
    <><Navbar /><main className="min-h-screen bg-gray-50 p-8">
      <p className="text-sm text-red-600">{error || 'Bill not found'}</p>
    </main></>
  )

  const isLawFirm = user?.role === 'law_firm'
  const isFunder  = user?.role === 'funder' || user?.role === 'admin'
  const canRequestFunding = isLawFirm && bill.status === 'completed' && bill.funding_status === 'not_requested'
  const canActAsFunder    = isFunder && ['funding_requested', 'under_review'].includes(bill.funding_status)

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">

          <div className="mb-6">
            <Link href={`/cases/${bill.case_id}`} className="text-sm text-blue-600 hover:text-blue-700">
              ← Case
            </Link>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            {/* Header row */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  {bill.provider_name || bill.original_filename}
                </h1>
                {bill.provider_name && (
                  <p className="mt-0.5 text-xs text-gray-400">{bill.original_filename}</p>
                )}
                <p className="mt-1 text-xs text-gray-400">Uploaded {formatDate(bill.created_at)}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  <StatusBadge status={bill.status} />
                  <StatusBadge status={bill.funding_status} />
                </div>

                {/* Law firm: request funding */}
                {canRequestFunding && (
                  <button
                    onClick={() => runAction('request-funding')}
                    disabled={actionLoading}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {actionLoading ? 'Requesting…' : 'Request Funding'}
                  </button>
                )}

                {/* Funder: approve or reject */}
                {canActAsFunder && !showRejectForm && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => runAction('mark-funded')}
                      disabled={actionLoading}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      {actionLoading ? '…' : 'Mark Funded'}
                    </button>
                    <button
                      onClick={() => setShowRejectForm(true)}
                      disabled={actionLoading}
                      className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100 disabled:opacity-50 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Reject form */}
            {showRejectForm && (
              <form onSubmit={handleReject} className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm font-medium text-red-700 mb-2">Reject this bill?</p>
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Reason (optional)"
                  className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white mb-3"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {actionLoading ? 'Rejecting…' : 'Confirm Reject'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowRejectForm(false); setRejectReason('') }}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {actionError && (
              <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
                {actionError}
              </p>
            )}

            {/* Money metrics */}
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Total Billed</p>
                <p className="mt-1 text-lg font-semibold text-gray-900 tabular-nums">
                  {formatCurrency(bill.total_billed_amount)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Medicare Value</p>
                <p className="mt-1 text-lg font-semibold text-gray-900 tabular-nums">
                  {formatCurrency(bill.total_medicare_amount)}
                </p>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <p className="text-xs text-green-600 uppercase tracking-wide">Savings</p>
                <p className="mt-1 text-lg font-semibold text-green-700 tabular-nums">
                  {formatCurrency(bill.total_savings)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Savings %</p>
                <p className="mt-1 text-lg font-semibold text-gray-900 tabular-nums">
                  {formatPercentage(bill.savings_percentage)}
                </p>
              </div>
            </div>

            {/* Line item stats */}
            {bill.line_item_count > 0 && (
              <div className="mt-4 flex flex-wrap gap-6 text-sm text-gray-500 border-t border-gray-100 pt-4">
                <span>{bill.line_item_count} line items</span>
                <span>{bill.matched_line_item_count} matched</span>
                <span>{bill.unmatched_line_item_count} unmatched</span>
                <span>Avg ratio: {formatRatio(bill.average_billing_ratio)}</span>
              </div>
            )}

            {bill.error_message && (
              <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
                {bill.error_message}
              </p>
            )}
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Line Items{' '}
              <span className="text-sm font-normal text-gray-400">({bill.line_items.length})</span>
            </h2>
            <LineItemTable items={bill.line_items} />
          </div>

        </div>
      </main>
    </>
  )
}
