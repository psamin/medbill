interface MetricCardProps {
  label: string
  value: string
  subvalue?: string
}

export default function MetricCard({ label, value, subvalue }: MetricCardProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <p className="text-xs sm:text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-xl sm:text-2xl font-semibold text-gray-900">{value}</p>
      {subvalue && <p className="mt-1 text-xs sm:text-sm text-gray-400">{subvalue}</p>}
    </div>
  )
}
