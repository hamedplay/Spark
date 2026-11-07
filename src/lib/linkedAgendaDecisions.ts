import type { AgendaItem } from '../types';

export interface LinkedAgendaItem extends AgendaItem {
  source_decision_id?: string | null;
}

export interface PickerDecision {
  id: string;
  minute_id: string;
  parent_decision_id: string | null;
  clause_order: number | null;
  title: string;
  description: string | null;
  minute_title: string;
  minute_date: string;
  minute_number: string | null;
  decision_number: string | null;
  status: string;
  progress_percent: number;
  owner_name: string;
  primary_owner_user_id: string | null;
  responsible_unit_name_snapshot: string | null;
}

export function linkedDecisionAgendaTitle(decision: PickerDecision): string {
  const clause = decision.parent_decision_id && decision.clause_order
    ? `بند ${decision.clause_order} / ` : '';
  const decisionLabel = decision.decision_number
    ? `مصوبه شماره ${decision.decision_number}` : 'مصوبه';
  const minuteLabel = decision.minute_number
    ? `صورت‌جلسه شماره ${decision.minute_number}`
    : `صورت‌جلسه «${decision.minute_title}» مورخ ${decision.minute_date}`;
  return `بررسی و پیگیری ${clause}${decisionLabel} از ${minuteLabel} با موضوع ${decision.title}`;
}

export function linkedAgendaSourceId(item: { source_decision_id?: string | null }): string | null {
  return item.source_decision_id || null;
}

export function agendaItemsForSave(items: Array<{
  id?: string; title: string; presenter?: string | null;
  duration_minutes?: number | null; description?: string | null;
  source_decision_id?: string | null;
}>) {
  return items.map(item => ({
    id: item.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)
      ? item.id : crypto.randomUUID(),
    title: item.title,
    presenter: item.presenter ?? null,
    duration_minutes: item.duration_minutes ?? null,
    description: item.description ?? null,
    source_decision_id: item.source_decision_id ?? null,
  }));
}
