"use client";

import { useCallback, useEffect, useState } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

let toastCounter = 0;
const listeners = new Set<(toast: ToastItem) => void>();

/** Show a toast notification from anywhere (no hook required). */
export function showToast(type: ToastType, message: string, duration = 4000) {
  const toast: ToastItem = {
    id: `toast-${++toastCounter}`,
    type,
    message,
    duration,
  };
  listeners.forEach((fn) => fn(toast));
}

const COLORS: Record<ToastType, string> = {
  success: "bg-emerald-900/90 border-emerald-700/50 text-emerald-200",
  error: "bg-red-900/90 border-red-700/50 text-red-200",
  warning: "bg-amber-900/90 border-amber-700/50 text-amber-200",
  info: "bg-blue-900/90 border-blue-700/50 text-blue-200",
};

const ICONS: Record<ToastType, string> = {
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "ℹ",
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((toast: ToastItem) => {
    setToasts((prev) => [...prev.slice(-4), toast]); // keep max 5
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    listeners.add(addToast);
    return () => { listeners.delete(addToast); };
  }, [addToast]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastNotification
          key={toast.id}
          toast={toast}
          onDismiss={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}

function ToastNotification({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.duration ?? 4000);
    return () => clearTimeout(timer);
  }, [toast.duration, onDismiss]);

  return (
    <div
      className={`pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-lg border backdrop-blur-sm shadow-lg text-sm animate-in slide-in-from-right-full fade-in duration-200 ${COLORS[toast.type]}`}
    >
      <span className="text-base leading-none">{ICONS[toast.type]}</span>
      <span className="max-w-xs">{toast.message}</span>
      <button
        onClick={onDismiss}
        className="ml-2 opacity-50 hover:opacity-100 transition-opacity text-xs"
      >
        ×
      </button>
    </div>
  );
}
