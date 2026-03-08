import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
} from "lucide-react";

export default function Logs() {
  const { toast } = useToast();

  const { data: logs, isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/logs"],
    refetchInterval: 10000,
  });

  const clearMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/logs"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
      toast({ title: "Logs cleared" });
    },
  });

  const statusIcon = (status: string) => {
    switch (status) {
      case "sent":
        return <CheckCircle className="w-3 h-3 text-status-online" />;
      case "failed":
        return <XCircle className="w-3 h-3 text-status-busy" />;
      default:
        return <AlertCircle className="w-3 h-3 text-status-away" />;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "sent":
        return "default" as const;
      case "failed":
        return "destructive" as const;
      default:
        return "secondary" as const;
    }
  };

  const sentCount = logs?.filter((l) => l.status === "sent").length || 0;
  const failedCount = logs?.filter((l) => l.status === "failed").length || 0;
  const skippedCount = logs?.filter((l) => l.status?.startsWith("skipped")).length || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-logs-title">
            Message Logs
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track all messages sent by your bots across all groups
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => refetch()}
            data-testid="button-refresh-logs"
          >
            <RefreshCw className="w-3 h-3 mr-1" />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            data-testid="button-clear-logs"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Clear All
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-status-online" />
              <span className="text-lg font-semibold" data-testid="text-sent-count">
                {sentCount}
              </span>
              <span className="text-xs text-muted-foreground">Sent</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-status-busy" />
              <span className="text-lg font-semibold" data-testid="text-failed-count">
                {failedCount}
              </span>
              <span className="text-xs text-muted-foreground">Failed</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-status-away" />
              <span className="text-lg font-semibold" data-testid="text-skipped-count">
                {skippedCount}
              </span>
              <span className="text-xs text-muted-foreground">Skipped</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-logs-table">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" />
            All Logs ({logs?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Loading logs...
            </div>
          ) : !logs?.length ? (
            <div className="text-center py-8">
              <Clock className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                No logs yet. Messages will appear here once the scheduler starts sending.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <div className="space-y-1">
                {logs.map((log: any) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 py-2.5 px-3 rounded-md hover-elevate"
                    data-testid={`log-row-${log.id}`}
                  >
                    {statusIcon(log.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium">{log.botName}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {log.groupName}
                        </Badge>
                        <Badge
                          variant={statusColor(log.status)}
                          className="text-[10px]"
                        >
                          {log.status}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {log.schedulePeriod}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {log.message}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {log.sentAt
                        ? new Date(log.sentAt).toLocaleString("en-US", {
                            timeZone: "Africa/Lagos",
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
