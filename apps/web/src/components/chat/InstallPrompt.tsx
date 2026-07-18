import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  if (!deferredPrompt) {
    return null;
  }

  async function handleInstall() {
    await deferredPrompt!.prompt();
    await deferredPrompt!.userChoice;
    setDeferredPrompt(null);
  }

  return (
    <div
      data-slot="install-prompt"
      className="flex items-center justify-between gap-2 border-t bg-muted/50 px-3 py-2"
    >
      <span className="text-xs text-muted-foreground">Install Elyzian for quicker access</span>
      <Button size="sm" variant="outline" onClick={() => void handleInstall()}>
        Install
      </Button>
    </div>
  );
}
