import type { CSSProperties } from 'react'
import type { Book } from '../types'

interface CoverProps {
  book: Book
  className?: string
}

export function Cover({ book, className = '' }: CoverProps) {
  if (book.coverUrl) {
    return (
      <div
        className={`cover cover--image ${className}`}
        style={{ '--cover-aspect': book.coverAspect || 1 } as CSSProperties}
      >
        <img src={book.coverUrl} alt="" />
      </div>
    )
  }
  return (
    <div className={`cover ${className}`} style={{ '--ribbon': book.ribbon } as CSSProperties}>
      <p className="cover-series">{book.coverBig}</p>
      <p className="cover-title">{book.coverSmall}</p>
    </div>
  )
}
