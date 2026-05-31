interface StatusBadgeProps {
  status: string
}

const COLOR_MAP: Record<string, string> = {
  // Case statuses
  active:              'bg-green-100 text-green-800',
  bills_uploaded:      'bg-orange-100 text-orange-800',
  provider_review:     'bg-yellow-100 text-yellow-800',
  ready_for_funding:   'bg-blue-100 text-blue-800',
  funder_review:       'bg-indigo-100 text-indigo-800',
  funded:              'bg-purple-100 text-purple-800',
  rejected:            'bg-red-100 text-red-800',
  closed:              'bg-gray-100 text-gray-800',
  reviewing_bills:     'bg-yellow-100 text-yellow-800', // legacy
  // Bill processing statuses
  uploaded:            'bg-gray-100 text-gray-800',
  processing:          'bg-yellow-100 text-yellow-800',
  completed:           'bg-green-100 text-green-800',
  failed:              'bg-red-100 text-red-800',
  review_ready:        'bg-blue-100 text-blue-800',
  // Funding statuses
  not_requested:       'bg-gray-100 text-gray-800',
  funding_requested:   'bg-blue-100 text-blue-800',
  under_review:        'bg-yellow-100 text-yellow-800',
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const colorClass = COLOR_MAP[status] ?? 'bg-gray-100 text-gray-800'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}
