import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { healthResponseSchema, type HealthResponse } from '@munichat/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { logout } from '@/lib/auth-api';

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${import.meta.env.VITE_API_URL}/health`);
  if (!res.ok) {
    throw new Error(`Health check failed with status ${res.status}`);
  }
  return healthResponseSchema.parse(await res.json());
}

export function HomePage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
  });
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['currentUser'] }),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>MuniChat</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isLoading && <p className="text-sm text-muted-foreground">Checking API status…</p>}
          {isError && <p className="text-sm text-destructive">API status: unreachable</p>}
          {data && (
            <p className="text-sm text-muted-foreground">
              API status: {data.status} (uptime {Math.round(data.uptime)}s)
            </p>
          )}
          {currentUser && (
            <p className="text-sm text-muted-foreground">
              Signed in as {currentUser.displayName}
            </p>
          )}
          <Button
            variant="outline"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
