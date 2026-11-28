"use client";

import { useEffect } from "react";

/**
 * On phones every .data-table stacks into cards (see globals.css). Each cell then needs its column name,
 * so this copies the header text onto data-label once per cell, and again whenever rows change.
 */
export function TableLabels() {
  useEffect(() => {
    let frame = 0;
    const label = () => {
      frame = 0;
      for (const table of document.querySelectorAll<HTMLTableElement>("table.data-table:not([data-scroll])")) {
        const head = table.tHead?.rows[table.tHead.rows.length - 1];
        if (!head) continue;
        const names: string[] = [];
        for (const th of head.cells) for (let i = 0; i < th.colSpan; i++) names.push(th.textContent?.trim() ?? "");
        for (const body of [...table.tBodies, ...(table.tFoot ? [table.tFoot] : [])]) {
          for (const row of body.rows) {
            let col = 0;
            for (const cell of row.cells) {
              const name = cell.colSpan === 1 ? names[col] : "";
              if (name && cell.dataset.label !== name) cell.dataset.label = name;
              col += cell.colSpan;
            }
          }
        }
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(label);
    };
    schedule();
    const obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => {
      obs.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
