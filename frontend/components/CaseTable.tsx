import Link from 'next/link'
import StatusBadge from '@/components/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { PatientCase } from '@/types/cases'

interface CaseTableProps {
  cases: PatientCase[]
}

export default function CaseTable({ cases }: CaseTableProps) {
  if (cases.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <p className="text-sm text-gray-400">No cases yet. Create one to get started.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="text-left px-4 py-3 font-medium text-gray-600">Case #</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Patient</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Total Billed</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Medicare Value</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Savings</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3">
                <Link
                  href={`/cases/${c.id}`}
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  {c.case_number}
                </Link>
              </td>
              <td className="px-4 py-3 text-gray-900">{c.patient_name}</td>
              <td className="px-4 py-3">
                <StatusBadge status={c.status} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                {formatCurrency(c.total_billed_amount)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                {formatCurrency(c.total_medicare_amount)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                {formatCurrency(c.total_savings)}
              </td>
              <td className="px-4 py-3 text-gray-500">{formatDate(c.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
