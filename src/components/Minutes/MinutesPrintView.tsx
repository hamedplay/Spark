import { createPortal } from 'react-dom';
import type { MinutesDocumentData } from './MinutesDocumentData';
import { MinutesDocumentLayout } from './MinutesDocumentLayout';

export interface MinutesPrintViewProps {
  data: MinutesDocumentData;
}

export function MinutesPrintView({ data }: MinutesPrintViewProps) {
  return createPortal(
    <MinutesDocumentLayout data={data} variant="print" />,
    document.body,
  );
}
