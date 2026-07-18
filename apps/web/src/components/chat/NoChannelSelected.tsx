import { AsphodelMark } from '@/components/brand/AsphodelMark';

export function NoChannelSelected() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="relative flex size-24 items-center justify-center">
        <span aria-hidden className="absolute inset-0 rounded-full border border-border" />
        <span aria-hidden className="absolute inset-3 rounded-full border border-border/60" />
        <AsphodelMark className="size-9 text-gold/80" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Select a channel to start chatting</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Your conversations for the Prefeitura de Nova Serrana live in the channels on the left.
        </p>
      </div>
    </div>
  );
}
