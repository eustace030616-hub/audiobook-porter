import { createRoot } from 'react-dom/client'
import { NuvioDevShell } from '@nuvio/overlay'
import '@nuvio/overlay/style.css'

export function mountNuvio() {
  const host = document.createElement('div')
  host.id = 'nuvio-dev-root'
  document.body.appendChild(host)
  createRoot(host).render(<NuvioDevShell />)
}
