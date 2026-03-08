import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Clock,
  MessageSquare,
  Sun,
  Sunset,
  Moon,
  CheckCircle,
  Zap,
} from "lucide-react";

export default function Schedule() {
  const { data: schedule, isLoading } = useQuery<any>({
    queryKey: ["/api/schedule"],
  });

  const { data: groups } = useQuery<any[]>({
    queryKey: ["/api/groups"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">Loading schedule...</div>
      </div>
    );
  }

  if (!schedule) return null;

  const timeBlocks = [
    {
      id: "morning",
      label: "Morning Chat",
      time: "7:00 - 8:00 AM",
      icon: Sun,
      color: "text-amber-500",
      data: schedule.morningChat,
    },
    {
      id: "mainbot",
      label: "Main Bot Message",
      time: "8:10 AM",
      icon: Zap,
      color: "text-primary",
      data: null,
    },
    ...schedule.readyWindows.map((w: any, i: number) => ({
      id: `ready-${i}`,
      label: `Ready Window ${i + 1}`,
      time: w.windowTime,
      icon: CheckCircle,
      color: "text-status-online",
      data: w.groups,
    })),
    {
      id: "done",
      label: "Done Session",
      time: "3:20 - 4:00 PM",
      icon: Clock,
      color: "text-orange-500",
      data: schedule.doneWindow,
    },
    {
      id: "evening",
      label: "Evening Discussion",
      time: "4:30 - 7:00 PM",
      icon: Sunset,
      color: "text-purple-500",
      data: schedule.eveningChat,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-schedule-title">
          Today's Schedule
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Full message schedule for today - Language: {schedule.language}
        </p>
      </div>

      <div className="bg-muted/30 border border-border rounded-md p-4">
        <div className="flex items-start gap-3">
          <Zap className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">
              8:10 AM - Main Bot ({schedule.language})
            </p>
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-main-schedule-message">
              {schedule.mainBotMessage}
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="morning" className="w-full">
        <ScrollArea className="w-full">
          <TabsList className="w-full justify-start">
            {timeBlocks
              .filter((b) => b.id !== "mainbot")
              .map((block) => (
                <TabsTrigger
                  key={block.id}
                  value={block.id}
                  className="text-xs"
                  data-testid={`tab-${block.id}`}
                >
                  <block.icon className={`w-3 h-3 mr-1 ${block.color}`} />
                  {block.label}
                </TabsTrigger>
              ))}
          </TabsList>
        </ScrollArea>

        {timeBlocks
          .filter((b) => b.id !== "mainbot")
          .map((block) => (
            <TabsContent key={block.id} value={block.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <block.icon className={`w-4 h-4 ${block.color}`} />
                    {block.label}
                    <Badge variant="outline" className="text-xs ml-auto">
                      {block.time}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="0">
                    <TabsList>
                      {(block.data || []).map((_: any, idx: number) => (
                        <TabsTrigger
                          key={idx}
                          value={String(idx)}
                          className="text-xs"
                          data-testid={`tab-group-${block.id}-${idx}`}
                        >
                          {groups?.[idx]?.name || `Group ${idx + 1}`}
                        </TabsTrigger>
                      ))}
                    </TabsList>

                    {(block.data || []).map((groupData: any, gIdx: number) => (
                      <TabsContent key={gIdx} value={String(gIdx)}>
                        <div className="space-y-1.5 mt-3">
                          {(groupData.messages || []).map(
                            (msg: any, mIdx: number) => (
                              <div
                                key={mIdx}
                                className="flex items-center gap-3 py-2 px-3 rounded-md bg-muted/30"
                                data-testid={`msg-${block.id}-${gIdx}-${mIdx}`}
                              >
                                <Badge variant="outline" className="text-[10px] shrink-0 font-mono">
                                  {msg.time}
                                </Badge>
                                <Badge variant="secondary" className="text-[10px] shrink-0">
                                  Userbot {msg.botIndex + 1}
                                </Badge>
                                <span className="text-sm truncate">
                                  {msg.message}
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      </TabsContent>
                    ))}
                  </Tabs>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
      </Tabs>
    </div>
  );
}
