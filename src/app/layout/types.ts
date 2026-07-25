export type PageId =
  | 'meetings'
  | 'create-meeting'
  | 'tasks'
  | 'reports'
  | 'notes'
  | 'profile'
  | 'contacts'
  | 'contacts_email'
  | 'calendar'
  | 'tutorial'
  | 'admin'
  | 'chat'
  | 'video-conference'
  | 'portal-config'
  | 'spark'
  | 'channels'
  | 'groups'
  | 'minutes'
  | 'minutes-new'
  | 'minutes-edit'
  | 'minutes-detail'
  | 'minutes-approvals'
  | 'minutes-my-decisions'
  | 'minutes-followup'
  | 'minutes-report'
  | 'minutes-reports'
  | 'minutes-dashboard';

export type LayoutUserPermissions =
  | Record<string, boolean>
  | null
  | undefined;
