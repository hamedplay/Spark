# Lighthouse PDF follow-up

Supplied 1111.pdf: performance 68, FCP 0.4s, LCP 0.6s, TBT 1800ms,
main thread 4.0s. Largest task 1430ms at 1975ms is unattributable; 3111ms
is classified as Other, versus 624ms script evaluation. Browser extensions
were present. This PDF cannot establish which function caused that task or
whether an extension contributed. A clean-profile Performance trace is needed
to diagnose that remaining blocking, not another speculative bundle rewrite.

Image audit identifies a 36023-byte PNG logo rendered at 70px. UI logo consumers,
preload and favicon now share a 192px WebP derivative (8108 bytes, 77.5% smaller).
It preserves alpha and the existing brand artwork. PWA caches include that exact
URL, with a new cache version. Original PNG installation icons and document
exports remain unchanged. Generated asset was visually checked; build output,
preload reference, favicon and SW syntax/cache coverage were checked.

The PDF also identifies a legacy 512px avatar shown at 36px. Current avatar-upload
source outputs 256px; changing the old production object requires access to that
Storage deployment or an established thumbnail service. Do not blindly use
Supabase hosted image-transform URLs on this self-hosted installation.

Production build passes. No database change, lint run or claimed post-deployment
Lighthouse score. After deployment rerun with extensions disabled, identical user,
page and viewport. Capture Chrome Performance recording with JavaScript sampling
enabled if the unattributable task persists. This patch addresses the measured
logo payload; it does not claim to resolve the unexplained 1430ms task.
