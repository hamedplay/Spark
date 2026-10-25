export type MeetingTouchHoldState = { timer: number; startX: number; startY: number; activated: boolean };
export const meetingResizeMouseHolds = new Map<string, () => void>();
export const meetingTouchHoldStates = new Map<string, MeetingTouchHoldState>();
export const meetingResizeTouchHoldStates = new Map<string, MeetingTouchHoldState>();
export const meetingTouchSuppressClickUntil = new Map<string, number>();
export const meetingTouchLastTapAt = new Map<string, number>();
export const meetingTouchSingleTapTimers = new Map<string, number>();
let pinching = false;
let suppressUntil = 0;

export function clearMeetingTouchHold(id: string) {
  const state = meetingTouchHoldStates.get(id);
  if (state) window.clearTimeout(state.timer);
  meetingTouchHoldStates.delete(id);
}
export function clearMeetingResizeTouchHold(id: string) {
  const state = meetingResizeTouchHoldStates.get(id);
  if (state) window.clearTimeout(state.timer);
  meetingResizeTouchHoldStates.delete(id);
}
export function clearCalendarCardTap(id: string) {
  const timer = meetingTouchSingleTapTimers.get(id);
  if (timer) window.clearTimeout(timer);
  meetingTouchSingleTapTimers.delete(id);
  meetingTouchLastTapAt.delete(id);
}
export function beginCalendarPinch() {
  pinching = true;
  // The second finger can land on a different card or an empty cell.
  // Cancel all pending first-finger actions, rather than just its current target.
  for (const id of meetingTouchHoldStates.keys()) clearMeetingTouchHold(id);
  for (const id of meetingResizeTouchHoldStates.keys()) clearMeetingResizeTouchHold(id);
  for (const id of meetingTouchSingleTapTimers.keys()) clearCalendarCardTap(id);
  meetingTouchLastTapAt.clear();
  for (const cleanup of [...meetingResizeMouseHolds.values()]) cleanup();
}
export function endCalendarPinch() {
  if (!pinching) return;
  pinching = false;
  suppressUntil = Date.now() + 500;
}
export const calendarCardActivationBlocked = () => pinching || Date.now() < suppressUntil;
