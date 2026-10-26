(function () {
  try {
    var stored = localStorage.getItem('clam:theme')
    var theme =
      stored === 'paper' || stored === 'sepia' || stored === 'night'
        ? stored
        : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'night'
          : 'paper'
    var colors = { paper: '#fafafa', sepia: '#f3ead8', night: '#101012' }
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme === 'night' ? 'dark' : 'light'
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', colors[theme])
  } catch (error) {}
})()
