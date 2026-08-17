export type MediaState = {
  isMuted: boolean;
  isVideoOff: boolean;
  isHandRaised: boolean;
  isScreenSharing: boolean;
  isSpeakerMuted: boolean;
};

export type MediaAction =
  | { type: 'TOGGLE_MUTE' }
  | { type: 'TOGGLE_VIDEO' }
  | { type: 'TOGGLE_HAND' }
  | { type: 'SET_SCREEN_SHARING'; value: boolean }
  | { type: 'SET_SPEAKER_MUTED'; value: boolean }
  | { type: 'FORCE_MUTE' }
  | { type: 'SET_HAND'; value: boolean };

export function mediaReducer(state: MediaState, action: MediaAction): MediaState {
  switch (action.type) {
    case 'TOGGLE_MUTE': return { ...state, isMuted: !state.isMuted };
    case 'TOGGLE_VIDEO': return { ...state, isVideoOff: !state.isVideoOff };
    case 'TOGGLE_HAND': return { ...state, isHandRaised: !state.isHandRaised };
    case 'SET_SCREEN_SHARING': return { ...state, isScreenSharing: action.value };
    case 'SET_SPEAKER_MUTED': return { ...state, isSpeakerMuted: action.value };
    case 'FORCE_MUTE': return { ...state, isMuted: true };
    case 'SET_HAND': return { ...state, isHandRaised: action.value };
    default: return state;
  }
}
