'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import MetricCard from '@/components/MetricCard'
import StatusBadge from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { User } from '@/types/auth'
import type { PatientCase } from '@/types/cases'
import type { FundingBatch } from '@/types/billing'

interface Summary {
  total_cases: number
  my_bills_count: number
  bills_pending_review: number
  pending_batches: number
  funded_batches: number
  total_provider_payout: string
  total_medicare: string
}

interface Props { user: User }

const BATCH_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', submitted: 'Submitted', funder_review: 'Under Review',
  partially_funded: 'Partially Funded', funded: 'Funded', rejected: 'Rejected',
}
const BATCH_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', submitted: 'bg-blue-100 text-blue-700',
  funder_review: 'bg-amber-100 text-amber-700', partially_funded: 'bg-purple-100 text-purple-700',
  funded: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700',
}

export default function ProviderDashboard({ user }: Props) {
  const router = useRouter()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [cases, setCases] = useState<PatientCase[]>([])
  const [batches, setBatches] = useState<FundingBatch[]>([])

  useEffect(() => {
    api.get<{ data: Summary }>('/api/dashboard/summary').then(r => setSummary(r.data)).catch(() => {})
    api.get<{ data: PatientCase[] }>('/api/cases').then(r => setCases(r.data.slice(0, 5))).catch(() => {})
    api.get<{ data: FundingBatch[] }>('/api/funding-batches').then(r => setBatches(r.data.slice(0, 4))).catch(() => {})
  }, [])

  return (
    <main className="p-4 sm:p-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Provider Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Welcome back, {user.organization_name || user.email}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <MetricCard label="Assigned Cases"       value={summary ? String(summary.total_cases) : '—'} />
        <MetricCard label="Bills Uploaded"       value={summary ? String(summary.my_bills_count ?? 0) : '—'} />
        <MetricCard label="Pending Payment"      value={summary ? String(summary.pending_batches ?? 0) : '—'} />
        <MetricCard label="Total Provider Payout" value={summary ? formatCurrency(summary.total_provider_payout ?? '0') : '—'} />
      </div>

      {/* Assigned cases */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Assigned Cases</h2>
          <Link href="/cases" className="text-xs text-blue-600 hover:text-blue-700">View all →</Link>
        </div>
        {cases.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-gray-400">No cases assigned yet. Your law firm will assign cases when bills are ready.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500">Case #</th>
                <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500">Patient</th>
                <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500">Status</th>
                <th className="text-right px-4 sm:px-5 py-3 font-medium text-gray-500">Medicare</th>
                <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500 hidden sm:table-cell">Created</th>
              </tr>
            </thead>
            <tbody>
              {cases.map(c => (
                <tr key={c.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/cases/${c.id}`)}>
                  <td className="px-4 sm:px-5 py-3 font-medium text-blue-700">{c.case_number}</td>
                  <td className="px-4 sm:px-5 py-3 text-gray-900">{c.patient_name}</td>
                  <td className="px-4 sm:px-5 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 sm:px-5 py-3 text-right tabular-nums">{formatCurrency(c.total_medicare_amount)}</td>
                  <td className="px-4 sm:px-5 py-3 text-xs text-gray-400 hidden sm:table-cell">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Funding batches — no LF spread shown */}
      {batches.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Funding Batches</h2>
            <Link href="/funding-batches" className="text-xs text-blue-600 hover:text-blue-700">View all →</Link>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[400px] text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500">Batch</th>
                <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500">Status</th>
                <th className="text-right px-4 sm:px-5 py-3 font-medium text-gray-500 hidden sm:table-cell">Medicare</th>
                <th className="text-right px-4 sm:px-5 py-3 font-medium text-gray-500">Payout</th>
              </tr>
            </thead>
            <tbody>
              {batches.map(b => (
                <tr key={b.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/funding-batches/${b.id}`)}>
                  <td className="px-4 sm:px-5 py-3 font-medium text-blue-700">{b.batch_name || `#${b.id}`}</td>
                  <td className="px-4 sm:px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${BATCH_STATUS_COLORS[b.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {BATCH_STATUS_LABELS[b.status] ?? b.status}
                    </span>
                  </td>
                  <td className="px-4 sm:px-5 py-3 text-right tabular-nums hidden sm:table-cell">{formatCurrency(b.total_medicare_amount)}</td>
                  <td className="px-4 sm:px-5 py-3 text-right tabular-nums text-gray-700">{formatCurrency(b.total_provider_negotiated_payout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </main>
  )
}
