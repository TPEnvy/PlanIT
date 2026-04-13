import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../server.js/firebase";
import { useAuth } from "../contexts/AuthContext";
import { useNotifications } from "../contexts/NotificationContext";

export default function Navbar() {
  const { user } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead } =
    useNotifications();
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setNotifOpen(false);
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login");
  };

  const handleNotificationClick = async (notification) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }

    if (notification.taskId) {
      navigate(`/tasks/${notification.taskId}`);
    }

    setNotifOpen(false);
  };

  const NotificationBell = () => (
    <div className="relative">
      <button
        type="button"
        onClick={() => setNotifOpen((prev) => !prev)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 transition hover:bg-emerald-100"
        aria-label="Open notifications"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4 text-emerald-700"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21h4" />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {notifOpen && (
        <div className="absolute right-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="text-xs text-emerald-600 hover:underline"
              >
                Mark all
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="px-3 py-4 text-xs text-gray-500">
              No notifications
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleNotificationClick(notification)}
                  className={`w-full border-b px-3 py-2 text-left text-xs hover:bg-emerald-50 ${
                    !notification.read ? "bg-emerald-50" : ""
                  }`}
                >
                  <div className="font-semibold">{notification.title}</div>
                  {notification.body && (
                    <div className="text-[11px] text-gray-600">
                      {notification.body}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const MobileMenuButton = () => (
    <button
      type="button"
      onClick={() => setMobileOpen((prev) => !prev)}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-100 bg-white text-emerald-700 transition hover:bg-emerald-50"
      aria-label={mobileOpen ? "Close menu" : "Open menu"}
      aria-expanded={mobileOpen}
      aria-controls="mobile-navigation"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        {mobileOpen ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 6l12 12M18 6L6 18"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 7h16M4 12h16M4 17h16"
          />
        )}
      </svg>
    </button>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-emerald-100 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link
          to={user ? "/dashboard" : "/login"}
          className="flex items-center gap-2"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 font-bold text-white">
            P
          </div>
          <span className="font-semibold text-emerald-800">PlanIT</span>
        </Link>

        <div className="hidden items-center gap-4 text-sm sm:flex">
          <Link to="/dashboard" className="text-xs hover:text-emerald-600">
            Dashboard
          </Link>
          <Link to="/tasks" className="text-xs hover:text-emerald-600">
            Tasks
          </Link>

          {user && <NotificationBell />}

          {user && (
            <span className="max-w-[140px] truncate text-xs text-gray-500">
              {user.email}
            </span>
          )}

          {user && (
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
            >
              Logout
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 sm:hidden">
          {user && <NotificationBell />}
          <MobileMenuButton />
        </div>
      </div>

      {mobileOpen && (
        <div
          id="mobile-navigation"
          className="space-y-3 border-t bg-white px-4 py-4 text-sm shadow-sm sm:hidden"
        >
          {user && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                Signed In
              </div>
              <div className="mt-1 truncate text-xs text-gray-600">
                {user.email}
              </div>
            </div>
          )}

          <Link
            to="/dashboard"
            onClick={() => setMobileOpen(false)}
            className="block rounded-xl px-3 py-2 text-emerald-800 transition hover:bg-emerald-50"
          >
            Dashboard
          </Link>

          <Link
            to="/tasks"
            onClick={() => setMobileOpen(false)}
            className="block rounded-xl px-3 py-2 text-emerald-800 transition hover:bg-emerald-50"
          >
            Tasks
          </Link>

          {user && (
            <button
              type="button"
              onClick={handleLogout}
              className="block w-full rounded-xl px-3 py-2 text-left text-red-600 transition hover:bg-red-50"
            >
              Logout
            </button>
          )}
        </div>
      )}
    </header>
  );
}
