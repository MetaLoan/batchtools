import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SseEvent } from '@bvp/shared';

export function useSse(userId: string | null) {
  const qc = useQueryClient();
  const ref = useRef<EventSource | null>(null);
  useEffect(() => {
    if (!userId) {
      ref.current?.close();
      ref.current = null;
      return;
    }
    const es = new EventSource('/v1/stream/me', { withCredentials: true });
    ref.current = es;
    const onMsg = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as SseEvent;
        if (data.type === 'job.created' || data.type === 'job.updated') {
          qc.invalidateQueries({ queryKey: ['jobs'] });
        }
        if (data.type.startsWith('sub_job')) {
          qc.invalidateQueries({ queryKey: ['jobs'] });
          const payload = data.payload as { jobId?: string };
          if (payload.jobId) {
            qc.invalidateQueries({ queryKey: ['job', payload.jobId] });
          }
        }
      } catch {
        // ignore parse errors
      }
    };
    ['ready', 'job.created', 'job.updated', 'sub_job.submitted', 'sub_job.updated', 'sub_job.finished'].forEach((t) =>
      es.addEventListener(t, onMsg as EventListener)
    );
    es.onerror = () => {
      // browser will auto-reconnect
    };
    return () => {
      es.close();
      ref.current = null;
    };
  }, [userId, qc]);
}
