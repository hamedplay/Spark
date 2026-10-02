import { supabase } from './supabase';

export interface StartupSystemConfigRow {
  section: string;
  key: string;
  value: string;
}

let startupConfigPromise: Promise<StartupSystemConfigRow[]> | null = null;

/**
 * Load the small set of system_config rows needed by the authenticated shell
 * through one shared in-flight request. Consumers still own their own realtime
 * subscriptions; this only deduplicates initial hydration during startup.
 */
export function getStartupSystemConfig(): Promise<StartupSystemConfigRow[]> {
  if (!startupConfigPromise) {
    startupConfigPromise = supabase
      .from('system_config')
      .select('section,key,value')
      .in('section', ['appearance', 'security', 'spark', 'ui'])
      .in('key', [
        'primary_color',
        'maintenance_mode',
        'spark_visible',
        'sidebar_default_collapsed',
      ])
      .then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []) as StartupSystemConfigRow[];
      })
      .catch((error) => {
        startupConfigPromise = null;
        throw error;
      });
  }

  return startupConfigPromise;
}

export function findStartupSystemConfigValue(
  rows: StartupSystemConfigRow[],
  section: string,
  key: string,
): string | null {
  return rows.find((row) => row.section === section && row.key === key)?.value ?? null;
}
