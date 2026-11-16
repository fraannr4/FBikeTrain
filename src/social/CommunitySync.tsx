import { useEffect } from 'react';
import Dexie from 'dexie';
import { useAccount } from '../auth/AccountBoundary';
import { db } from '../db/db';
import { useToast } from '../ui/components/Toast';
import { syncCommunityScores } from './challengeScoring';
import { touchCommunityActivity } from './community';

/** Recompute after a Worker commits an import, a deletion, reconnecting or resuming the app. */
export function CommunitySync() {
  const account = useAccount();
  const toast = useToast();
  useEffect(() => {
    if (!account || account.user.is_anonymous) return;
    let live = true, running = false, dirty = false, warned = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const databaseName = db.name;
    async function sync() {
      if (!live || db.name !== databaseName || document.visibilityState === 'hidden') return;
      if (running) { dirty = true; return; }
      running = true;
      try {
        await touchCommunityActivity(account!.client);
        await syncCommunityScores(account!.client, account!.user.id);
        warned = false;
      } catch {
        if (live && !warned) {
          warned = true;
          toast('No se ha actualizado la comunidad. Puedes reintentar desde Retos.', { tone: 'error' });
        }
      } finally {
        running = false;
        if (dirty && live) { dirty = false; schedule(); }
      }
    }
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => { void sync(); }, 1000);
    }
    const changed = (parts: unknown) => {
      const keys = Object.keys(parts as object);
      if (keys.some(key => key.startsWith(`idb://${databaseName}/activities/`) || key.startsWith(`idb://${databaseName}/tracks/`))) schedule();
    };
    const resume = () => { if (document.visibilityState !== 'hidden') schedule(); };
    Dexie.on('storagemutated', changed);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    schedule();
    return () => {
      live = false;
      clearTimeout(timer);
      Dexie.on('storagemutated').unsubscribe(changed);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [account, toast]);
  return null;
}
