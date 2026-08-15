'use client';

import { useId, useState } from 'react';

// Design-system spec §13/§19 — FAQ and comparison components need to
// "support assistive technology." Used first for the FAQ sections every
// one of the six service-page blueprints calls for (Sprint 6), and
// available generically wherever a disclosure pattern is needed.

export interface AccordionItem {
  question: string;
  answer: React.ReactNode;
}

export function Accordion({ items, allowMultiple = false }: { items: AccordionItem[]; allowMultiple?: boolean }) {
  const baseId = useId();
  const [openIndexes, setOpenIndexes] = useState<Set<number>>(new Set());

  function toggle(index: number) {
    setOpenIndexes((prev) => {
      const next = allowMultiple ? new Set(prev) : new Set<number>();
      if (prev.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  return (
    <div className="accordion">
      {items.map((item, index) => {
        const isOpen = openIndexes.has(index);
        const buttonId = `${baseId}-btn-${index}`;
        const panelId = `${baseId}-panel-${index}`;
        return (
          <div key={index} className="accordion__item">
            <h3 className="accordion__heading">
              <button
                type="button"
                id={buttonId}
                className="accordion__trigger"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(index)}
              >
                <span>{item.question}</span>
                <span className="accordion__icon" aria-hidden="true">
                  {isOpen ? '−' : '+'}
                </span>
              </button>
            </h3>
            <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!isOpen} className="accordion__panel">
              {item.answer}
            </div>
          </div>
        );
      })}
    </div>
  );
}
