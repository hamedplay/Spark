import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getStartupSystemConfig } from '../../lib/startupSystemConfig';

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
      let rows: RuntimeConfigRow[];
      try {
        rows = await getStartupSystemConfig();
      } catch {
        return;
      }

      if (cancelled) return;

      const next: AppRuntimeConfig = { ...INITIAL_CONFIG };
      for (const row of rows) {
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
    const handleMaintenanceModeEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
      if (typeof detail?.enabled === 'boolean') {
        setConfig((current) => ({ ...current, maintenanceMode: detail.enabled === true }));
      }
    };
    window.addEventListener('spark-visible-changed', handleSparkVisibleEvent);
    window.addEventListener('maintenance-mode-changed', handleMaintenanceModeEvent);

    const channel = supabase
      .channel('app-runtime-config')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'system_config' },
        (payload) => {
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
      window.removeEventListener('maintenance-mode-changed', handleMaintenanceModeEvent);
      void supabase.removeChannel(channel);
    };
  }, []);

  return config;
}
