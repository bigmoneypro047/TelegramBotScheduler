import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import Dashboard from "@/pages/dashboard";
import Configuration from "@/pages/configuration";
import Schedule from "@/pages/schedule";
import Logs from "@/pages/logs";
import Setup from "@/pages/setup";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/config" component={Configuration} />
      <Route path="/schedule" component={Schedule} />
      <Route path="/logs" component={Logs} />
      <Route path="/setup" component={Setup} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-screen w-full">
            <AppSidebar />
            <div className="flex flex-col flex-1 min-w-0">
              <header className="flex items-center gap-2 p-3 border-b border-border shrink-0">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                <span className="text-sm font-medium text-muted-foreground">
                  Telegram Bot Automation
                </span>
              </header>
              <main className="flex-1 overflow-auto p-4 sm:p-6">
                <Router />
              </main>
            </div>
          </div>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
