# Clam UI evidence

R2 captures at 390×844. The `before` build is commit `6ffb5bc`; the `after`
build is the current client, same synthetic book and the same local library.

```
<theme>/book-390-before.png     old CLAM wordmark, no cache controls
<theme>/book-390-after.png      new logo, red current chapter, cache controls
paper/play-390-after.png        sleep timer / speed header, red current title
paper/sleep-390-after.png       sleep-timer choices
paper/cache-390-after.png       cached chapters grouped as books
paper/cache-paused-390-after.png
paper/cache-prompt-390-after.png
paper/account-390-after.png     Auto style control
```

The current transcript sentence is ink; surrounding rows are muted grey.

The new sleep, speed and cache-management surfaces have no earlier equivalent;
the Book pair is the direct before/after for the logo and chapter states.

The Shelf capture also shows the `Cache 2` button beside `Arrange`; `sleep-active`
shows the active 15-minute countdown.

Sleep fade and Media Session are behaviour-only captures: the fade is the last
20 seconds of the sleep timer / chapter, and Media Session updates chapter
metadata, position and previous/next actions from the same player state.

`transcript-390-after.png` is HP5 chapter 10 at the Fred/George passage:
565 EPUB sentences, each a separate row, with the current sentence in ink; `transcript-fallback-390-after.png` is a chapter without a subtitle
file, showing the normal book-description placeholder.
