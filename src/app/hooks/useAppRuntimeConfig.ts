import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface AppRuntimeConfig {
  maintenanceMode: boolean;
  sparkVisible: boolean;
}

interface RuntimeConfigRow {
  section?: string;
  key?: string;
  value?: string;
}

const INITIAL_CONFIG: AppRuntimeConfig = {
  maintenanceMode: false,
  sparkVisible: false,
};

/**
 * Runtime flags used by the authenticated shell share the same system_config
 * table. Loading/subscribing once avoids duplicate startup requests and
 * duplicate realtime sockets for flags that change very infrequently.
 */
export function useAppRuntimeConfig(): AppRuntimeConfig {
  const [config, setConfig] = useState<AppRuntimeConfig>(INITIAL_CONFIG);

  useEffect(() => {
    let cancelled = false;

    const applyRow = (row: RuntimeConfigRow | null | undefined) => {
      if (!row) return;

      if (row.section === 'security' && row.key === 'maintenance_mode') {
        setConfig((current) => ({ ...current, maintenanceMode: row.value === 'true' }));
      }

      if (row.section === 'spark' && row.key === 'spark_visible') {
        setConfig((current) => ({ ...current, sparkVisible: row.value === 'true' }));
      }
    };

    const load = async () => {
      const { data, error } = await supabase
        .from('system_config')
        .select('section,key,value')
        .in('section', ['security', 'spark'])
        .in('key', ['maintenance_mode', 'spark_visible']);

      if (cancelled || error) return;

      const next: AppRuntimeConfig = { ...INITIAL_CONFIG };
      for (const row of data || []) {
        if (row.section === 'security' && row.key === 'maintenance_mode') {
          next.maintenanceMode = row.value === 'true';
        } else if (row.section === 'spark' && row.key === 'spark_visible') {
          next.sparkVisible = row.value === 'true';
        }
      }
      setConfig(next);
    };

    void load();

    const handleSparkVisibleEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ visible?: boolean }>).detail;
      if (typeof detail?.visible === 'boolean') {
        setConfig((current) => ({ ...current, sparkVisible: detail.visible === true }));
      }
    };
    window.addEventListener('spark-visible-changed', handleSparkVisibleEvent);

    const channel = supabase
      .channel('app-runtime-config')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'system_config' },
        (payload) => {
          // INSERT/UPDATE events carry the latest row and need no follow-up
          // request. For DELETE, re-read the two tiny runtime flags because the
          // old realtime row may contain only primary-key columns depending on
          // the table replica identity.
          if (payload.eventType === 'DELETE') {
            void load();
            return;
          }

          applyRow(payload.new as RuntimeConfigRow);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.removeEventListener('spark-visible-changed', handleSparkVisibleEvent);
      void supabase.removeChannel(channel);
    };
  }, []);

  return config;
}
