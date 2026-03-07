"use client";

import { useCallback, useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "nr1-theme";

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

function detectThemePreference(): ThemeMode {
  if (typeof window === "undefined") return "light";
  if (document.documentElement.classList.contains("dark")) return "dark";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(() => detectThemePreference());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleMediaChange = () => {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "light" || stored === "dark") return;
      const nextTheme: ThemeMode = media.matches ? "dark" : "light";
      setTheme(nextTheme);
    };

    if (media.addEventListener) {
      media.addEventListener("change", handleMediaChange);
      return () => media.removeEventListener("change", handleMediaChange);
    }

    media.addListener(handleMediaChange);
    return () => media.removeListener(handleMediaChange);
  }, []);

  const toggleTheme = useCallback(() => {
    const nextTheme: ThemeMode = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    setTheme(nextTheme);
  }, [theme]);

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="nr-theme-toggle"
      aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      <svg viewBox="0 0 24 24" className="nr-theme-toggle__icon" aria-hidden="true">
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 2.5v2.4M12 19.1v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </>
        ) : (
          <path
            d="M21 13.3A8.8 8.8 0 1 1 10.7 3a7.2 7.2 0 0 0 10.3 10.3Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      <span className="nr-theme-toggle__label">{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}
