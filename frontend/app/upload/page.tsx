'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/AppShell'
import UploadForm from '@/components/UploadForm'
import { isAuthenticated, getUser } from '@/lib/auth'

function UploadContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const caseIdParam = searchParams.get('caseId')
  const caseId = caseIdParam ? parseInt(caseIdParam, 10) : null
  const user = getUser()

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/login'); return }
    if (user?.role === 'funder') { router.push('/bills'); return }
  }, [router, user?.role])

  if (user?.role === 'funder') return null

  return (
    <main className="p-8">
      <div className="max-w-2xl mx-auto">
        {caseId && (
          <div className="mb-6">
            <Link href={`/cases/${caseId}`} className="text-sm text-blue-600 hover:text-blue-700">
              ← Back to case
            </Link>
          </div>
        )}
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Upload Medical Bill</h1>
        {caseId ? (
          <UploadForm caseId={caseId} userRole={user?.role ?? ''} />
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-500">
              No case selected. Go to a{' '}
              <Link href="/cases" className="text-blue-600 hover:text-blue-700">case page</Link>{' '}
              and click &quot;Upload Bill&quot;.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}

export default function UploadPage() {
  return (
    <AppShell>
      <Suspense>
        <UploadContent />
      </Suspense>
    </AppShell>
  )
}
