export interface MeetingFormPrefillData {
  subject?: string;
  location?: string;
  representative?: string;
  phone?: string;
  notes?: string;
  priority?: string;

  meetingId?: string;

  startTime?: string;
  endTime?: string;

  dateJy?: number;
  dateJm?: number;
  dateJd?: number;

  participantUserIds?: string[];

  requestJalaaliDate?: string;
}
