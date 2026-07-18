import { LayoutDashboard, MessageSquare, Settings, type LucideIcon } from 'lucide-react';
import { AsphodelMark } from '@/components/brand/AsphodelMark';

function IdeaIcon({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div
      className="relative flex size-10 items-center justify-center rounded-lg text-sidebar-foreground opacity-45"
      title={title}
    >
      <Icon className="size-5" aria-hidden />
      <span className="absolute top-1 right-1 size-1.5 rounded-full bg-gold" />
    </div>
  );
}

export function IconRail() {
  return (
    <aside
      data-slot="icon-rail"
      className="flex w-16 shrink-0 flex-col items-center gap-2 border-r bg-sidebar py-3"
    >
      {/* Brand anchor — the asphodel, gold on the rail. */}
      <div
        className="flex size-10 items-center justify-center rounded-xl bg-[#191d23] text-gold"
        title="Elyzian"
      >
        <AsphodelMark className="size-6" title="Elyzian" />
      </div>
      <div className="my-1 h-px w-8 bg-sidebar-border" aria-hidden />

      <div
        className="relative flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"
        aria-current="page"
        aria-label="Channels"
      >
        <span className="absolute inset-y-1 left-0 w-1 rounded-full bg-gold" aria-hidden />
        <MessageSquare className="size-5" aria-hidden />
      </div>

      <IdeaIcon icon={LayoutDashboard} title="Ticket dashboard — idea, not yet built" />
      <IdeaIcon icon={Settings} title="Settings — idea, not yet built" />
    </aside>
  );
}
