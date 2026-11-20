function deriveFromLocation(): string | null {
  if (typeof window === "undefined") return null;

  const { protocol, hostname } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:4000";
  }

  const forwarded = hostname.replace(/-3000(?=\.)/, "-4000");
  if (forwarded !== hostname) {
    return `${protocol}//${forwarded}`;
  }

  if (window.location.port === "3000") {
    return `${protocol}//${hostname}:4000`;
  }

  return null;
}

export function serverBaseUrl(kind: "api" | "socket"): string {
  const derived = deriveFromLocation();
  if (derived) return derived;

  const configured =
    kind === "api"
      ? process.env.NEXT_PUBLIC_API_URL
      : process.env.NEXT_PUBLIC_SOCKET_URL;

  return (configured ?? "http://localhost:4000").replace(/\/+$/, "");
}