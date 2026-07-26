import React from 'react';
import { MeetingData } from './types';
import { timeToMinutes } from './utils';

export interface OverlapInfo {
  meeting: MeetingData;
  leftPct: number;
  widthPct: number;
  zIndex: number;
  isNested: boolean;
}

export function computeOverlapLayers(mts: MeetingData[]): OverlapInfo[] {
  const withTime = mts.filter(m => m.start_time && m.end_time);
  if (withTime.length === 0) return [];

  const sorted = [...withTime].sort((a, b) => {
    const durA = timeToMinutes(a.end_time) - timeToMinutes(a.start_time);
    const durB = timeToMinutes(b.end_time) - timeToMinutes(b.start_time);
    if (durB !== durA) return durB - durA;
    return timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
  });

  const groups: MeetingData[][] = [];
  for (const m of sorted) {
    const sMin = timeToMinutes(m.start_time);
    const eMin = timeToMinutes(m.end_time);
    let placed = false;
    for (const g of groups) {
      if (g.some(o => sMin < timeToMinutes(o.end_time) && eMin > timeToMinutes(o.start_time))) {
        g.push(m); placed = true; break;
      }
    }
    if (!placed) groups.push([m]);
  }

  const result: OverlapInfo[] = [];

  for (const group of groups) {
    if (group.length === 1) {
      result.push({ meeting: group[0], leftPct: 0, widthPct: 100, zIndex: 10, isNested: false });
      continue;
    }

    const cols: MeetingData[][] = [];
    for (const m of group) {
      const sMin = timeToMinutes(m.start_time);
      const eMin = timeToMinutes(m.end_time);
      let assigned = false;
      for (const col of cols) {
        const lastEnd = timeToMinutes(col[col.length - 1].end_time);
        const fullyContained = sMin >= timeToMinutes(col[0].start_time) && eMin <= timeToMinutes(col[0].end_time);
        if (sMin >= lastEnd || fullyContained) { col.push(m); assigned = true; break; }
      }
      if (!assigned) cols.push([m]);
    }

    const totalCols = cols.length;
    const INSET_PER_LEVEL = totalCols > 1 ? Math.min(28, 70 / totalCols) : 0;

    cols.forEach((col, colIdx) => {
      col.forEach(m => {
        const leftPct = colIdx === 0 ? 0 : colIdx * INSET_PER_LEVEL;
        const widthPct = colIdx === 0
          ? (totalCols === 1 ? 100 : 100 - INSET_PER_LEVEL * 1.2)
          : 100 - leftPct - INSET_PER_LEVEL;
        result.push({ meeting: m, leftPct, widthPct, zIndex: 10 + colIdx * 5, isNested: colIdx > 0 });
      });
    });
  }

  return result;
}
