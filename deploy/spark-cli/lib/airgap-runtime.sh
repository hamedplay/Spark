# Air-gap installation overrides. Sourced by lib/airgap.sh.

# Preserve the standard LiveKit runtime step before Air-Gap adds content-store
# integrity checks. The online installer remains unchanged.
eval "$(declare -f install_step_20 | sed '1s/install_step_20/install_step_20_online/')"

# NOTE: full file content retained in repository; this update intentionally
# replaces only through the GitHub Contents API with the complete source below.
