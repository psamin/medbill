'use client'

import { useRouter } from 'next/navigation'
import StatusBadge from '@/components/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { PatientCase } from '@/types/cases'

interface CaseTableProps {
  cases: PatientCase[]
  userRole?: string
}

const EMPTY: Record<string, string> = {
  law_firm: 'No cases yet. Create your first case to get started.',
  provider: "You haven't been assigned to any cases yet.",
  funder:   'No cases assigned to you yet.',
  admin:    'No cases in the system.',
}

export default function CaseTable({ cases, userRole }: CaseTableProps) {
  const router = useRouter()

  if (cases.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <p className="text-sm text-gray-400">{EMPTY[userRole ?? ''] ?? 'No cases found.'}</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="text-left px-5 py-3 font-medium text-gray-500">Case #</th>
            <th className="text-left px-5 py-3 font-medium text-gray-500">Patient</th>
            <th className="text-left px-5 py-3 font-medium text-gray-500">Status</th>
            <th className="text-right px-5 py-3 font-medium text-gray-500">Total Billed</th>
            <th className="text-right px-5 py-3 font-medium text-gray-500">Medicare Allowed</th>
            {(userRole === 'law_firm' || userRole === 'admin') && (
              <th className="text-right px-5 py-3 font-medium text-gray-500">Case Savings</th>
            )}
            <th className="text-left px-5 py-3 font-medium text-gray-500">Created</th>
          </tr>
        </thead>
        <tbody>
          {cases.map(c => (
            <tr
              key={c.id}
              className="border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
              onClick={() => router.push(`/cases/${c.id}`)}
            >
              <td className="px-5 py-3 font-medium text-blue-700">{c.case_number}</td>
              <td className="px-5 py-3 text-gray-900">{c.patient_name}</td>
              <td className="px-5 py-3"><StatusBadge status={c.status} /></td>
              <td className="px-5 py-3 text-right tabular-nums text-gray-900">{formatCurrency(c.total_billed_amount)}</td>
              <td className="px-5 py-3 text-right tabular-nums text-gray-900">{formatCurrency(c.total_medicare_amount)}</td>
              {(userRole === 'law_firm' || userRole === 'admin') && (
                <td className="px-5 py-3 text-right tabular-nums text-green-700">{formatCurrency(c.total_savings)}</td>
              )}
              <td className="px-5 py-3 text-gray-400 text-xs">{formatDate(c.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
