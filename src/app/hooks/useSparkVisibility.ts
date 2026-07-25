import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export function useSparkVisibility() {
  const [sparkVisible, setSparkVisible] = useState(false);

  useEffect(() => {
    const loadSparkVisible = () => {
      void supabase
        .from('system_config')
        .select('value')
        .eq('section', 'spark')
        .eq('key', 'spark_visible')
        .maybeSingle()
        .then(({ data }) => {
          setSparkVisible(data ? data.value === 'true' : false);
        })
        .catch(() => {});
    };

    loadSparkVisible();

    const handleSparkVisibleEvent = (e: Event) => {
      setSparkVisible((e as CustomEvent).detail.visible);
    };
    window.addEventListener('spark-visible-changed', handleSparkVisibleEvent);

    const channel = supabase
      .channel(`spark-config-rt-${Date.now()}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'system_config',
      }, (payload: { new?: { section?: string; key?: string }; old?: { section?: string; key?: string } }) => {
        if (
          (payload.new?.section === 'spark' && payload.new?.key === 'spark_visible') ||
          (payload.old?.section === 'spark' && payload.old?.key === 'spark_visible')
        ) {
          loadSparkVisible();
        } else if (!payload.new?.section && !payload.old?.section) {
          loadSparkVisible();
        }
      })
      .subscribe();

    return () => {
      window.removeEventListener('spark-visible-changed', handleSparkVisibleEvent);
      supabase.removeChannel(channel);
    };
  }, []);

  return sparkVisible;
}
