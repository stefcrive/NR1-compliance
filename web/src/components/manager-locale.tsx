"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

export type ManagerLocale = "en" | "pt";

type ManagerLocaleContextValue = {
  locale: ManagerLocale;
  setLocale: (next: ManagerLocale) => void;
  toggleLocale: () => void;
};

const ManagerLocaleContext = createContext<ManagerLocaleContextValue | null>(null);
const STORAGE_KEY = "nr1.manager.locale";

export function ManagerLocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<ManagerLocale>("en");
  const isBootstrappingRef = useRef(true);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if ((saved === "en" || saved === "pt") && saved !== "en") {
      const timer = window.setTimeout(() => {
        isBootstrappingRef.current = false;
        setLocale(saved);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    isBootstrappingRef.current = false;
    window.localStorage.setItem(STORAGE_KEY, "en");
    document.documentElement.lang = "en";
  }, []);

  useEffect(() => {
    if (isBootstrappingRef.current) return;
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale === "pt" ? "pt-BR" : "en";
  }, [locale]);

  const value = useMemo<ManagerLocaleContextValue>(
    () => ({
      locale,
      setLocale,
      toggleLocale: () => setLocale((previous) => (previous === "en" ? "pt" : "en")),
    }),
    [locale],
  );

  return <ManagerLocaleContext.Provider value={value}>{children}</ManagerLocaleContext.Provider>;
}

export function useManagerLocale() {
  const value = useContext(ManagerLocaleContext);
  if (!value) {
    throw new Error("useManagerLocale must be used inside ManagerLocaleProvider.");
  }
  return value;
}
