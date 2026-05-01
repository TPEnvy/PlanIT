// src/App.jsx
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";

import Signup from "./pages/Signup";
import Login from "./pages/Login";
import CheckEmail from "./pages/CheckEmail";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import CreateTask from "./pages/CreateTask";
import TaskDetail from "./pages/TaskDetail";
import EditTask from "./pages/EditTask";
import SplitTask from "./pages/SplitTask";   // ✅ NEW
import Tutorial from "./pages/Tutorial";
import AdminDashboard from "./pages/AdminDashboard";
import AdminAnalytics from "./pages/AdminAnalytics";
import AdminThesisAssistant from "./pages/AdminThesisAssistant";

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/" element={<Navigate to="/signup" replace />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/check-email" element={<CheckEmail />} />
        <Route path="/tutorial" element={<Tutorial />} />

        {/* Protected */}
        <Route
          path="/admin"
          element={
            <PrivateRoute>
              <AdminDashboard />
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/analytics"
          element={
            <PrivateRoute>
              <AdminAnalytics />
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/thesis"
          element={
            <PrivateRoute>
              <AdminThesisAssistant />
            </PrivateRoute>
          }
        />

        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          }
        />

        <Route
          path="/tasks"
          element={
            <PrivateRoute>
              <Tasks />
            </PrivateRoute>
          }
        />

        <Route
          path="/tasks/create"
          element={
            <PrivateRoute>
              <CreateTask />
            </PrivateRoute>
          }
        />

        {/* ✅ EDIT route uses :id */}
        <Route
          path="/tasks/:id/edit"
          element={
            <PrivateRoute>
              <EditTask />
            </PrivateRoute>
          }
        />

        {/* ✅ SPLIT route also uses :id and must be BEFORE detail */}
        <Route
          path="/tasks/:id/split"
          element={
            <PrivateRoute>
              <SplitTask />
            </PrivateRoute>
          }
        />

        {/* ✅ DETAIL route uses :taskId (matches TaskDetail.jsx) */}
        <Route
          path="/tasks/:taskId"
          element={
            <PrivateRoute>
              <TaskDetail />
            </PrivateRoute>
          }
        />

        {/* 404 */}
        <Route
          path="*"
          element={<div className="p-10">404 - Page not found</div>}
        />
      </Routes>
    </BrowserRouter>
  );
}
