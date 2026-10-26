import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'

interface LoginProps {
  onSignedIn: (username: string) => void
}

export function Login({ onSignedIn }: LoginProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError('')
    try {
      const result = await api.login(username.trim(), password)
      onSignedIn(result.username || username.trim())
    } catch (cause) {
      if (cause instanceof ApiError) setError(cause.message)
      else setError('Flowwing identity is unavailable. Try again.')
      setPending(false)
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-[calc(34rem+32px)] px-4">
      <div className="pt-[calc(env(safe-area-inset-top)+8px)] pb-2">
        <header className="flex items-baseline justify-between gap-4 border-b-2 border-rule pb-2">
          <span className="wordmark">
            <span className="wordmark-mark" aria-hidden="true" />
            Clam
          </span>
        </header>
      </div>
      <main className="py-16 max-[680px]:py-8">
        <p className="micro">Flowwing identity</p>
        <h1 className="mt-4 max-w-[10ch] text-[clamp(40px,12vw,64px)] font-medium leading-[0.94] tracking-[-0.04em]">
          Listen.
        </h1>
        <p className="mt-6 max-w-[32ch] text-muted">
          Use your Flowwing account. The same username and password work in Bookreader.
        </p>
        {error ? <p className="micro mt-6 max-w-[32ch] text-accent" role="alert">{error}</p> : null}
        <form className="mt-12" onSubmit={submit}>
          <div className="grid min-h-[52px] grid-cols-[5rem_1fr] items-center gap-4 border-b border-hair focus-within:border-rule max-[680px]:grid-cols-1 max-[680px]:gap-1 max-[680px]:pt-2">
            <label className="text-micro uppercase tracking-[0.12em] text-muted" htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={64}
              required
              autoFocus
              className="min-h-11 w-full border-0 bg-transparent py-2 text-body outline-none"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="grid min-h-[52px] grid-cols-[5rem_1fr] items-center gap-4 border-b border-hair focus-within:border-rule max-[680px]:grid-cols-1 max-[680px]:gap-1 max-[680px]:pt-2">
            <label className="text-micro uppercase tracking-[0.12em] text-muted" htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={200}
              required
              className="min-h-11 w-full border-0 bg-transparent py-2 text-body outline-none"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="flex justify-start pt-6">
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 border border-rule bg-ink px-6 py-3 text-small uppercase tracking-[0.06em] text-paper active:bg-paper active:text-ink disabled:opacity-60"
            >
              {pending ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
        <p className="micro mt-6">One Flowwing login for Clam and Bookreader.</p>
      </main>
    </div>
  )
}
