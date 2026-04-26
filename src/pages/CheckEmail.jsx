// src/pages/CheckEmail.jsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import PageTransition from "../components/PageTransition";
import { auth } from "../server.js/firebase";

export default function CheckEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email;

  const leaveVerification = async (path) => {
    try {
      if (auth?.currentUser) {
        await signOut(auth);
      }
    } catch (error) {
      console.warn("Failed to clear unverified auth session:", error);
    }

    navigate(path);
  };

  return (
    <PageTransition>
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-500 p-6">
        <div className="max-w-md w-full bg-white p-6 rounded-xl shadow-lg border border-emerald-100">
          <h2 className="text-2xl font-semibold mb-2 text-emerald-800">
            Check your email
          </h2>

          <p className="text-sm text-gray-600 mb-6">
            We sent you a verification link. Please open your inbox and verify your
            account before signing in.
          </p>

          {email && (
            <p className="mb-6 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              Verification email sent to <span className="font-semibold">{email}</span>.
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => leaveVerification("/login")}
              className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition"
            >
              Go to Login
            </button>

            <button
              type="button"
              onClick={() => leaveVerification("/signup")}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 font-medium transition"
            >
              Back to Signup
            </button>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
