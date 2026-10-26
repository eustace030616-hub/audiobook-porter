export function NotFound() {
  return (
    <main className="mx-auto max-w-[calc(72rem+32px)] px-4 pt-24">
      <p className="micro">404</p>
      <h1 className="mt-4 text-[clamp(32px,8vw,52px)] font-medium tracking-[-0.04em]">Not found.</h1>
      <p className="mt-4 text-muted"><a href="/shelf">Back to your shelf</a></p>
    </main>
  )
}
