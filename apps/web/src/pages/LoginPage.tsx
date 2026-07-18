import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { loginRequestSchema } from '@elyzian/shared';
import { login } from '@/lib/auth-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['currentUser'] });
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 size-[30rem] -translate-x-1/2 -translate-y-[55%] rounded-full bg-[radial-gradient(circle,var(--accent)_0%,transparent_68%)] opacity-[0.16] blur-[6px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-14 -right-20 h-[25rem] w-[22rem] rotate-[-6deg] bg-[linear-gradient(155deg,var(--gold),var(--accent))] opacity-10 [clip-path:polygon(50%_0%,100%_18%,100%_58%,50%_100%,0%_58%,0%_18%)]"
      />
      <Card className="relative z-10 w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Elyzian</CardTitle>
        </CardHeader>
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
  );
}
