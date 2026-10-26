#!/usr/bin/env bash
# Resume the one-time Harry Potter transfer and finish the shelf move.
#
# The Pi's Wi-Fi drops, so this waits for it, resumes with --append, verifies
# SHA-256, then moves the book out of staging into the live shelf. It can be run
# again safely; an existing complete staging file is verified immediately.
set -uo pipefail

SOURCE="$HOME/Desktop/Harry Potter und der Orden des Phönix.m4b"
HOST="eustace@berry"
STAGE_DIR="/home/eustace/shelf/import"
STAGE="$STAGE_DIR/hp.m4b"
FINAL_DIR="/home/eustace/shelf/library/J.K. Rowling/Harry Potter und der Orden des Phönix"
FINAL="$FINAL_DIR/Harry Potter und der Orden des Phönix.m4b"
LOG="/tmp/hp-port.log"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
RSYNC_SSH="ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3"

mkdir -p "$(dirname "$LOG")"
TOTAL=$(stat -f%z "$SOURCE")
LOCAL_SHA=""

log() {
  printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG"
}

log "source: $SOURCE"
log "total:  $TOTAL bytes"

while :; do
  if ! ssh "${SSH_OPTS[@]}" "$HOST" true >/dev/null 2>&1; then
    log "berry offline; waiting 20s"
    sleep 20
    continue
  fi

  REMOTE=$(ssh "${SSH_OPTS[@]}" "$HOST" "stat -c %s '$STAGE' 2>/dev/null || echo 0" 2>/dev/null || echo 0)
  REMOTE=${REMOTE//$'\r'/}
  REMOTE=${REMOTE//$'\n'/}
  if ! [[ "$REMOTE" =~ ^[0-9]+$ ]]; then
    log "could not read staging size ($REMOTE); waiting"
    sleep 20
    continue
  fi

  if (( REMOTE > TOTAL )); then
    log "staging is larger than source ($REMOTE > $TOTAL); removing staging and restarting"
    ssh "${SSH_OPTS[@]}" "$HOST" "rm -f '$STAGE'" >/dev/null 2>&1 || true
    sleep 5
    continue
  fi

  if (( REMOTE == TOTAL )); then
    log "staging size complete: $REMOTE bytes"
    break
  fi

  log "resuming at $REMOTE / $TOTAL ($(( REMOTE * 100 / TOTAL ))%)"
  if rsync -a --append -e "$RSYNC_SSH" "$SOURCE" "$HOST:$STAGE" >>"$LOG" 2>&1; then
    AFTER=$(ssh "${SSH_OPTS[@]}" "$HOST" "stat -c %s '$STAGE' 2>/dev/null || echo 0" 2>/dev/null || echo 0)
    AFTER=${AFTER//$'\r'/}
    AFTER=${AFTER//$'\n'/}
    log "attempt ended at $AFTER / $TOTAL"
    if [[ "$AFTER" =~ ^[0-9]+$ ]] && (( AFTER == TOTAL )); then
      break
    fi
  else
    log "rsync dropped; retrying in 20s"
  fi
  sleep 20
done

log "verifying SHA-256"
LOCAL_SHA=$(shasum -a 256 "$SOURCE" | awk '{print $1}')
REMOTE_SHA=$(ssh "${SSH_OPTS[@]}" "$HOST" "sha256sum '$STAGE' | awk '{print \$1}'" 2>/dev/null | tr -d '\r\n')
if [[ -z "$LOCAL_SHA" || "$LOCAL_SHA" != "$REMOTE_SHA" ]]; then
  log "SHA mismatch (local=${LOCAL_SHA:-?} remote=${REMOTE_SHA:-?}); leaving staging for inspection"
  exit 1
fi
log "SHA verified: $LOCAL_SHA"

log "moving book into the shelf"
if ! ssh "${SSH_OPTS[@]}" "$HOST" "
  set -e
  mkdir -p '$FINAL_DIR'
  mv '$STAGE' '$FINAL'
  mv '$STAGE_DIR/cover.jpg' '$FINAL_DIR/cover.jpg'
  mv '$STAGE_DIR/metadata.json' '$FINAL_DIR/metadata.json'
  rmdir '$STAGE_DIR' 2>/dev/null || true
  ls -lh '$FINAL_DIR'
"; then
  log "move failed; the verified file is still in staging"
  exit 1
fi

log "waiting for Shelf to index the book"
for _ in $(seq 1 30); do
  HEALTH=$(curl -fsS -m 5 http://berry:13378/health 2>/dev/null || true)
  if [[ "$HEALTH" == *'"books":1'* ]]; then
    log "shelf reports: $HEALTH"
    log "done"
    exit 0
  fi
  sleep 2
done

log "book moved, but Shelf has not reported it yet; check on berry"
exit 1
