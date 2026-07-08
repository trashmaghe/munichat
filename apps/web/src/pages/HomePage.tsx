import { useQuery } from '@tanstack/react-query';
import { healthResponseSchema, type HealthResponse } from '@munichat/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>MuniChat</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">Checking API status…</p>}
          {isError && <p className="text-sm text-destructive">API status: unreachable</p>}
          {data && (
            <p className="text-sm text-muted-foreground">
              API status: {data.status} (uptime {Math.round(data.uptime)}s)
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
