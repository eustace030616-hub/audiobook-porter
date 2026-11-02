import type { ReactNode } from 'react'
import type { Config } from '@puckeditor/core'

type HeroProps = { eyebrow: string; title: string; body: string }
type ShelfProps = { label: string; note: string }
type PlayerProps = { title: string; chapter: string; progress: number }
type TranscriptProps = { title: string; text: string }
type NoteProps = { eyebrow: string; body: string }

const books = [
  { title: 'Der Stein der Weisen', tone: '#18181b', label: '01' },
  { title: 'Die Kammer des Schreckens', tone: '#3b3b40', label: '02' },
  { title: 'Der Gefangene von Askaban', tone: '#5a5a60', label: '03' },
]

function Hero({ eyebrow, title, body }: HeroProps) {
  return (
    <section className="border-b border-hair px-6 py-10">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{eyebrow}</p>
      <h1 className="mt-4 max-w-[12ch] text-[clamp(36px,11vw,58px)] font-medium leading-[0.95] tracking-[-0.045em]">{title}</h1>
      <p className="mt-5 max-w-[30ch] text-[15px] leading-[1.45] text-muted">{body}</p>
    </section>
  )
}

function Shelf({ label, note }: ShelfProps) {
  return (
    <section className="border-b border-hair px-6 py-8">
      <div className="flex items-baseline justify-between border-b border-rule pb-2">
        <h2 className="text-[13px] uppercase tracking-[0.12em]">{label}</h2>
        <span className="text-[11px] text-muted">{note}</span>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3">
        {books.map((book) => (
          <article key={book.label}>
            <div className="aspect-[2/3] p-3 text-paper" style={{ background: book.tone }}>
              <span className="text-[10px] uppercase tracking-[0.14em]">{book.label}</span>
              <p className="mt-10 text-[13px] leading-[1.1]">{book.title}</p>
            </div>
            <p className="mt-2 text-[11px] leading-[1.25] text-muted">{book.title}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function Player({ title, chapter, progress }: PlayerProps) {
  return (
    <section className="bg-player-bg px-6 py-6 text-player-fg">
      <p className="text-[10px] uppercase tracking-[0.14em] opacity-60">Now playing</p>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <p className="text-[17px] leading-[1.15]">{title}</p>
          <p className="mt-1 text-[12px] opacity-60">{chapter}</p>
        </div>
        <span className="text-[28px] leading-none">▶</span>
      </div>
      <div className="mt-6 h-px bg-player-fg/30">
        <div className="h-px bg-player-fg" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
      </div>
    </section>
  )
}

function Transcript({ title, text }: TranscriptProps) {
  return (
    <section className="border-b border-hair px-6 py-8">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{title}</p>
      <p className="mt-4 max-w-[32ch] text-[17px] leading-[1.55]">{text}</p>
      <div className="mt-4 flex items-center gap-3 text-[11px] text-muted">
        <span className="border-b border-hair pb-0.5">12:04</span>
        <span className="border-b border-rule pb-0.5">tap a word</span>
      </div>
    </section>
  )
}

function Note({ eyebrow, body }: NoteProps) {
  return (
    <section className="px-6 py-8">
      <p className="text-[11px] uppercase tracking-[0.14em] text-accent">{eyebrow}</p>
      <p className="mt-3 max-w-[34ch] text-[15px] leading-[1.5]">{body}</p>
    </section>
  )
}

export const studioConfig: Config = {
  components: {
    Hero: {
      fields: {
        eyebrow: { type: 'text' },
        title: { type: 'text' },
        body: { type: 'textarea' },
      },
      defaultProps: {
        eyebrow: 'Clam / Library',
        title: 'Listen slowly.',
        body: 'A quiet shelf for long books. One login, one library, one player.',
      },
      render: (props) => <Hero {...(props as unknown as HeroProps)} />,
    },
    Shelf: {
      fields: {
        label: { type: 'text' },
        note: { type: 'text' },
      },
      defaultProps: { label: 'Harry Potter', note: '7 books' },
      render: (props) => <Shelf {...(props as unknown as ShelfProps)} />,
    },
    Player: {
      fields: {
        title: { type: 'text' },
        chapter: { type: 'text' },
        progress: { type: 'number', min: 0, max: 100 },
      },
      defaultProps: { title: 'Der Stein der Weisen', chapter: 'Chapter 10 · Troll', progress: 38 },
      render: (props) => <Player {...(props as unknown as PlayerProps)} />,
    },
    Transcript: {
      fields: {
        title: { type: 'text' },
        text: { type: 'textarea' },
      },
      defaultProps: {
        title: 'Transcript · Chapter 10',
        text: 'Dumbledores abruptes Verschwinden war nicht weniger rätselhaft als seine Ankunft.',
      },
      render: (props) => <Transcript {...(props as unknown as TranscriptProps)} />,
    },
    Note: {
      fields: {
        eyebrow: { type: 'text' },
        body: { type: 'textarea' },
      },
      defaultProps: {
        eyebrow: 'Design note',
        body: 'Adjust the rhythm here. The player stays dark; the ribbon stays the only colour.',
      },
      render: (props) => <Note {...(props as unknown as NoteProps)} />,
    },
  },
  root: {
    render: ({ children }: { children?: ReactNode }) => <div className="min-h-screen bg-paper text-ink">{children}</div>,
  },
}
