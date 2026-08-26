export interface SparkLog {
  id: string;
  command_text: string;
  command_type: string;
  status: 'pending' | 'done' | 'failed';
  result_summary: string | null;
  payload: Record<string, any> | null;
  error_message: string | null;
  created_at: string;
}

export interface SparkMeetingPrefill {
  subject?: string;
  location?: string;
  representative?: string;
  phone?: string;
  notes?: string;
  priority?: string;
  startTime?: string;
  endTime?: string;
  dateJy?: number;
  dateJm?: number;
  dateJd?: number;
  participantNames?: string[];
}

export interface SparkCalendarMeetingPrefill {
  subject?: string;
  location?: string;
  representative?: string;
  phone?: string;
  notes?: string;
  priority?: string;
  startTime?: string;
  endTime?: string;
  dateJy?: number;
  dateJm?: number;
  dateJd?: number;
  participantNames?: string[];
}

export interface SparkAssistantProps {
  currentUserId: string;
  onNavigate: (page: string) => void;
  onSetCalendarView?: (view: string) => void;
  onNewLogEntry?: (log: SparkLog) => void;
  onOpenMeetingForm?: (prefill: SparkMeetingPrefill) => void;
  onOpenCalendarMeetingForm?: (prefill: SparkCalendarMeetingPrefill) => void;
  onNavigateToDate?: (jy: number, jm: number, jd: number, view?: string) => void;
  externalCommand?: string | null;
  onExternalCommandConsumed?: () => void;
}

export interface ParsedCommand {
  type: string;
  confidence: number;
  response?: string;
  autoExecute?: boolean;
  requiresConfirmation: boolean;
  page?: string;
  calendarView?: string;
  calendarDate?: string;
  subject?: string;
  representative?: string;
  phone?: string;
  location?: string;
  priority?: 'high' | 'medium' | 'low';
  date?: string;
  startTime?: string;
  endTime?: string;
  participantNames?: string[];
  meetingSubjectQuery?: string;
  timeDeltaMinutes?: number;
  targetUser?: string;
  messageBody?: string;
  messageImportance?: 'normal' | 'important' | 'urgent';
  taskTitle?: string;
  taskAssigneeName?: string;
  taskDueDate?: string;
  noteTitle?: string;
  noteContent?: string;
  contactName?: string;
  contactPhone?: string;
  contactOrg?: string;
  contactEmail?: string;
  queryFilter?: string;
  queryDate?: string;
  topic?: string;
  explanation?: string;
  question?: string;
  answer?: string;
}

export interface SparkMessage {
  id: string;
  role: 'spark' | 'user';
  text: string;
  status?: 'pending' | 'done' | 'failed' | 'executing' | 'waiting_confirm';
  pendingCommand?: ParsedCommand | null;
}

export interface SparkMemory {
  key: string;
  value: string;
}
