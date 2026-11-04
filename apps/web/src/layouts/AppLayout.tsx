import * as React from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Search,
  Settings,
  User,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useLogout, useMe } from "@/features/auth/hooks";
import { cn, initials } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/documents", label: "Documentos", icon: FolderOpen },
  { to: "/chat", label: "Chat com Documentos", icon: MessageSquareText },
  { to: "/search", label: "Pesquisa", icon: Search },
  { to: "/settings", label: "Configurações", icon: Settings },
];

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Navegação principal" className="flex-1 space-y-1 px-2">
      {NAV.map((item) => {
        const link = (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                collapsed && "justify-center px-0",
              )
            }
          >
            <item.icon className="size-5 shrink-0" aria-hidden />
            {!collapsed ? <span className="truncate">{item.label}</span> : <span className="sr-only">{item.label}</span>}
          </NavLink>
        );
        if (!collapsed) return link;
        return (
          <Tooltip key={item.to}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

export function AppLayout() {
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = useLocalStorage<boolean>("docmind:sidebar-collapsed", false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = React.useState("");

  const isImmersive = location.pathname.startsWith("/chat") || /^\/documents\/[^/]+$/.test(location.pathname);

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
    setSearch("");
  };

  const handleLogout = async () => {
    await logout.mutateAsync();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar desktop */}
      {isDesktop ? (
        <aside
          className={cn(
            "flex h-full shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200",
            collapsed ? "w-[68px]" : "w-64",
          )}
        >
          <div className={cn("flex h-16 items-center px-4", collapsed && "justify-center px-0")}>
            <Logo collapsed={collapsed} />
          </div>
          <SidebarNav collapsed={collapsed} />
          <div className="p-2">
            <Button
              variant="ghost"
              size="sm"
              className={cn("w-full justify-start gap-2 text-muted-foreground", collapsed && "justify-center")}
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronRight /> : <ChevronLeft />}
              {!collapsed ? "Recolher" : null}
            </Button>
          </div>
        </aside>
      ) : (
        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogContent className="left-0 top-0 h-full w-72 max-w-[85vw] translate-x-0 translate-y-0 rounded-none border-r bg-sidebar p-0 data-[state=open]:animate-fade-in">
            <DialogTitle className="sr-only">Menu</DialogTitle>
            <div className="flex h-16 items-center px-4">
              <Logo />
            </div>
            <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </DialogContent>
        </Dialog>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
          {!isDesktop ? (
            <>
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
                <Menu />
              </Button>
              <Logo size="sm" />
            </>
          ) : null}
          <form onSubmit={onSearchSubmit} className="ml-auto hidden w-full max-w-md sm:block" role="search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar nos documentos…"
                aria-label="Pesquisar nos documentos"
                className="bg-card pl-9"
              />
            </div>
          </form>
          <div className={cn("flex items-center gap-1", isDesktop && "ml-0")}>
            <Button variant="ghost" size="icon" className="sm:hidden" asChild aria-label="Pesquisar">
              <NavLink to="/search">
                <Search />
              </NavLink>
            </Button>
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="ml-1 flex items-center gap-2 rounded-full p-1 pr-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label="Menu do usuário"
                >
                  <span className="flex size-8 items-center justify-center rounded-full bg-gradient-brand text-xs font-semibold text-white">
                    {user ? initials(user.name) : <User className="size-4" />}
                  </span>
                  <span className="hidden max-w-[10rem] truncate text-sm font-medium md:block">{user?.name}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>
                  <p className="truncate text-sm font-medium text-foreground">{user?.name}</p>
                  <p className="truncate text-xs font-normal">{user?.email}</p>
                  <p className="mt-1 truncate text-xs font-normal">
                    {user?.workspace.name} · {user?.workspace.role}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate("/settings")}>
                  <Settings /> Configurações
                </DropdownMenuItem>
                <DropdownMenuItem destructive onSelect={() => void handleLogout()}>
                  <LogOut /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main
          id="conteudo"
          className={cn("min-h-0 flex-1", isImmersive ? "overflow-hidden" : "overflow-y-auto")}
        >
          <div className={cn(isImmersive ? "h-full" : "mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8 animate-fade-in")}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
