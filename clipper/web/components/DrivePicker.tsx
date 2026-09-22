"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    gapi?: { load: (name: string, cb: () => void) => void };
    google?: { picker: GooglePickerNamespace };
  }
}

interface GooglePickerNamespace {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: unknown) => DocsView;
  ViewId: { DOCS: unknown };
  Feature: { NAV_HIDDEN: unknown; SUPPORT_DRIVES: unknown };
  Action: { PICKED: string };
}
interface DocsView {
  setMimeTypes: (m: string) => DocsView;
  setIncludeFolders: (b: boolean) => DocsView;
  setMode?: (m: unknown) => DocsView;
}
interface PickerBuilder {
  addView: (v: DocsView) => PickerBuilder;
  setOAuthToken: (t: string) => PickerBuilder;
  setDeveloperKey: (k: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  enableFeature: (f: unknown) => PickerBuilder;
  setLocale: (l: string) => PickerBuilder;
  setCallback: (cb: (data: { action: string; docs?: { id: string; name: string }[] }) => void) => PickerBuilder;
  build: () => { setVisible: (b: boolean) => void };
}

const MIME = "video/mp4,video/quicktime,audio/mp4,audio/mpeg,audio/x-m4a,video/x-m4v";

export default function DrivePicker({ onPick }: { onPick: (f: { id: string; name: string }) => void }) {
  const [status, setStatus] = useState<{ connected: boolean; pickerReady: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => setStatus({ connected: !!d.google_connected, pickerReady: !!d.google_picker_ready })).catch(() => setStatus({ connected: false, pickerReady: false }));
  }, []);

  function loadScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.gapi) return resolve();
      const s = document.createElement("script");
      s.src = "https://apis.google.com/js/api.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("No se pudo cargar el Google Picker"));
      document.body.appendChild(s);
    });
  }

  async function open() {
    setError(null);
    try {
      const tokenRes = await fetch("/api/google/token");
      if (!tokenRes.ok) throw new Error("Conectá tu cuenta de Google en Configuración.");
      const { access_token } = await tokenRes.json();
      await loadScript();
      await new Promise<void>((resolve) => window.gapi!.load("picker", resolve));
      const g = window.google!.picker;
      const view = new g.DocsView(g.ViewId.DOCS).setMimeTypes(MIME).setIncludeFolders(true);
      const builder = new g.PickerBuilder()
        .addView(view)
        .setOAuthToken(access_token)
        .setDeveloperKey(process.env.NEXT_PUBLIC_GOOGLE_API_KEY || "")
        .enableFeature(g.Feature.SUPPORT_DRIVES)
        .setLocale("es")
        .setCallback((data) => {
          if (data.action === g.Action.PICKED && data.docs?.[0]) onPick({ id: data.docs[0].id, name: data.docs[0].name });
        });
      if (process.env.NEXT_PUBLIC_GOOGLE_APP_ID) builder.setAppId(process.env.NEXT_PUBLIC_GOOGLE_APP_ID);
      builder.build().setVisible(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!status) return null;
  if (!status.connected) {
    return <p className="muted text-sm">Para elegir archivos de Drive, <a className="underline" href="/settings">conectá tu cuenta de Google</a>.</p>;
  }
  return (
    <div>
      <button type="button" className="btn" onClick={open} disabled={!status.pickerReady} title={status.pickerReady ? "" : "Falta NEXT_PUBLIC_GOOGLE_API_KEY"}>
        Elegir archivo de Drive
      </button>
      {!status.pickerReady && <span className="muted ml-2 text-xs">Falta NEXT_PUBLIC_GOOGLE_API_KEY para el selector.</span>}
      {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
    </div>
  );
}
