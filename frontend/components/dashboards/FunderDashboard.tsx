'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import MetricCard from '@/components/MetricCard'
import { api } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { User } from '@/types/auth'
import type { FundingBatch } from '@/types/billing'

interface Summary {
  total_cases: number
  pending_batches: number
  funded_batches: number
  total_medicare: string
}

interface Props { user: User }

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted', funder_review: 'Under Review',
  partially_funded: 'Partially Funded', funded: 'Funded', rejected: 'Rejected',
}
const STATUS_COLORS: Record<string, string> = {
  submitted: 'bg-blue-100 text-blue-700', funder_review: 'bg-amber-100 text-amber-700',
  partially_funded: 'bg-purple-100 text-purple-700',
  funded: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700',
}

export default function FunderDashboard({ user }: Props) {
  const router = useRouter()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [batches, setBatches] = useState<FundingBatch[]>([])

  useEffect(() => {
    api.get<{ data: Summary }>('/api/dashboard/summary').then(r => setSummary(r.data)).catch(() => {})
    api.get<{ data: FundingBatch[] }>('/api/funding-batches').then(r => setBatches(r.data)).catch(() => {})
  }, [])

  const pendingBatches = batches.filter(b => ['submitted', 'funder_review', 'partially_funded'].includes(b.status))
  const fundedBatches  = batches.filter(b => b.status === 'funded')
  const pendingCount   = summary?.pending_batches ?? 0

  const totalFundingExposure = pendingBatches.reduce(
    (sum, b) => sum + parseFloat(b.total_funder_funding_amount || '0'), 0
  )
  const totalFunded = fundedBatches.reduce(
    (sum, b) => sum + parseFloat(b.total_funder_funding_amount || '0'), 0
  )

  return (
    <main className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Funding Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Welcome back, {user.organization_name || user.email}</p>
      </div>

      {/* Pending batch alert */}
      <div className={`mb-6 rounded-xl border p-5 flex items-center justify-between ${
        pendingCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'
      }`}>
        <div>
          <p className={`text-sm font-semibold ${pendingCount > 0 ? 'text-amber-800' : 'text-gray-600'}`}>
            {pendingCount > 0
              ? `${pendingCount} batch${pendingCount !== 1 ? 'es' : ''} waiting for your review`
              : 'No batches pending review'}
          </p>
          <p className={`text-xs mt-0.5 ${pendingCount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
            {pendingCount > 0 ? 'Open each batch to fund or reject' : 'New batches from law firms will appear here'}
          </p>
        </div>
        {pendingCount > 0 && (
          <Link href="/funding-batches" className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 whitespace-nowrap">
            Review Queue →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <MetricCard label="Assigned Cases"    value={summary ? String(summary.total_cases) : '—'} />
        <MetricCard label="Pending Batches"   value={String(pendingCount)} />
        <MetricCard label="Funding Exposure"  value={`$${totalFundingExposure.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
        <MetricCard label="Total Funded"      value={`$${totalFunded.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
      </div>

      {/* Pending batch queue */}
      {pendingBatches.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Pending Review Queue</h2>
            <Link href="/funding-batches" className="text-xs text-blue-600 hover:text-blue-700">View all →</Link>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Batch</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Provider</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Medicare Allowed</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Funder Funding Amount</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {pendingBatches.map(b => (
                <tr key={b.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/funding-batches/${b.id}`)}>
                  <td className="px-5 py-3 font-medium text-blue-700">{b.batch_name || `#${b.id}`}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[b.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABELS[b.status] ?? b.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{b.provider_org ?? '—'}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{formatCurrency(b.total_medicare_amount)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-blue-700 font-medium">{formatCurrency(b.total_funder_funding_amount)}</td>
                  <td className="px-5 py-3 text-xs text-gray-400">{formatDate(b.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Funded batches summary */}
      {fundedBatches.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Funded Batches</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Batch</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Provider</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Funded Amount</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Date</th>
              </tr>
            </thead>
            <tbody>
              {fundedBatches.map(b => (
                <tr key={b.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/funding-batches/${b.id}`)}>
                  <td className="px-5 py-3 font-medium text-blue-700">{b.batch_name || `#${b.id}`}</td>
                  <td className="px-5 py-3 text-gray-600">{b.provider_org ?? '—'}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-green-700 font-medium">{formatCurrency(b.total_funder_funding_amount)}</td>
                  <td className="px-5 py-3 text-xs text-gray-400">{formatDate(b.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
