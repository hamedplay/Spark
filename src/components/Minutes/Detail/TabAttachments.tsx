import { AttachmentManager } from '../Shared/AttachmentManager';

export interface TabAttachmentsProps {
  minuteId: string;
  canManage: boolean;
}

export function TabAttachments({ minuteId, canManage }: TabAttachmentsProps) {
  return <AttachmentManager minuteId={minuteId} canManage={canManage} />;
}
