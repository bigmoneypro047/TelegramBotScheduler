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
  Phone,
  Save,
  Shield,
  Users,
  MessageSquare,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  KeyRound,
  LogIn,
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
            Main Bot Token
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

          <Button
            onClick={() => {
              if (botToken) {
                configMutation.mutate({ botToken, isActive: true });
                setBotToken("");
              }
            }}
            disabled={configMutation.isPending || !botToken}
            data-testid="button-save-config"
          >
            <Save className="w-4 h-4 mr-2" />
            Save Token
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
              No userbots configured.
            </div>
          ) : (
            <div className="space-y-3">
              {userbots.map((bot: any) => (
                <UserbotLoginRow key={bot.id} bot={bot} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-groups">
        <CardHeader className="flex flex-row items-center justify-between gap-1">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Groups ({groups?.length || 0} / 8)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!groups?.length ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              No groups configured.
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

function UserbotLoginRow({ bot }: { bot: any }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"idle" | "entering_phone" | "code_sent" | "needs_password">("idle");
  const [loading, setLoading] = useState(false);

  const hasSession = !!bot.sessionString;
  const hasApiCreds = !!bot.apiId && !!bot.apiHash;

  async function requestCode() {
    if (!phone) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/userbots/${bot.id}/request-code`, { phoneNumber: phone });
      const data = await res.json();
      if (data.success) {
        setStep("code_sent");
        toast({ title: "Code sent", description: "Check your Telegram app for the verification code." });
      } else {
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  }

  async function verifyCode() {
    if (!code) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/userbots/${bot.id}/verify-code`, {
        code,
        password: password || undefined,
      });
      const data = await res.json();
      if (data.success) {
        setStep("idle");
        setPhone("");
        setCode("");
        setPassword("");
        queryClient.invalidateQueries({ queryKey: ["/api/userbots"] });
        toast({ title: "Authenticated", description: `${bot.name} is now connected and ready.` });
      } else if (data.needsPassword) {
        setStep("needs_password");
        toast({ title: "2FA Required", description: "Enter your two-factor authentication password." });
      } else {
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  }

  return (
    <div
      className="p-3 rounded-md bg-muted/30 border border-border space-y-3"
      data-testid={`userbot-row-${bot.order}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
          {bot.order}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{bot.name}</span>
            {hasApiCreds && (
              <Badge variant="secondary" className="text-[10px]">
                <KeyRound className="w-2.5 h-2.5 mr-1" />
                API Keys Set
              </Badge>
            )}
            {hasSession ? (
              <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                <CheckCircle className="w-2.5 h-2.5 mr-1" />
                Authenticated
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                <XCircle className="w-2.5 h-2.5 mr-1" />
                Not logged in
              </Badge>
            )}
            {bot.phoneNumber && (
              <span className="text-[10px] text-muted-foreground">{bot.phoneNumber}</span>
            )}
          </div>
        </div>
        {!hasSession && hasApiCreds && step === "idle" && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setStep("entering_phone")}
            data-testid={`button-login-${bot.order}`}
          >
            <LogIn className="w-3 h-3 mr-1" />
            Login
          </Button>
        )}
      </div>

      {step === "entering_phone" && (
        <div className="flex gap-2 pl-11">
          <Input
            placeholder="Phone number with country code (e.g. +234...)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-8 text-xs flex-1"
            data-testid={`input-phone-${bot.order}`}
          />
          <Button
            size="sm"
            onClick={requestCode}
            disabled={loading || !phone}
            data-testid={`button-send-code-${bot.order}`}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3 mr-1" />}
            Send Code
          </Button>
        </div>
      )}

      {step === "code_sent" && (
        <div className="flex gap-2 pl-11">
          <Input
            placeholder="Enter verification code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-8 text-xs flex-1"
            data-testid={`input-code-${bot.order}`}
          />
          <Button
            size="sm"
            onClick={verifyCode}
            disabled={loading || !code}
            data-testid={`button-verify-code-${bot.order}`}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}
            Verify
          </Button>
        </div>
      )}

      {step === "needs_password" && (
        <div className="flex gap-2 pl-11">
          <Input
            type="password"
            placeholder="Enter 2FA password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-8 text-xs flex-1"
            data-testid={`input-2fa-${bot.order}`}
          />
          <Button
            size="sm"
            onClick={verifyCode}
            disabled={loading || !password}
            data-testid={`button-verify-2fa-${bot.order}`}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}
            Submit
          </Button>
        </div>
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
