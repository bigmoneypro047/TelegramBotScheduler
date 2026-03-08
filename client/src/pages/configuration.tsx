import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import {
  Bot,
  Key,
  Hash,
  Phone,
  Save,
  Shield,
  Users,
  MessageSquare,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
} from "lucide-react";

export default function Configuration() {
  const { toast } = useToast();

  const { data: config } = useQuery({
    queryKey: ["/api/config"],
  });

  const { data: userbots } = useQuery<any[]>({
    queryKey: ["/api/userbots"],
  });

  const { data: groups } = useQuery<any[]>({
    queryKey: ["/api/groups"],
  });

  const [botToken, setBotToken] = useState("");
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");

  const configMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/config", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      toast({ title: "Configuration saved", description: "Bot configuration has been updated." });
    },
  });

  const groupMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/groups", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({ title: "Group updated" });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/groups/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({ title: "Group deleted" });
    },
  });

  const userbotMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/userbots", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/userbots"] });
      toast({ title: "Userbot updated" });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-config-title">
          Configuration
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Set up your Telegram bot credentials and group connections
        </p>
      </div>

      <Card data-testid="card-bot-config">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Bot Credentials
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bot-token" className="flex items-center gap-1.5 text-sm">
              <Bot className="w-3.5 h-3.5" />
              Bot Token (from BotFather)
            </Label>
            <div className="flex gap-2">
              <Input
                id="bot-token"
                type="password"
                placeholder={config?.botToken ? "Token is configured" : "Enter your bot token..."}
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                data-testid="input-bot-token"
              />
              {config?.botToken && (
                <Badge variant="secondary" className="shrink-0 self-center">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Set
                </Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="api-id" className="flex items-center gap-1.5 text-sm">
                <Key className="w-3.5 h-3.5" />
                API ID
              </Label>
              <div className="flex gap-2">
                <Input
                  id="api-id"
                  type="password"
                  placeholder={config?.apiId ? "API ID configured" : "Enter API ID..."}
                  value={apiId}
                  onChange={(e) => setApiId(e.target.value)}
                  data-testid="input-api-id"
                />
                {config?.apiId && (
                  <Badge variant="secondary" className="shrink-0 self-center">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Set
                  </Badge>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-hash" className="flex items-center gap-1.5 text-sm">
                <Hash className="w-3.5 h-3.5" />
                API Hash
              </Label>
              <div className="flex gap-2">
                <Input
                  id="api-hash"
                  type="password"
                  placeholder={config?.apiHash ? "API Hash configured" : "Enter API Hash..."}
                  value={apiHash}
                  onChange={(e) => setApiHash(e.target.value)}
                  data-testid="input-api-hash"
                />
                {config?.apiHash && (
                  <Badge variant="secondary" className="shrink-0 self-center">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Set
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <Button
            onClick={() => {
              const data: any = {};
              if (botToken) data.botToken = botToken;
              if (apiId) data.apiId = apiId;
              if (apiHash) data.apiHash = apiHash;
              data.isActive = true;
              configMutation.mutate(data);
              setBotToken("");
              setApiId("");
              setApiHash("");
            }}
            disabled={configMutation.isPending || (!botToken && !apiId && !apiHash)}
            data-testid="button-save-config"
          >
            <Save className="w-4 h-4 mr-2" />
            Save Credentials
          </Button>
        </CardContent>
      </Card>

      <Card data-testid="card-userbots">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" />
            Userbots ({userbots?.length || 0} / 4)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!userbots?.length ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              No userbots configured. Go to Dashboard and click "Setup Default Bots & Groups" to create them.
            </div>
          ) : (
            <div className="space-y-3">
              {userbots.map((bot: any) => (
                <UserbotRow
                  key={bot.id}
                  bot={bot}
                  onSave={(phoneNumber) =>
                    userbotMutation.mutate({
                      id: bot.id,
                      name: bot.name,
                      phoneNumber,
                      sessionString: bot.sessionString,
                      isActive: !!phoneNumber,
                      order: bot.order,
                    })
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-groups">
        <CardHeader className="flex flex-row items-center justify-between gap-1">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Groups ({groups?.length || 0} / 6)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!groups?.length ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              No groups configured. Go to Dashboard and click "Setup Default Bots & Groups" to create them.
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((group: any) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  onSave={(name, groupId) =>
                    groupMutation.mutate({
                      id: group.id,
                      name,
                      groupId,
                      order: group.order,
                      isActive: true,
                    })
                  }
                  onDelete={() => deleteGroupMutation.mutate(group.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UserbotRow({
  bot,
  onSave,
}: {
  bot: any;
  onSave: (phone: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState(false);

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-md bg-muted/30 border border-border"
      data-testid={`userbot-row-${bot.order}`}
    >
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
        {bot.order}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{bot.name}</span>
          {bot.phoneNumber ? (
            <Badge variant="secondary" className="text-[10px]">
              <CheckCircle className="w-2.5 h-2.5 mr-1" />
              {bot.phoneNumber}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              <XCircle className="w-2.5 h-2.5 mr-1" />
              Not configured
            </Badge>
          )}
        </div>
      </div>
      {editing ? (
        <div className="flex gap-1.5">
          <Input
            placeholder="Phone number..."
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-40 h-8 text-xs"
            data-testid={`input-phone-${bot.order}`}
          />
          <Button
            size="sm"
            onClick={() => {
              onSave(phone);
              setEditing(false);
              setPhone("");
            }}
            data-testid={`button-save-phone-${bot.order}`}
          >
            <Save className="w-3 h-3" />
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setEditing(true)}
          data-testid={`button-edit-phone-${bot.order}`}
        >
          <Phone className="w-3 h-3 mr-1" />
          {bot.phoneNumber ? "Update" : "Add Phone"}
        </Button>
      )}
    </div>
  );
}

function GroupRow({
  group,
  onSave,
  onDelete,
}: {
  group: any;
  onSave: (name: string, groupId: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [groupId, setGroupId] = useState(group.groupId || "");

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-md bg-muted/30 border border-border"
      data-testid={`group-row-${group.order}`}
    >
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-accent text-accent-foreground text-sm font-bold shrink-0">
        {group.order}
      </div>
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
              className="h-8 text-xs"
              data-testid={`input-group-name-${group.order}`}
            />
            <Input
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              placeholder="Group ID (e.g. -1001234567890)"
              className="h-8 text-xs"
              data-testid={`input-group-id-${group.order}`}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{group.name}</span>
            {group.groupId ? (
              <Badge variant="secondary" className="text-[10px]">
                <CheckCircle className="w-2.5 h-2.5 mr-1" />
                ID configured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                <XCircle className="w-2.5 h-2.5 mr-1" />
                No ID
              </Badge>
            )}
          </div>
        )}
      </div>
      <div className="flex gap-1.5 shrink-0">
        {editing ? (
          <Button
            size="sm"
            onClick={() => {
              onSave(name, groupId);
              setEditing(false);
            }}
            data-testid={`button-save-group-${group.order}`}
          >
            <Save className="w-3 h-3" />
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEditing(true)}
            data-testid={`button-edit-group-${group.order}`}
          >
            Edit
          </Button>
        )}
        <Button
          size="sm"
          variant="destructive"
          onClick={onDelete}
          data-testid={`button-delete-group-${group.order}`}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}
