'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Navbar from '@/components/Navbar'
import UploadForm from '@/components/UploadForm'

function UploadContent() {
  const searchParams = useSearchParams()
  const caseIdParam = searchParams.get('caseId')
  const caseId = caseIdParam ? parseInt(caseIdParam, 10) : null

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-2xl mx-auto">
          {caseId && (
            <div className="mb-6">
              <Link
                href={`/cases/${caseId}`}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                ← Back to case
              </Link>
            </div>
          )}
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Upload Medical Bill</h1>
          {caseId ? (
            <UploadForm caseId={caseId} />
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-500">
                No case selected. Go to a{' '}
                <Link href="/cases" className="text-blue-600 hover:text-blue-700">
                  case page
                </Link>{' '}
                and click &quot;Upload Bill&quot;.
              </p>
            </div>
          )}
        </div>
      </main>
    </>
  )
}

export default function UploadPage() {
  return (
    <Suspense>
      <UploadContent />
    </Suspense>
  )
}
