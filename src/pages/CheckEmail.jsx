// src/pages/CheckEmail.jsx
import React from "react";

export default function CheckEmail() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="max-w-md w-full bg-white p-6 rounded-xl shadow">
        <h2 className="text-2xl font-semibold mb-2">Check your email</h2>

        <p className="text-sm text-gray-600 mb-6">
          We sent you a verification link. Please open your inbox and verify your
          account before signing in.
        </p>

        <div className="flex gap-3">
          <button
            onClick={() => (window.location.hash = "/login")}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium"
          >
            Go to Login
          </button>

          <button
            onClick={() => (window.location.hash = "/signup")}
            className="px-4 py-2 rounded-lg border font-medium"
          >
            Back to Signup
          </button>
        </div>
      </div>
    </div>
  );
}
