import type { DraftDecision } from './Form/types';

const PERSIAN_ORDINALS = [
  'اول', 'دوم', 'سوم', 'چهارم', 'پنجم',
  'ششم', 'هفتم', 'هشتم', 'نهم', 'دهم',
] as const;

const faNumber = (value: number) => String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);

export function formatClauseLabel(order: number | null | undefined): string {
  const safeOrder = Math.max(1, order || 1);
  return safeOrder <= PERSIAN_ORDINALS.length
    ? `بند ${PERSIAN_ORDINALS[safeOrder - 1]}`
    : `بند ${faNumber(safeOrder)}`;
}

export function getParentDraftDecisions(decisions: DraftDecision[]): DraftDecision[] {
  return decisions.filter(decision => !decision.parentDecisionId);
}

export function getDraftDecisionClauses(
  decisions: DraftDecision[],
  parentDecisionId: string | null,
): DraftDecision[] {
  if (!parentDecisionId) return [];
  return decisions
    .filter(decision => decision.parentDecisionId === parentDecisionId)
    .sort((a, b) => (a.clauseOrder ?? Number.MAX_SAFE_INTEGER) - (b.clauseOrder ?? Number.MAX_SAFE_INTEGER));
}

export interface HierarchicalDecisionRow {
  id: string;
  parent_decision_id: string | null;
  clause_order: number | null;
}

export function getParentDecisionRows<T extends HierarchicalDecisionRow>(rows: T[]): T[] {
  return rows.filter(row => !row.parent_decision_id);
}

export function getDecisionRowClauses<T extends HierarchicalDecisionRow>(rows: T[], parentId: string): T[] {
  return rows
    .filter(row => row.parent_decision_id === parentId)
    .sort((a, b) => (a.clause_order ?? Number.MAX_SAFE_INTEGER) - (b.clause_order ?? Number.MAX_SAFE_INTEGER));
}
