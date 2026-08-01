import { supabase } from '../../lib/supabase';
import type { MinutesLayoutConfig } from './MinutesDocumentData';
import { FALLBACK_LOGO } from './MinutesDocumentData';

export async function fetchMinutesConfig(): Promise<{ logoUrl: string | null; config: MinutesLayoutConfig }> {
  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('section, key, value')
      .or('section.eq.minutes,section.eq.appearance.and.key.eq.logo_url');
    if (error) throw error;

    const rows = (data || []) as Array<{ section: string; key: string; value: string | null }>;
    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(`${r.section}.${r.key}`, r.value ?? '');
    }

    const logoUrl = map.get('appearance.logo_url') || FALLBACK_LOGO;
    const cfg: MinutesLayoutConfig = {
      headerTitle: map.get('minutes.minutes_header_title') || 'صورت‌جلسه',
      orgName: map.get('minutes.minutes_org_name') || '',
      subtitle: map.get('minutes.minutes_subtitle') || '',
      footerText: map.get('minutes.minutes_footer_text') || 'پایان صورت‌جلسه',
      showLogo: (map.get('minutes.minutes_show_logo') ?? 'true') === 'true',
      showParticipants: (map.get('minutes.minutes_show_participants') ?? 'true') === 'true',
      showApprovers: (map.get('minutes.minutes_show_approvers') ?? 'true') === 'true',
      showConfidentiality: (map.get('minutes.minutes_show_confidentiality') ?? 'true') === 'true',
      showDecisions: (map.get('minutes.minutes_show_decisions') ?? 'true') === 'true',
      fontSize: map.get('minutes.minutes_font_size') || 'medium',
    };

    return { logoUrl, config: cfg };
  } catch {
    return {
      logoUrl: FALLBACK_LOGO,
      config: {
        headerTitle: 'صورت‌جلسه',
        orgName: '',
        subtitle: '',
        footerText: 'پایان صورت‌جلسه',
        showLogo: true,
        showParticipants: true,
        showApprovers: true,
        showConfidentiality: true,
        showDecisions: true,
        fontSize: 'medium',
      },
    };
  }
}
