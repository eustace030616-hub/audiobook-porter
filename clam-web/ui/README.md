# Clam UI evidence

R2 captures at 390×844. The `before` build is commit `2ebe983`, the first
build before the book-detail folding; the `after` build is the current client.
All captures use the same synthetic book and the long fixture description.

```
<theme>/book-390-before.png     full description, full chapter list
<theme>/book-390-after.png      two-line description + folded chapters
paper/book-chapters-expanded-390-after.png
paper/play-390-after.png        sleep timer / speed header, red current title
paper/sleep-390-after.png       sleep-timer choices
paper/cache-390-after.png       cached chapters grouped as books
paper/cache-paused-390-after.png
paper/cache-prompt-390-after.png
paper/shelf-cache-390-after.png
paper/account-390-after.png     Auto style control
paper/transcript-390-after.png  sentence transcript, current sentence in ink
paper/transcript-fallback-390-after.png
night/transcript-390-after.png
```

The current transcript sentence is ink and is anchored around 70% of the
visible transcript height. Each row has a small timestamp button at the left;
only that button seeks. The `Transcript` / `Cover` control is at the left end of
the chapter row, with the chapter list at the right end.

`transcript-70-390-after.png` is the current 70%-anchored transcript at
19:07, with the timestamp hit target contained inside its row.

`transcript-word-390-after.png` shows the thin translation banner for
"Mitglieder": `das Mitglied` on the left, `member` on the right, and the
saved-word star at the end. The banner is persistent and sits above the
Transcript/Cover and chapter-list row.
