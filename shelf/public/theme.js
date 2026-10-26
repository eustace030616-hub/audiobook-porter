/* Clam theme seam: apply a palette before first paint and from the user menu.
   The only place that writes data-theme, colorScheme, localStorage and the
   browser chrome colour. */
(() => {
  const key = 'clam:theme';
  const allowed = ['paper', 'sepia', 'night'];
  const colors = { paper: '#fafafa', sepia: '#f3ead8', night: '#101012' };
  const root = document.documentElement;

  function apply(theme, { persist = true } = {}) {
    if (!allowed.includes(theme)) return false;
    root.dataset.theme = theme;
    root.style.colorScheme = theme === 'night' ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', colors[theme]);
    if (persist) {
      try { localStorage.setItem(key, theme); } catch {}
    }
    for (const button of document.querySelectorAll('[data-theme-choice]')) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
    }
    return true;
  }

  let initial = 'paper';
  try {
    const stored = localStorage.getItem(key);
    if (allowed.includes(stored)) initial = stored;
  } catch {}

  apply(initial, { persist: false });
  window.ClamTheme = { apply };
})();
