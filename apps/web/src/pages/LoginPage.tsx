import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { loginRequestSchema } from '@elyzian/shared';
import { login } from '@/lib/auth-api';
import { AsphodelMark } from '@/components/brand/AsphodelMark';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: login,
    // Seed the cache directly from the response instead of invalidating and
    // relying on a refetch to land before navigating: invalidateQueries only
    // forces an immediate refetch for an *actively observed* query, and
    // nothing observes ['currentUser'] while we're sitting on /login (that
    // only happens inside ProtectedRoute, which isn't mounted yet). The
    // invalidation used to just mark the cache stale and resolve right away,
    // so navigate('/') could mount ProtectedRoute before its own background
    // refetch had come back - which then read the *stale error* left over
    // from the pre-login unauthenticated check (isLoading is false once a
    // query has any settled result, error included) and bounced straight
    // back to /login. A fast browser tab usually outran that race; the
    // desktop client's WebView2 consistently didn't, requiring a second,
    // now-successful login to actually get in.
    onSuccess: (data) => {
      queryClient.setQueryData(['currentUser'], data.user);
      navigate('/');
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = loginRequestSchema.safeParse({ username, password });
    if (!parsed.success) {
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {/* Aperture — concentric rings echoing the brand's threshold reading. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 size-[42rem] -translate-x-1/2 -translate-y-1/2"
      >
        <div className="absolute inset-0 rounded-full border border-border/70" />
        <div className="absolute inset-[12%] rounded-full border border-border/50" />
        <div className="absolute inset-[26%] rounded-full border border-border/30" />
        <div className="absolute inset-[40%] rounded-full bg-[radial-gradient(circle,var(--gold)_0%,transparent_70%)] opacity-[0.07]" />
      </div>

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center">
        <div className="flex flex-col items-center gap-3 pb-7 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-[#191d23] text-gold shadow-sm">
            <AsphodelMark className="size-8" title="Elyzian" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Elyzian</h1>
            <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
              Prefeitura Municipal de Nova Serrana
            </p>
          </div>
        </div>

        <Card className="w-full">
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={mutation.isPending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={mutation.isPending}
              />
            </div>
            {mutation.isError && (
              <p className="text-sm text-destructive">Invalid username or password.</p>
            )}
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
