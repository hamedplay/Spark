import type { DecisionFilterState } from './DecisionFilters';

export const FOLLOWUP_SCOPE_PARAM = 'followup_scope';

/** Match the hub attention counter without carrying unrelated table filters. */
export function getInitialFollowupFilter(search: string): Partial<DecisionFilterState> {
  return new URLSearchParams(search).get(FOLLOWUP_SCOPE_PARAM) === 'required'
    ? { statusFilter: 'active', followupOnly: true }
    : {};
}
