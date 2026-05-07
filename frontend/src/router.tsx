import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode
} from "react";

type RouterContextValue = {
  pathname: string;
  navigate: (href: string, options?: { replace?: boolean }) => void;
};

const RouterContext = createContext<RouterContextValue | null>(null);

function currentPathname() {
  if (typeof window === "undefined") return "/";
  return window.location.pathname || "/";
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [pathname, setPathname] = useState(currentPathname);

  useEffect(() => {
    const update = () => setPathname(currentPathname());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  const navigate = useCallback((href: string, options?: { replace?: boolean }) => {
    const url = new URL(href, window.location.origin);
    const nextPath = `${url.pathname}${url.search}${url.hash}`;
    if (nextPath === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;

    if (options?.replace) {
      window.history.replaceState(null, "", nextPath);
    } else {
      window.history.pushState(null, "", nextPath);
    }
    setPathname(url.pathname || "/");
  }, []);

  const value = useMemo(() => ({ pathname, navigate }), [navigate, pathname]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const context = useContext(RouterContext);
  if (!context) throw new Error("useRouter must be used inside RouterProvider.");
  return context;
}

export function usePathname() {
  return useRouter().pathname;
}

export function useParams<T extends Record<string, string | string[] | undefined> = Record<string, string | undefined>>() {
  const pathname = usePathname();
  const marketMatch = pathname.match(/^\/markets\/([^/?#]+)/);
  return (marketMatch ? { id: decodeURIComponent(marketMatch[1]) } : {}) as T;
}

type RouterLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string };

export function RouterLink({ href, onClick, target, ...props }: RouterLinkProps) {
  const { navigate } = useRouter();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || target || isModifiedEvent(event) || href.startsWith("http") || href.startsWith("mailto:")) {
      return;
    }

    event.preventDefault();
    navigate(href);
  }

  return <a href={href} target={target} onClick={handleClick} {...props} />;
}

function isModifiedEvent(event: MouseEvent) {
  return event.metaKey || event.altKey || event.ctrlKey || event.shiftKey || event.button !== 0;
}
