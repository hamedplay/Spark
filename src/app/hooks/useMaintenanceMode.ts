import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export function useMaintenanceMode() {
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  useEffect(() => {
    const loadMaintenance = () => {
      void supabase
        .from('system_config')
        .select('value')
        .eq('section', 'security')
        .eq('key', 'maintenance_mode')
        .maybeSingle()
        .then(({ data }) => setMaintenanceMode(data?.value === 'true'))
        .catch(() => {});
    };
    loadMaintenance();
    const ch = supabase
      .channel(`maintenance-rt-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_config' }, (payload: { new?: { section?: string; key?: string; value?: string } }) => {
        if (payload.new?.section === 'security' && payload.new?.key === 'maintenance_mode') {
          setMaintenanceMode(payload.new.value === 'true');
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return maintenanceMode;
}
