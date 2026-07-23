export interface ParticipantStatusEntry {
  status: 'pending' | 'accepted' | 'declined' | 'delegated';
  delegate_to?: string | null;
}
