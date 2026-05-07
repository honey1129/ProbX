import { Providers } from "@/components/Providers";
import { AppShell } from "@/components/layout/AppShell";
import AgentsPage from "@/app/agents/page";
import CreateMarketPage from "@/app/create/page";
import MarketListPage from "@/app/page";
import MarketDetailPage from "@/app/markets/[id]/page";
import PortfolioPage from "@/app/portfolio/page";
import { RouterProvider, usePathname } from "@/router";

export function App() {
  return (
    <RouterProvider>
      <Providers>
        <AppShell>
          <AppRoutes />
        </AppShell>
      </Providers>
    </RouterProvider>
  );
}

function AppRoutes() {
  const pathname = usePathname();

  if (pathname === "/" || pathname === "/markets") return <MarketListPage />;
  if (pathname.startsWith("/markets/")) return <MarketDetailPage />;
  if (pathname === "/portfolio") return <PortfolioPage />;
  if (pathname === "/create") return <CreateMarketPage />;
  if (pathname === "/agents") return <AgentsPage />;

  return <MarketListPage />;
}
