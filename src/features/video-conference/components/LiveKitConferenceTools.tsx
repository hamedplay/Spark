import { ConferenceTools } from './controls/ConferenceTools';
import type { ConferenceToolsProps } from '../types/conference.types';

export function LiveKitConferenceTools(props: ConferenceToolsProps) {
  return <ConferenceTools {...props} />;
}
