// Thilos Fork: Zielkarte oben an jeder Übung (thilo/docs/2026-11-10-progression-push.md). Das Modell
// kommt aus lib/thilo-target.js targetCard; ein Tipp öffnet wie die alte Hinweiszeile die Übungseinstellungen.
import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'

const ICON = { up: 'arrowUp', down: 'arrowDown', hold: 'chartLine' }

export default function ThiloTargetCard({ model, onOpen }) {
  if (!model) return null
  return <button type="button" className={'thilo-target ' + model.tone} data-testid="thilo-target"
    onClick={onOpen} disabled={!onOpen} aria-label={t(...model.head)}>
    <Icon name={ICON[model.tone] || 'chartLine'} />
    <span className="thilo-target-body">
      <span className="thilo-target-head">{t(...model.head)}</span>
      {model.sub && <span className="thilo-target-sub">{t(...model.sub)}</span>}
      {model.extra && <span className="thilo-target-sub">{t(...model.extra)}</span>}
      {model.last && <span className="thilo-target-last">{t('Last time: {0}', model.last)}</span>}
    </span>
  </button>
}
