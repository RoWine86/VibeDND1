// ─── Модальная карточка заклинания ───────────────────────────────────────────
// Открыть полный текст заклинания поверх любой страницы. Использует общий
// блок SpellDetails.

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Spell } from '@vibednd/shared';
import SpellDetails from './SpellDetails';

export default function SpellCard({
  spell,
  classNames,
  onClose,
  footer,
}: {
  spell: Spell;
  classNames?: string[];
  onClose: () => void;
  footer?: ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal spell-card-modal anim-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="spell-card-close" onClick={onClose} aria-label="Закрыть">
          <X size={18} />
        </button>
        <SpellDetails spell={spell} classNames={classNames} />
        {footer && <div className="spell-card-footer">{footer}</div>}
      </div>
    </div>
  );
}
