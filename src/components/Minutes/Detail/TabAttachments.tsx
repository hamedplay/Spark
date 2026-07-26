import { AttachmentManager } from '../Shared/AttachmentManager';

export interface TabAttachmentsProps {
  minuteId: string;
  canManage: boolean;
  revisionNumber?: number | null;
}

export function TabAttachments({ minuteId, canManage, revisionNumber }: TabAttachmentsProps) {
  return <AttachmentManager minuteId={minuteId} canManage={canManage} revisionNumber={revisionNumber} />;
}
