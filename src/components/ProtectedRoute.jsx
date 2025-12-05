// src/components/ProtectedRoute.jsx
import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

/**
 * Usage:
 * <Route element={<ProtectedRoute />}>
 *   <Route path="/dashboard" element={<Dashboard />} />
 * </Route>
 *
 * This component supports nested routes via <Outlet />.
 */

export default function ProtectedRoute({ redirectTo = "/login" }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // while auth state resolves, you can show a spinner or null
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  if (!user) {
    // Pass the current location in state so we can redirect back after login
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  // user is authenticated -> render nested routes
  return <Outlet />;
}
