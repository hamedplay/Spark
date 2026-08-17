import type { DraftInternalParticipant } from '../components/Minutes/Form/types';
import type { ApprovalMode } from '../components/Minutes/types';

export interface SystemApproverCandidate {
  id: string;
  userId: string;
  nameSnapshot: string;
}

export function resolveEligibleSystemApprovers(
  internalParticipants: DraftInternalParticipant[],
): SystemApproverCandidate[] {
  return internalParticipants
    .filter(p => !!p.userId)
    .map(p => ({ id: p.id, userId: p.userId, nameSnapshot: p.nameSnapshot }));
}

export function shouldCreateApproverRows(approvalMode: ApprovalMode | ''): boolean {
  return approvalMode === 'system';
}

export interface ApproverEligibilityCheck {
  canSubmit: boolean;
  errorMessage: string | null;
}

export function checkSystemApproverEligibility(
  approvalMode: ApprovalMode | '',
  internalParticipants: DraftInternalParticipant[],
): ApproverEligibilityCheck {
  if (approvalMode !== 'system') {
    return { canSubmit: true, errorMessage: null };
  }
  const eligible = resolveEligibleSystemApprovers(internalParticipants);
  if (eligible.length === 0) {
    return {
      canSubmit: false,
      errorMessage: 'در مدل سیستمی حداقل یک شرکت‌کننده داخلی با حساب کاربری لازم است.',
    };
  }
  return { canSubmit: true, errorMessage: null };
}
