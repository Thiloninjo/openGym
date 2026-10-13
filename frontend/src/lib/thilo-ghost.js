// Thilos Fork: Ausblende-Animation für Menüs. React nimmt ein geschlossenes Menü sofort aus dem
// DOM, die App-Logik bleibt also unverändert. Davor legen wir eine Kopie des Menüs in eine eigene
// Ebene, lassen sie hinausgleiten (thilo-motion.css .og-ghost / .closing) und räumen sie weg.
export function leaveGhost(el) {
  if (!el || typeof document === 'undefined' || !document.body) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const sheet = el.querySelector('.sheet')
  // Per Wischen geschlossen: das Menü ist schon hinausgeglitten.
  if (sheet && sheet.style.transform && sheet.style.transform !== 'translateY(0px)') return
  const layer = document.createElement('div')
  layer.className = 'og-ghost'
  layer.setAttribute('aria-hidden', 'true')
  const copy = el.cloneNode(true)
  layer.appendChild(copy)
  document.body.appendChild(layer)
  const copySheet = copy.querySelector('.sheet')
  if (sheet && copySheet) copySheet.scrollTop = sheet.scrollTop
  void layer.offsetHeight
  for (const n of copy.querySelectorAll('.mback, .sheet, .center')) n.classList.add('closing')
  setTimeout(() => layer.remove(), 300)
}
