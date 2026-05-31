'use client'

import { useEffect, useState } from 'react'
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
  ready_for_funding: number
  bills_awaiting_funder: number
  total_billed: string
  total_savings: string
  status_counts: Record<string, number>
}

interface Props { user: User }

export default function LawFirmDashboard({ user }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [cases, setCases] = useState<PatientCase[]>([])

  useEffect(() => {
    api.get<{ data: Summary }>('/api/dashboard/summary').then(r => setSummary(r.data)).catch(() => {})
    api.get<{ data: PatientCase[] }>('/api/cases').then(r => setCases(r.data.slice(0, 5))).catch(() => {})
  }, [])

  return (
    <main className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Case Management Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Welcome back, {user.organization_name || user.email}
        </p>
      </div>

      {/* Alerts */}
      {summary && (summary.bills_awaiting_funder ?? 0) > 0 && (
        <div className="mb-6 rounded-xl border bg-blue-50 border-blue-200 p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-800">
              {summary.bills_awaiting_funder} bill{summary.bills_awaiting_funder !== 1 ? 's' : ''} sent to funder
            </p>
            <p className="text-xs text-blue-600 mt-0.5">Waiting for funder review</p>
          </div>
          <Link href="/bills" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            View Bills →
          </Link>
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <MetricCard label="Total Cases"         value={summary ? String(summary.total_cases) : '—'} />
        <MetricCard label="Active Cases"        value={summary ? String(summary.active_cases ?? 0) : '—'} />
        <MetricCard label="Ready for Funding"   value={summary ? String(summary.ready_for_funding ?? 0) : '—'} />
        <MetricCard label="Total Savings"       value={summary ? formatCurrency(summary.total_savings) : '—'} />
      </div>

      {/* Recent Cases */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Recent Cases</h2>
          <Link href="/cases" className="text-xs text-blue-600 hover:text-blue-700">View all →</Link>
        </div>
        {cases.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-gray-400">No cases yet.</p>
            <Link href="/cases" className="mt-2 inline-block text-sm text-blue-600 hover:text-blue-700">
              Create your first case →
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Case #</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Patient</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Status</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Billed</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Created</th>
              </tr>
            </thead>
            <tbody>
              {cases.map(c => (
                <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <Link href={`/cases/${c.id}`} className="text-blue-600 hover:text-blue-700 font-medium">
                      {c.case_number}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-900">{c.patient_name}</td>
                  <td className="px-5 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-700">{formatCurrency(c.total_billed_amount)}</td>
                  <td className="px-5 py-3 text-gray-500">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex gap-3">
        <Link href="/cases"       className="text-sm text-blue-600 hover:text-blue-700 font-medium">All cases →</Link>
        <Link href="/assignments" className="text-sm text-blue-600 hover:text-blue-700 font-medium">Manage assignments →</Link>
      </div>
    </main>
  )
}
