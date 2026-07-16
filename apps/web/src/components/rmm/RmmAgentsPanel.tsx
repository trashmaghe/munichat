import { useState } from 'react';
import { useRmmAgents } from '@/hooks/useRmmAgents';
import { fetchRmmRemoteControlUrls } from '@/lib/rmm-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { RmmAgentSummary } from '@munichat/shared';

export function RmmAgentsPanel({ canRemoteControl }: { canRemoteControl: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmingAgent, setConfirmingAgent] = useState<RmmAgentSummary | null>(null);
  const [launching, setLaunching] = useState(false);
  const { data: agents, isLoading } = useRmmAgents(open);

  async function handleConfirmRemoteControl() {
    if (!confirmingAgent) {
      return;
    }
    setLaunching(true);
    try {
      // Fetched fresh right before use — never cached, since the URL
      // carries a one-time MeshCentral login token.
      const urls = await fetchRmmRemoteControlUrls(confirmingAgent.agentId);
      window.open(urls.desktopUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setLaunching(false);
      setConfirmingAgent(null);
    }
  }

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
        Monitored devices
      </Button>

      {open && (
        <Card className="absolute top-full right-0 z-40 mt-2 max-h-96 w-80 overflow-y-auto">
          <CardHeader>
            <CardTitle>Monitored devices</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {isLoading && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            {!isLoading && agents?.length === 0 && (
              <p className="text-sm text-muted-foreground">No devices found.</p>
            )}
            {agents?.map((agent) => (
              <div
                key={agent.agentId}
                className="flex items-center justify-between gap-2 border-b pb-2 last:border-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{agent.hostname}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {agent.clientName} / {agent.siteName} — {agent.status}
                  </p>
                </div>
                {canRemoteControl && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirmingAgent(agent)}
                  >
                    Remote control
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={confirmingAgent !== null}
        onOpenChange={(next) => !next && setConfirmingAgent(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open a remote-control session?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;re about to open a live remote-desktop session to{' '}
              <strong>{confirmingAgent?.hostname}</strong> in a new tab. Anyone with
              that tab&apos;s URL can control the machine — don&apos;t share it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={launching}
              onClick={() => void handleConfirmRemoteControl()}
            >
              {launching ? 'Opening…' : 'Open'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
