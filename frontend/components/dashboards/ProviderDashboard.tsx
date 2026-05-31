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
  total_billed: string
  total_savings: string
  my_bills_count: number
  bills_pending_review: number
}

interface Props { user: User }

export default function ProviderDashboard({ user }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [cases, setCases] = useState<PatientCase[]>([])

  useEffect(() => {
    api.get<{ data: Summary }>('/api/dashboard/summary').then(r => setSummary(r.data)).catch(() => {})
    api.get<{ data: PatientCase[] }>('/api/cases').then(r => setCases(r.data.slice(0, 5))).catch(() => {})
  }, [])

  return (
    <main className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Provider Work Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Welcome back, {user.organization_name || user.email}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <MetricCard label="Assigned Cases"     value={summary ? String(summary.total_cases) : '—'} />
        <MetricCard label="Bills Uploaded"     value={summary ? String(summary.my_bills_count ?? 0) : '—'} />
        <MetricCard label="Pending Review"     value={summary ? String(summary.bills_pending_review ?? 0) : '—'} />
        <MetricCard label="Total Billed"       value={summary ? formatCurrency(summary.total_billed) : '—'} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">My Assigned Cases</h2>
          <Link href="/cases" className="text-xs text-blue-600 hover:text-blue-700">View all →</Link>
        </div>
        {cases.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-gray-400">You haven&apos;t been assigned to any cases yet.</p>
            <p className="text-xs text-gray-400 mt-1">Your law firm partner will assign cases when bills are ready for review.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Case #</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Patient</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Status</th>
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
                  <td className="px-5 py-3 text-gray-500">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex gap-3">
        <Link href="/cases"  className="text-sm text-blue-600 hover:text-blue-700 font-medium">All assigned cases →</Link>
        <Link href="/bills"  className="text-sm text-blue-600 hover:text-blue-700 font-medium">View bills →</Link>
        <Link href="/upload" className="text-sm text-blue-600 hover:text-blue-700 font-medium">Upload a bill →</Link>
      </div>
    </main>
  )
}
