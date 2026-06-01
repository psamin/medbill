'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { isAuthenticated, getUser } from '@/lib/auth'
import { api } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { FundingBatch } from '@/types/billing'
import type { User } from '@/types/auth'

interface BatchListResponse { success: boolean; data: FundingBatch[] }

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  funder_review: 'Under Review',
  partially_funded: 'Partially Funded',
  funded: 'Funded',
  rejected: 'Rejected',
  closed: 'Closed',
}
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  submitted: 'bg-blue-100 text-blue-700',
  funder_review: 'bg-amber-100 text-amber-700',
  partially_funded: 'bg-purple-100 text-purple-700',
  funded: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  closed: 'bg-gray-100 text-gray-500',
}

export default function FundingBatchesPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [batches, setBatches] = useState<FundingBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/login'); return }
    setUser(getUser())
    api.get<BatchListResponse>('/api/funding-batches')
      .then(r => setBatches(r.data))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load batches'))
      .finally(() => setLoading(false))
  }, [router])

  const filtered = statusFilter === 'all' ? batches : batches.filter(b => b.status === statusFilter)
  const pendingCount = batches.filter(b => ['submitted', 'funder_review'].includes(b.status)).length
  const isFunder    = user?.role === 'funder' || user?.role === 'admin'
  const isProvider  = user?.role === 'provider'
  const isLawFirm   = user?.role === 'law_firm' || user?.role === 'admin'
  const showFunderAmount = !isProvider

  return (
    <AppShell>
      <main className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            {isFunder ? 'Batch Queue' : 'Funding Batches'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {isFunder
              ? 'Review and fund submitted batches from your assigned law firms.'
              : 'Bundles of bills submitted together for funder review. Bills are managed inside each case.'}
          </p>
        </div>

        {pendingCount > 0 && isFunder && (
          <div className="mb-5 rounded-xl border bg-amber-50 border-amber-200 p-4 flex items-center gap-3">
            <span className="text-sm font-semibold text-amber-800">
              {pendingCount} batch{pendingCount !== 1 ? 'es' : ''} waiting for your review
            </span>
          </div>
        )}

        {/* Status filter tabs */}
        <div className="flex gap-2 mb-5 flex-wrap">
          {['all', 'draft', 'submitted', 'funder_review', 'partially_funded', 'funded', 'rejected'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === s ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {s === 'all' ? 'All' : STATUS_LABELS[s]}
              {s !== 'all' && (
                <span className="ml-1 opacity-60">({batches.filter(b => b.status === s).length})</span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-sm text-gray-400 text-center py-12">Loading…</div>
        ) : error ? (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-lg">{error}</p>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-sm text-gray-400">
              {statusFilter === 'all' ? 'No funding batches yet.' : `No ${STATUS_LABELS[statusFilter] ?? statusFilter} batches.`}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-left">
                  <th className="px-5 py-3 font-medium text-gray-500">Batch</th>
                  <th className="px-5 py-3 font-medium text-gray-500">Status</th>
                  <th className="px-5 py-3 font-medium text-gray-500">Provider</th>
                  {!isFunder && <th className="px-5 py-3 font-medium text-gray-500">Funder</th>}
                  <th className="px-5 py-3 font-medium text-gray-500 text-right">Medicare Benchmark</th>
                  {showFunderAmount
                    ? <th className="px-5 py-3 font-medium text-gray-500 text-right">Funder Funding</th>
                    : <th className="px-5 py-3 font-medium text-gray-500 text-right">Provider Payout</th>
                  }
                  {isLawFirm && (
                    <th className="px-5 py-3 font-medium text-gray-500 text-right">LF Spread</th>
                  )}
                  <th className="px-5 py-3 font-medium text-gray-500">Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(batch => (
                  <tr
                    key={batch.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/funding-batches/${batch.id}`)}
                  >
                    <td className="px-5 py-3">
                      <span className="font-medium text-blue-700">
                        {batch.batch_name || `Batch #${batch.id}`}
                      </span>
                      <span className="ml-2 text-xs text-gray-400">{batch.item_count} items</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[batch.status] ?? STATUS_COLORS.draft}`}>
                        {STATUS_LABELS[batch.status] ?? batch.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-600 text-sm">{batch.provider_org ?? '—'}</td>
                    {!isFunder && <td className="px-5 py-3 text-gray-600 text-sm">{batch.assigned_funder_org ?? <span className="italic text-gray-400">Unassigned</span>}</td>}
                    <td className="px-5 py-3 text-right tabular-nums">{formatCurrency(batch.total_medicare_amount)}</td>
                    {showFunderAmount
                      ? <td className="px-5 py-3 text-right tabular-nums text-blue-700 font-medium">{formatCurrency(batch.total_funder_funding_amount)}</td>
                      : <td className="px-5 py-3 text-right tabular-nums text-blue-700 font-medium">{formatCurrency(batch.total_provider_negotiated_payout)}</td>
                    }
                    {isLawFirm && (
                      <td className="px-5 py-3 text-right tabular-nums text-green-700">{formatCurrency(batch.total_law_firm_spread_amount)}</td>
                    )}
                    <td className="px-5 py-3 text-gray-400 text-xs">{formatDate(batch.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </AppShell>
  )
}
