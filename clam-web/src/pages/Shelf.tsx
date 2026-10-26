import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { Book, Library, Shelf as ShelfType } from '../types'
import { api } from '../api'
import { navigate } from '../lib/router'
import { useChapterCache } from '../chapter-cache'
import { bookPercent } from '../lib/progress'
import { Cover } from '../components/Cover'
import { Sheet } from '../components/Sheet'

interface ShelfProps {
  library: Library
  onLibrary: (library: Library) => void
  reload: () => Promise<void>
}

interface ShelfEditorState {
  mode: 'new' | 'edit'
  key?: string
  name?: string
}

function shelfLayout(shelves: ShelfType[]): { shelves: string[]; books: Record<string, string[]> } {
  return {
    shelves: shelves.map((shelf) => shelf.key),
    books: Object.fromEntries(shelves.map((shelf) => [shelf.key, shelf.books.map((book) => book.id)])),
  }
}

export function Shelf({ library, onLibrary, reload }: ShelfProps) {
  const cache = useChapterCache()
  const [shelves, setShelves] = useState(library.shelves)
  const [arranging, setArranging] = useState(false)
  const [bookEditor, setBookEditor] = useState<Book | null>(null)
  const [shelfEditor, setShelfEditor] = useState<ShelfEditorState | null>(null)
  const [error, setError] = useState('')
  const container = useRef<HTMLDivElement>(null)
  const flip = useRef<Map<string, DOMRect> | null>(null)

  useEffect(() => setShelves(library.shelves), [library])

  const capture = () => {
    const map = new Map<string, DOMRect>()
    for (const element of container.current?.querySelectorAll<HTMLElement>('[data-flip]') || []) {
      if (element.dataset.flip) map.set(element.dataset.flip, element.getBoundingClientRect())
    }
    flip.current = map
  }

  useLayoutEffect(() => {
    const before = flip.current
    if (!before) return
    flip.current = null
    const frame = window.requestAnimationFrame(() => {
      for (const element of container.current?.querySelectorAll<HTMLElement>('[data-flip]') || []) {
        const old = element.dataset.flip ? before.get(element.dataset.flip) : undefined
        if (!old) continue
        const now = element.getBoundingClientRect()
        const dx = old.left - now.left
        const dy = old.top - now.top
        if (!dx && !dy) continue
        element.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' },
        )
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [shelves])

  async function persist(next: ShelfType[]) {
    const layout = shelfLayout(next)
    try {
      const data = await api.saveLayout(layout.shelves, layout.books)
      onLibrary(data)
    } catch {
      await reload()
    }
  }

  function moveShelf(key: string, direction: number) {
    const index = shelves.findIndex((shelf) => shelf.key === key)
    const target = index + direction
    if (index < 0 || target < 0 || target >= shelves.length) return
    capture()
    const next = [...shelves]
    ;[next[index], next[target]] = [next[target], next[index]]
    setShelves(next)
    void persist(next)
  }

  function moveBook(shelfKey: string, bookId: string, direction: number) {
    const index = shelves.findIndex((shelf) => shelf.key === shelfKey)
    if (index < 0) return
    const bookIndex = shelves[index].books.findIndex((book) => book.id === bookId)
    const target = bookIndex + direction
    if (bookIndex < 0 || target < 0 || target >= shelves[index].books.length) return
    capture()
    const next = shelves.map((shelf) => {
      if (shelf.key !== shelfKey) return shelf
      const books = [...shelf.books]
      ;[books[bookIndex], books[target]] = [books[target], books[bookIndex]]
      return { ...shelf, books }
    })
    setShelves(next)
    void persist(next)
  }

  async function saveBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!bookEditor) return
    const form = event.currentTarget
    const data = new FormData(form)
    const values: Record<string, string> = {}
    for (const [key, value] of data.entries()) values[key] = String(value)
    try {
      await api.updateBook(bookEditor.id, values)
      setBookEditor(null)
      await reload()
    } catch {
      setError('Could not save the book.')
    }
  }

  async function saveShelf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!shelfEditor) return
    const name = String(new FormData(event.currentTarget).get('name') || '').trim()
    if (!name) return
    try {
      if (shelfEditor.mode === 'new') await api.createShelf(name)
      else if (shelfEditor.key) await api.renameShelf(shelfEditor.key, name)
      setShelfEditor(null)
      await reload()
    } catch {
      setError('Could not save the shelf.')
    }
  }

  const sections = shelves.map((shelf, shelfIndex) => (
    <section
      key={shelf.key}
      className={shelfIndex === 0 ? 'mt-8 pt-4' : 'mt-12 border-t-2 border-rule pt-4'}
      data-shelf-key={shelf.key}
      data-flip={`shelf:${shelf.key}`}
    >
      <header className="flex items-baseline justify-between gap-4 pb-4">
        <div className="flex min-w-0 items-baseline gap-4">
          <h2 className="text-[clamp(20px,3vw,28px)] font-medium leading-[1.05] tracking-[-0.025em]">{shelf.name}</h2>
          {arranging ? (
            <button
              type="button"
              className="min-h-11 text-micro uppercase tracking-[0.12em] text-muted underline underline-offset-[3px]"
              onClick={() => setShelfEditor({ mode: 'edit', key: shelf.key, name: shelf.name })}
            >
              Edit
            </button>
          ) : null}
        </div>
        <div className="flex items-baseline gap-4">
          {arranging && shelfIndex > 0 ? (
            <button
              type="button"
              className="grid h-11 w-11 place-items-center border border-hair bg-paper text-ink active:bg-ink active:text-paper"
              aria-label={`Move ${shelf.name} up`}
              onClick={() => moveShelf(shelf.key, -1)}
            >
              ↑
            </button>
          ) : null}
          {arranging && shelfIndex < shelves.length - 1 ? (
            <button
              type="button"
              className="grid h-11 w-11 place-items-center border border-hair bg-paper text-ink active:bg-ink active:text-paper"
              aria-label={`Move ${shelf.name} down`}
              onClick={() => moveShelf(shelf.key, 1)}
            >
              ↓
            </button>
          ) : null}
          <p className="micro">{shelf.books.length} {shelf.books.length === 1 ? 'book' : 'books'}</p>
        </div>
      </header>
      {shelf.books.length ? (
        <div className="shelf-rail">
          {shelf.books.map((book, index) => (
            <article
              key={book.id}
              className="cursor-pointer"
              data-book-id={book.id}
              data-flip={`book:${book.id}`}
              onClick={(event) => {
                if (!arranging) return
                if ((event.target as Element).closest('a, button')) return
                setBookEditor(book)
              }}
            >
              {arranging ? (
                <button
                  type="button"
                  className="block w-full p-0 text-left"
                  aria-label={`Edit ${book.title}`}
                  onClick={() => setBookEditor(book)}
                >
                  <Cover book={book} />
                </button>
              ) : (
                <a className="block no-underline" href={`/book/${book.id}`} aria-label={book.title}>
                  <Cover book={book} />
                </a>
              )}
              <div className="book-progress" aria-hidden="true">
                <span style={{ width: `${bookPercent(book)}%` }} />
              </div>
              <p className="mt-3 text-small font-medium leading-[1.25] tracking-[-0.01em]">{book.title}</p>
              <p className="mt-3 text-small leading-[1.3]">{book.authors.join(', ') || 'Unknown author'}</p>
              <p className="micro mt-1">
                {[book.durationLabel, book.sequence ? `Book ${book.sequence}` : ''].filter(Boolean).join(' · ')}
              </p>
              {arranging && (index > 0 || index < shelf.books.length - 1) ? (
                <div className="mt-2 flex gap-2">
                  {index > 0 ? (
                    <button
                      type="button"
                      className="grid h-11 w-11 place-items-center border border-hair bg-paper text-ink active:bg-ink active:text-paper"
                      aria-label={`Move ${book.title} left`}
                      onClick={() => moveBook(shelf.key, book.id, -1)}
                    >
                      ←
                    </button>
                  ) : null}
                  {index < shelf.books.length - 1 ? (
                    <button
                      type="button"
                      className="grid h-11 w-11 place-items-center border border-hair bg-paper text-ink active:bg-ink active:text-paper"
                      aria-label={`Move ${book.title} right`}
                      onClick={() => moveBook(shelf.key, book.id, 1)}
                    >
                      →
                    </button>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 border-y border-hair py-4 text-muted">No books on this shelf yet. Use Arrange to move one here.</p>
      )}
    </section>
  ))

  return (
    <main className="mx-auto max-w-[calc(72rem+32px)] px-4 pt-8 pb-8" ref={container}>
      <div className="mb-8 border-b-2 border-rule pb-4">
        <a className="inline-block min-h-11 py-2 text-micro uppercase tracking-[0.12em] no-underline" href="/">← Home</a>
        <h1 className="mt-4 text-[clamp(34px,7vw,52px)] font-medium leading-[0.95] tracking-[-0.045em]">Your shelf</h1>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <p className="micro">
            {library.books.length} {library.books.length === 1 ? 'book' : 'books'} · {shelves.length} {shelves.length === 1 ? 'shelf' : 'shelves'}
          </p>
          <div className="flex items-baseline gap-4">
            {arranging ? (
              <button
                type="button"
                className="min-h-11 py-2 text-micro uppercase tracking-[0.12em] text-muted underline underline-offset-[3px]"
                onClick={() => setShelfEditor({ mode: 'new' })}
              >
                New shelf
              </button>
            ) : null}
            <button
              type="button"
              className="min-h-11 py-2 text-micro uppercase tracking-[0.12em] text-muted underline underline-offset-[3px]"
              onClick={() => navigate('/cache')}
            >
              Cache{cache.entries.length ? ` ${cache.entries.length}` : ''}
            </button>
            <button
              type="button"
              className="min-h-11 py-2 text-micro uppercase tracking-[0.12em] text-muted underline underline-offset-[3px]"
              onClick={() => setArranging((value) => !value)}
            >
              {arranging ? 'Done' : 'Arrange'}
            </button>
          </div>
        </div>
      </div>
      {sections.length ? sections : (
        <div className="pt-24">
          <p className="micro">No shelves</p>
          <h1 className="mt-4 text-[clamp(32px,8vw,52px)] font-medium tracking-[-0.04em]">Create your first shelf.</h1>
        </div>
      )}

      <Sheet open={Boolean(bookEditor)} onClose={() => { setBookEditor(null); setError('') }}>
        {bookEditor ? (
          <>
            <header className="dialog-head">
              <h2>Edit book</h2>
              <button type="button" className="min-h-11 text-micro uppercase tracking-[0.12em] text-muted underline underline-offset-[3px]" onClick={() => setBookEditor(null)}>Close</button>
            </header>
            <form className="grid gap-4 px-4 py-4" onSubmit={saveBook}>
              <div className="grid grid-cols-2 gap-4 max-[680px]:grid-cols-1">
                <label className="grid gap-2 text-micro uppercase tracking-[0.1em] text-muted">
                  Title
                  <input name="title" defaultValue={bookEditor.title} maxLength={240} required autoFocus className="min-h-11 w-full border border-hair bg-transparent px-2 text-body normal-case tracking-normal text-ink outline-none" />
                </label>
                <label className="grid gap-2 text-micro uppercase tracking-[0.1em] text-muted">
                  Authors
                  <input name="authors" defaultValue={bookEditor.authors.join(', ')} placeholder="Comma separated" className="min-h-11 w-full border border-hair bg-transparent px-2 text-body normal-case tracking-normal text-ink outline-none" />
                </label>
                <label className="grid gap-2 text-micro uppercase tracking-[0.1em] text-muted">
                  Narrators
                  <input name="narrators" defaultValue={bookEditor.narrator} placeholder="Comma separated" className="min-h-11 w-full border border-hair bg-transparent px-2 text-body normal-case tracking-normal text-ink outline-none" />
                </label>
                <label className="grid gap-2 text-micro uppercase tracking-[0.1em] text-muted">
                  Series
                  <input name="series_title" defaultValue={bookEditor.series} placeholder="Standalone if empty" className="min-h-11 w-full border border-hair bg-transparent px-2 text-body normal-case tracking-normal text-ink outline-none" />
                </label>
                <label className="grid gap-2 text-micro uppercase tracking-[0.1em] text-muted">
                  Sequence
                  <input name="series_sequence" defaultValue={bookEditor.sequence} inputMode="decimal" className="min-h-11 w-full border border-hair bg-transparent px-2 text-body normal-case tracking-normal text-ink outline-none" />
                </label>
                <label className="grid gap-2 text-micro uppercase tracking-[0.1em] text-muted">
                  Shelf
                  <select name="shelfKey" defaultValue={bookEditor.shelfKey} className="min-h-11 w-full border border-hair bg-transparent px-2 text-body normal-case tracking-normal text-ink outline-none">
                    {(shelves.length ? shelves : [{ key: bookEditor.shelfKey, name: bookEditor.shelf }] as ShelfType[]).map((shelf) => (
                      <option key={shelf.key} value={shelf.key}>{shelf.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="grid gap-2 text-micro uppercase tracking-[0.1em] text-muted">
                Description
                <textarea name="description" rows={5} defaultValue={bookEditor.description} className="w-full border border-hair bg-transparent p-2 text-body normal-case tracking-normal text-ink outline-none" />
              </label>
              <p className="micro">Series controls the cover. Shelf controls where the book sits.</p>
              {error ? <p className="micro text-accent" role="alert">{error}</p> : null}
              <div className="flex justify-start pt-2">
                <button type="submit" className="min-h-11 border border-rule bg-ink px-6 py-3 text-small uppercase tracking-[0.06em] text-paper active:bg-paper active:text-ink">Save book</button>
              </div>
            </form>
          </>
        ) : null}
      </Sheet>

      <Sheet open={Boolean(shelfEditor)} onClose={() => { setShelfEditor(null); setError('') }}>
        {shelfEditor ? (
          <>
            <header className="dialog-head">
              <h2>{shelfEditor.mode === 'new' ? 'New shelf' : 'Edit shelf'}</h2>
              <button type="button" className="min-h-11 text-micro uppercase tracking-[0.12em] text-muted underline underline-offset-[3px]" onClick={() => setShelfEditor(null)}>Close</button>
            </header>
            <form className="grid gap-4 px-4 py-4" onSubmit={saveShelf}>
              <label className="sr-only" htmlFor="shelf-name">Shelf name</label>
              <input
                id="shelf-name"
                name="name"
                defaultValue={shelfEditor.name || ''}
                maxLength={80}
                placeholder="Shelf name"
                required
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                className="min-h-11 border-b border-hair bg-transparent py-2 text-body outline-none focus:border-rule"
              />
              <p className="micro">{shelfEditor.mode === 'new' ? 'Creates an empty shelf. Move books into it from Arrange mode.' : 'Changes the shelf label only. Book covers keep their series title.'}</p>
              {error ? <p className="micro text-accent" role="alert">{error}</p> : null}
              <div className="flex justify-start pt-2">
                <button type="submit" className="min-h-11 border border-rule bg-ink px-6 py-3 text-small uppercase tracking-[0.06em] text-paper active:bg-paper active:text-ink">
                  {shelfEditor.mode === 'new' ? 'Create shelf' : 'Save shelf'}
                </button>
              </div>
            </form>
          </>
        ) : null}
      </Sheet>
    </main>
  )
}
