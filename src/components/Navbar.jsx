// src/components/Navbar.jsx
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../server.js/firebase";
import { useAuth } from "../contexts/AuthContext";
import { useNotifications } from "../contexts/NotificationContext";

export default function Navbar() {
  const { user } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead } =
    useNotifications();
  const [notifOpen, setNotifOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/login");
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const toggleNotif = () => {
    setNotifOpen((prev) => !prev);
  };

  const handleNotificationClick = async (n) => {
    if (!n.read) {
      await markAsRead(n.id);
    }
    if (n.taskId) {
      navigate(`/tasks/${n.taskId}`);
      setNotifOpen(false);
    }
  };

  return (
    <header className="bg-white/90 backdrop-blur border-b border-emerald-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        {/* Left: logo/title */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center text-white font-bold text-sm">
            P
          </div>
          <span className="font-semibold text-emerald-800 text-sm sm:text-base">
            PlanIT
          </span>
        </div>

        {/* Right: nav + notifications + user */}
        <div className="flex items-center gap-3">
          {/* Main nav (desktop) */}
          <nav className="hidden sm:flex items-center gap-3 text-xs text-emerald-800">
            <Link to="/dashboard" className="hover:text-emerald-600">
              Dashboard
            </Link>

            <div className="flex items-center gap-2">
              <Link to="/tasks" className="hover:text-emerald-600">
                Tasks
              </Link>

              {/* Notification bell BESIDE Tasks */}
              {user && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={toggleNotif}
                    className="relative w-8 h-8 rounded-full border border-emerald-100 bg-emerald-50 flex items-center justify-center hover:bg-emerald-100 transition"
                  >
                    {/* Bell icon */}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-4 h-4 text-emerald-700"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                      <path d="M10 21h4" />
                    </svg>

                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>

                  {/* Dropdown */}
                  {notifOpen && (
                    <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-white rounded-2xl shadow-lg border border-emerald-100 z-20">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-emerald-50">
                        <span className="text-xs font-semibold text-emerald-800">
                          Notifications
                        </span>
                        {unreadCount > 0 && (
                          <button
                            type="button"
                            onClick={markAllAsRead}
                            className="text-[11px] text-emerald-700 hover:underline"
                          >
                            Mark all as read
                          </button>
                        )}
                      </div>

                      {notifications.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-gray-500">
                          No notifications yet.
                        </div>
                      ) : (
                        <div className="max-h-80 overflow-y-auto">
                          {notifications.slice(0, 15).map((n) => (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => handleNotificationClick(n)}
                              className={`w-full text-left px-3 py-2.5 text-xs border-b border-emerald-50 hover:bg-emerald-50/70 transition ${
                                !n.read ? "bg-emerald-50/60" : ""
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                <div className="mt-0.5">
                                  <span
                                    className={`inline-block w-2 h-2 rounded-full ${
                                      !n.read ? "bg-emerald-500" : "bg-gray-300"
                                    }`}
                                  />
                                </div>
                                <div className="flex-1">
                                  <div className="font-semibold text-gray-900">
                                    {n.title || "Notification"}
                                  </div>
                                  {n.body && (
                                    <div className="text-[11px] text-gray-600 mt-0.5">
                                      {n.body}
                                    </div>
                                  )}
                                  {n.createdAt && (
                                    <div className="text-[10px] text-gray-400 mt-0.5">
                                      {n.createdAt.toDate
                                        ? n.createdAt
                                            .toDate()
                                            .toLocaleString()
                                        : ""}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </nav>

          {/* User auth area */}
          {user ? (
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-xs text-gray-600 max-w-[140px] truncate">
                {user.email}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition"
            >
              Login
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
