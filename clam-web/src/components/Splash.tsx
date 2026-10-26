export function Splash() {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash-top">
        <span className="wordmark">
          <span className="wordmark-mark" aria-hidden="true" />
          Clam
        </span>
        <span className="micro">Local edition</span>
      </div>
      <div className="splash-center">
        <p className="micro">Opening shelf</p>
        <div className="splash-line" aria-hidden="true">
          <span />
        </div>
      </div>
      <div className="splash-bottom">
        <span className="micro">Audiobooks</span>
        <span className="micro">On this device</span>
      </div>
    </div>
  )
}
