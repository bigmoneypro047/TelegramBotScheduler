import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useLocation } from "wouter";
import {
  MessageSquare,
  Save,
  CheckCircle,
  ArrowRight,
  Sparkles,
} from "lucide-react";

export default function Setup() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: groups } = useQuery<any[]>({
    queryKey: ["/api/groups"],
  });

  const [groupInputs, setGroupInputs] = useState<{ name: string; groupId: string }[]>([
    { name: "Group 1", groupId: "" },
    { name: "Group 2", groupId: "" },
    { name: "Group 3", groupId: "" },
    { name: "Group 4", groupId: "" },
    { name: "Group 5", groupId: "" },
    { name: "Group 6", groupId: "" },
    { name: "Group 7", groupId: "" },
    { name: "Group 8", groupId: "" },
  ]);

  const [saved, setSaved] = useState(false);

  const existingGroupIds = groups?.filter(g => g.groupId).length || 0;

  const bulkMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/groups/bulk-setup", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setSaved(true);
      toast({
        title: "All groups saved",
        description: "Your 6 Telegram group IDs have been saved successfully.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to save",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const updateInput = (index: number, field: "name" | "groupId", value: string) => {
    setGroupInputs(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const filledCount = groupInputs.filter(g => g.groupId.trim()).length;

  const handleSaveAll = () => {
    const groupEntries = groupInputs.map((g, i) => ({
      name: g.name.trim() || `Group ${i + 1}`,
      groupId: g.groupId.trim(),
      order: i + 1,
    }));

    bulkMutation.mutate({ groups: groupEntries });
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary">
            <MessageSquare className="w-6 h-6" />
          </div>
        </div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-setup-title">
          Group Setup
        </h1>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          Enter the Telegram Group IDs for all 6 groups below. You can also give each group a custom name.
        </p>
      </div>

      {existingGroupIds > 0 && !saved && (
        <div className="bg-muted/50 border border-border rounded-md p-3 text-center">
          <p className="text-sm text-muted-foreground">
            You already have <span className="font-medium text-foreground">{existingGroupIds}</span> group(s) configured.
            Saving here will update all 6 groups.
          </p>
        </div>
      )}

      <Card data-testid="card-group-setup">
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Enter Group IDs
            </span>
            <Badge variant="outline" className="text-xs">
              {filledCount} / 6 filled
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {groupInputs.map((group, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-3 rounded-md bg-muted/30 border border-border"
              data-testid={`setup-group-${index + 1}`}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0 mt-1">
                {index + 1}
              </div>
              <div className="flex-1 space-y-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Group Name</Label>
                  <Input
                    value={group.name}
                    onChange={(e) => updateInput(index, "name", e.target.value)}
                    placeholder={`Group ${index + 1}`}
                    className="h-8 text-sm"
                    data-testid={`input-setup-name-${index + 1}`}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Group ID <span className="text-muted-foreground/60">(e.g. -1001234567890)</span>
                  </Label>
                  <Input
                    value={group.groupId}
                    onChange={(e) => updateInput(index, "groupId", e.target.value)}
                    placeholder="-1001234567890"
                    className="h-8 text-sm font-mono"
                    data-testid={`input-setup-id-${index + 1}`}
                  />
                </div>
              </div>
              {group.groupId.trim() && (
                <CheckCircle className="w-4 h-4 text-status-online mt-2 shrink-0" />
              )}
            </div>
          ))}

          <div className="flex flex-col gap-3 pt-2">
            <Button
              onClick={handleSaveAll}
              disabled={bulkMutation.isPending || filledCount === 0}
              className="w-full"
              data-testid="button-save-all-groups"
            >
              {bulkMutation.isPending ? (
                "Saving..."
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save All {filledCount} Group{filledCount !== 1 ? "s" : ""}
                </>
              )}
            </Button>

            {saved && (
              <Button
                variant="secondary"
                onClick={() => navigate("/config")}
                className="w-full"
                data-testid="button-go-to-config"
              >
                Continue to Configuration
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">How to find Group IDs:</span> Add @userinfobot to each group, or forward a message from the group to @userinfobot. The Group ID is a negative number like -1001234567890.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
