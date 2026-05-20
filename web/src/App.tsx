import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import Login from './pages/Login';
import AppLayout from './components/AppLayout';
import Workbench from './pages/Workbench';
import CapabilityPage from './pages/CapabilityPage';
import QueuePage from './pages/QueuePage';
import TasksPage from './pages/TasksPage';
import TaskDetailPage from './pages/TaskDetailPage';
import AssetsPage from './pages/AssetsPage';
import SettingsPage from './pages/SettingsPage';
import { useAppStore } from './lib/store';
import { useSse } from './lib/sse';

export default function App() {
  const [bootstrap, setBootstrap] = useState<'pending' | 'ready'>('pending');
  const location = useLocation();
  const currentUser = useAppStore((s) => s.currentUser);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);

  useEffect(() => {
    api
      .me()
      .then((r) => setCurrentUser(r.authenticated && r.user ? r.user : null))
      .catch(() => setCurrentUser(null))
      .finally(() => setBootstrap('ready'));
  }, [setCurrentUser]);

  useSse(currentUser?.id ?? null);

  if (bootstrap === 'pending') {
    return <div className="flex h-screen items-center justify-center text-zinc-500">Loading…</div>;
  }

  if (!currentUser && location.pathname !== '/login') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <Routes>
      <Route path="/login" element={<Login onAuthed={setCurrentUser} />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Workbench />} />
        <Route path="/c/:capabilityId" element={<CapabilityPage />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/tasks/:jobId" element={<TaskDetailPage />} />
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function useCapabilities() {
  return useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api.listCapabilities().then((r) => r.capabilities),
    staleTime: 5 * 60_000,
  });
}
