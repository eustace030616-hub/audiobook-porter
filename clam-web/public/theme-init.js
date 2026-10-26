(function () {
  try {
    var stored = localStorage.getItem('clam:theme')
    if (stored === 'paper' || stored === 'sepia' || stored === 'night') {
      document.documentElement.dataset.theme = stored
      document.documentElement.style.colorScheme = stored === 'night' ? 'dark' : 'light'
      var colors = { paper: '#fafafa', sepia: '#f3ead8', night: '#101012' }
      var meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', colors[stored])
    }
  } catch (error) {}
})()
