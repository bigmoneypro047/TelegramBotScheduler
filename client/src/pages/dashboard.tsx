import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Bot,
  Play,
  Square,
  Clock,
  Globe,
  MessageSquare,
  Users,
  Activity,
  Zap,
  Radio,
} from "lucide-react";

export default function Dashboard() {
  const { toast } = useToast();

  const { data: status } = useQuery<{
    isRunning: boolean;
    jobCount: number;
    language: string;
    mainBotMessage: string;
  }>({
    queryKey: ["/api/scheduler/status"],
    refetchInterval: 5000,
  });

  const { data: config } = useQuery({
    queryKey: ["/api/config"],
  });

  const { data: userbots } = useQuery<any[]>({
    queryKey: ["/api/userbots"],
  });

  const { data: groups } = useQuery<any[]>({
    queryKey: ["/api/groups"],
  });

  const { data: logs } = useQuery<any[]>({
    queryKey: ["/api/logs"],
    refetchInterval: 10000,
  });

  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/scheduler/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler/status"] });
      toast({ title: "Scheduler started", description: "All scheduled jobs are now running." });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/scheduler/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler/status"] });
      toast({ title: "Scheduler stopped", description: "All scheduled jobs have been stopped." });
    },
  });

  const seedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/seed-defaults"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/userbots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({ title: "Defaults created", description: "4 userbots and 6 groups have been set up." });
    },
  });

  const configuredBots = userbots?.filter((b: any) => b.sessionString) || [];
  const configuredGroups = groups?.filter((g: any) => g.groupId) || [];
  const recentLogs = logs?.slice(0, 10) || [];

  const nigeriaTime = new Date().toLocaleString("en-US", {
    timeZone: "Africa/Lagos",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const nigeriaDate = new Date().toLocaleDateString("en-US", {
    timeZone: "Africa/Lagos",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Monitor and control your Telegram bot automation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            <Clock className="w-3 h-3 mr-1" />
            {nigeriaTime} WAT
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-scheduler-status">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Scheduler
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${status?.isRunning ? "bg-status-online animate-pulse" : "bg-status-offline"}`}
              />
              <span className="text-lg font-semibold" data-testid="text-scheduler-state">
                {status?.isRunning ? "Running" : "Stopped"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {status?.jobCount || 0} active jobs
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-language">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Today's Language
            </CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <span className="text-lg font-semibold" data-testid="text-language">
              {status?.language || "Loading..."}
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              Rotates daily through 7 languages
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-bots-status">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Userbots
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <span className="text-lg font-semibold" data-testid="text-bots-count">
              {configuredBots.length} / {userbots?.length || 0}
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              Configured userbots
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-groups-status">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Groups
            </CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <span className="text-lg font-semibold" data-testid="text-groups-count">
              {configuredGroups.length} / {groups?.length || 0}
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              Active groups
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" data-testid="card-controls">
          <CardHeader>
            <CardTitle className="text-base">Quick Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {status?.isRunning ? (
                <Button
                  variant="destructive"
                  onClick={() => stopMutation.mutate()}
                  disabled={stopMutation.isPending}
                  data-testid="button-stop-scheduler"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop Scheduler
                </Button>
              ) : (
                <Button
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending}
                  data-testid="button-start-scheduler"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Start Scheduler
                </Button>
              )}
              {(!userbots?.length || !groups?.length) && (
                <Button
                  variant="secondary"
                  onClick={() => seedMutation.mutate()}
                  disabled={seedMutation.isPending}
                  data-testid="button-seed-defaults"
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Setup Default Bots & Groups
                </Button>
              )}
            </div>

            {status?.mainBotMessage && (
              <div className="bg-muted/50 rounded-md p-3 border border-border">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Today's Main Bot Message ({status.language})
                </p>
                <p className="text-sm" data-testid="text-main-bot-message">
                  {status.mainBotMessage}
                </p>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              <p>{nigeriaDate}</p>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-setup-checklist">
          <CardHeader>
            <CardTitle className="text-base">Setup Checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ChecklistItem
              label="Bot Token"
              done={!!config?.botToken}
              testId="check-bot-token"
            />
            <ChecklistItem
              label="API ID & Hash"
              done={!!config?.apiId && !!config?.apiHash}
              testId="check-api-credentials"
            />
            <ChecklistItem
              label={`Userbots (${configuredBots.length}/${userbots?.length || 0})`}
              done={configuredBots.length >= 3}
              testId="check-userbots"
            />
            <ChecklistItem
              label={`Groups (${configuredGroups.length}/${groups?.length || 0})`}
              done={configuredGroups.length >= 5}
              testId="check-groups"
            />
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-recent-activity">
        <CardHeader className="flex flex-row items-center justify-between gap-1">
          <CardTitle className="text-base">Recent Activity</CardTitle>
          <Badge variant="outline" className="text-xs">
            <Radio className="w-3 h-3 mr-1" />
            Live
          </Badge>
        </CardHeader>
        <CardContent>
          {recentLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Bot className="w-10 h-10 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">
                No messages sent yet. Start the scheduler and configure your bots to begin.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentLogs.map((log: any) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 py-2 border-b border-border last:border-0"
                  data-testid={`log-entry-${log.id}`}
                >
                  <Badge
                    variant={
                      log.status === "sent"
                        ? "default"
                        : log.status === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                    className="text-[10px] mt-0.5 shrink-0"
                  >
                    {log.status}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium">{log.botName}</span>
                      <span className="text-xs text-muted-foreground">
                        {log.groupName}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {log.message}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {log.sentAt
                      ? new Date(log.sentAt).toLocaleTimeString("en-US", {
                          timeZone: "Africa/Lagos",
                          hour: "numeric",
                          minute: "2-digit",
                          hour12: true,
                        })
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChecklistItem({
  label,
  done,
  testId,
}: {
  label: string;
  done: boolean;
  testId: string;
}) {
  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <div
        className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
          done
            ? "bg-status-online text-white"
            : "border border-muted-foreground/30 text-muted-foreground"
        }`}
      >
        {done ? "\u2713" : ""}
      </div>
      <span className={`text-sm ${done ? "" : "text-muted-foreground"}`}>
        {label}
      </span>
    </div>
  );
}
