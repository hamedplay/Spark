// Compatibility shim for legacy mesh components. The canonical conference
// client boundary now belongs to the video-conference feature.
export {
  ConferenceClientContext,
  useConferenceClient,
} from '../../features/video-conference/conferenceClient';
export type { ConferenceSupabaseClient } from '../../features/video-conference/conferenceClient';
