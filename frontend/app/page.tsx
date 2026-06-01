// Root route is redirected to /login via next.config.ts redirects().
// This component is only reached if the redirect is bypassed (should not happen).
export default function Home() {
  return null
}
