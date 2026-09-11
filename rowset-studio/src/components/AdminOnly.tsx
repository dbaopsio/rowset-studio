import { Navigate } from "react-router";
import { useAuth } from "../lib/auth";

export default function AdminOnly({ children }: { children: React.ReactNode }) {
  const role = useAuth((s) => s.user?.role);
  if (role !== "admin") return <Navigate to="/editor" replace />;
  return children;
}
