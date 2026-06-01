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

interface Summary {
  total_cases: number
  active_cases: number
  closed_cases: number
  ready_for_funding: number
  bills_awaiting_funder: number
  bills_uploaded: number
  draft_batches: number
  submitted_batches: number
  funded_batches: number
  total_billed: string
  total_savings: string
  total_law_firm_spread: string
  total_funder_funding: string
  total_provider_payout: string
}

interface Props { user: User }

export default function LawFirmDashboard({ user }: Props) {
  const router = useRouter()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [cases, setCases] = useState<PatientCase[]>([])

  useEffect(() => {
    api.get<{ data: Summary }>('/api/dashboard/summary').then(r => setSummary(r.data)).catch(() => {})
    api.get<{ data: PatientCase[] }>('/api/cases').then(r => setCases(r.data.slice(0, 6))).catch(() => {})
  }, [])

  return (
    <main className="p-4 sm:p-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Case Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Welcome back, {user.organization_name || user.email}</p>
      </div>

      {/* Alert: batches pending */}
      {summary && (summary.submitted_batches ?? 0) > 0 && (
        <div className="mb-4 rounded-xl border bg-blue-50 border-blue-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <p className="text-sm font-semibold text-blue-800">
            {summary.submitted_batches} batch{summary.submitted_batches !== 1 ? 'es' : ''} submitted — awaiting funder
          </p>
          <Link href="/funding-batches" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 text-center">
            View Batches →
          </Link>
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <MetricCard label="Active Cases"    value={summary ? String((summary.total_cases ?? 0) - (summary.closed_cases ?? 0)) : '—'} />
        <MetricCard label="Bills Uploaded"  value={summary ? String(summary.bills_uploaded ?? 0) : '—'} />
        <MetricCard label="Active Batches"  value={summary ? String((summary.draft_batches ?? 0) + (summary.submitted_batches ?? 0)) : '—'} />
        <MetricCard label="Law Firm Spread" value={summary ? formatCurrency(summary.total_law_firm_spread ?? '0') : '—'} />
      </div>

      {/* Financial breakdown — law firm earnings */}
      {summary && parseFloat(summary.total_funder_funding ?? '0') > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Funding Economics</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Funder Funding Amount</p>
              <p className="text-xl font-semibold text-blue-700 tabular-nums">{formatCurrency(summary.total_funder_funding)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Provider Payout</p>
              <p className="text-xl font-semibold text-gray-900 tabular-nums">{formatCurrency(summary.total_provider_payout)}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 border border-green-100">
              <p className="text-xs text-green-600 uppercase tracking-wide mb-1">Law Firm Spread (60%)</p>
              <p className="text-xl font-semibold text-green-700 tabular-nums">{formatCurrency(summary.total_law_firm_spread)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Cases table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Recent Cases</h2>
          <Link href="/cases" className="text-xs text-blue-600 hover:text-blue-700">View all →</Link>
        </div>
        {cases.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-gray-400">No cases yet.</p>
            <Link href="/cases" className="mt-2 inline-block text-sm text-blue-600 hover:text-blue-700">Create your first case →</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Case #</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Patient</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Status</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Total Billed</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Medicare Allowed</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Case Savings</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Created</th>
              </tr>
            </thead>
            <tbody>
              {cases.map(c => (
                <tr key={c.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/cases/${c.id}`)}>
                  <td className="px-5 py-3 font-medium text-blue-700">{c.case_number}</td>
                  <td className="px-5 py-3 text-gray-900">{c.patient_name}</td>
                  <td className="px-5 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-700">{formatCurrency(c.total_billed_amount)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-700">{formatCurrency(c.total_medicare_amount)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-green-700">{formatCurrency(c.total_savings)}</td>
                  <td className="px-5 py-3 text-gray-400 text-xs">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4">
        <Link href="/cases"               className="text-sm text-blue-600 hover:text-blue-700 font-medium">All cases →</Link>
        <Link href="/funding-batches"     className="text-sm text-blue-600 hover:text-blue-700 font-medium">Funding batches →</Link>
        <Link href="/negotiated-cpt-rates" className="text-sm text-blue-600 hover:text-blue-700 font-medium">CPT rates →</Link>
      </div>
    </main>
  )
}
