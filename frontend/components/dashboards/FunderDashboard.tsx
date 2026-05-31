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
  ready_for_funding: number
  pending_review: number
  total_billed: string
  total_medicare: string
  total_savings: string
}

interface Props { user: User }

export default function FunderDashboard({ user }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [cases, setCases] = useState<PatientCase[]>([])

  useEffect(() => {
    api.get<{ data: Summary }>('/api/dashboard/summary').then(r => setSummary(r.data)).catch(() => {})
    api.get<{ data: PatientCase[] }>('/api/cases').then(r => setCases(r.data.slice(0, 5))).catch(() => {})
  }, [])

  const pendingCount = summary?.pending_review ?? 0

  return (
    <main className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Funding Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Welcome back, {user.organization_name || user.email}
        </p>
      </div>

      {/* Queue alert */}
      <div className={`mb-6 rounded-xl border p-5 flex items-center justify-between ${
        pendingCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'
      }`}>
        <div>
          <p className={`text-sm font-semibold ${pendingCount > 0 ? 'text-amber-800' : 'text-gray-600'}`}>
            {pendingCount > 0
              ? `${pendingCount} bill${pendingCount !== 1 ? 's' : ''} awaiting your review`
              : 'No bills pending review'}
          </p>
          {pendingCount > 0 && (
            <p className="text-xs text-amber-600 mt-0.5">Review bills on your assigned cases</p>
          )}
        </div>
        {pendingCount > 0 && (
          <Link href="/bills" className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors whitespace-nowrap">
            Review Queue →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <MetricCard label="Assigned Cases"   value={summary ? String(summary.total_cases) : '—'} />
        <MetricCard label="Ready for Funding" value={summary ? String(summary.ready_for_funding ?? 0) : '—'} />
        <MetricCard label="Total Billed"     value={summary ? formatCurrency(summary.total_billed) : '—'} />
        <MetricCard label="Total Savings"    value={summary ? formatCurrency(summary.total_savings) : '—'} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">My Assigned Cases</h2>
          <Link href="/cases" className="text-xs text-blue-600 hover:text-blue-700">View all →</Link>
        </div>
        {cases.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-gray-400">No cases have been assigned to your funding queue yet.</p>
            <p className="text-xs text-gray-400 mt-1">Contact your law firm partner to get started.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Case #</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Patient</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Status</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Billed</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500">Savings</th>
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
                  <td className="px-5 py-3 text-right tabular-nums text-green-700">{formatCurrency(c.total_savings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}
