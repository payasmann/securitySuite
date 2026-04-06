"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

interface SchoolSettings {
  id: string;
  name: string;
  localStorageEnabled: boolean;
  cloudStorageEnabled: boolean;
  remoteAccessEnabled: boolean;
  localViewEnabled: boolean;
  retentionDays: number;
  maxCameras: number;
  maxUsers: number;
}

export default function SchoolSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const schoolId = params.id as string;
  const [settings, setSettings] = useState<SchoolSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchSchool() {
      try {
        const res = await fetch(`/api/schools/${schoolId}`);
        if (res.ok) {
          const data = await res.json();
          setSettings({
            id: data.school.id,
            name: data.school.name,
            localStorageEnabled: data.school.localStorageEnabled,
            cloudStorageEnabled: data.school.cloudStorageEnabled,
            remoteAccessEnabled: data.school.remoteAccessEnabled,
            localViewEnabled: data.school.localViewEnabled,
            retentionDays: data.school.retentionDays,
            maxCameras: data.school.maxCameras,
            maxUsers: data.school.maxUsers,
          });
        }
      } catch {
        setError("Failed to load school settings");
      } finally {
        setLoading(false);
      }
    }
    fetchSchool();
  }, [schoolId]);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const res = await fetch(`/api/schools/${schoolId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localStorageEnabled: settings.localStorageEnabled,
          cloudStorageEnabled: settings.cloudStorageEnabled,
          remoteAccessEnabled: settings.remoteAccessEnabled,
          localViewEnabled: settings.localViewEnabled,
          retentionDays: settings.retentionDays,
          maxCameras: settings.maxCameras,
          maxUsers: settings.maxUsers,
        }),
      });

      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to save settings");
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="skeleton h-8 w-64" />
        <div className="card p-4 space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-6 w-12 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!settings) {
    return <div className="card p-8 text-center text-text-muted">School not found</div>;
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Header */}
      <div>
        <button
          onClick={() => router.push(`/ops/schools/${schoolId}`)}
          className="text-xs text-text-muted hover:text-text-secondary mb-2 flex items-center gap-1"
        >
          ← Back to school detail
        </button>
        <h1 className="text-lg font-semibold text-text-primary">{settings.name}</h1>
        <p className="text-xs text-text-muted">Feature flags & limits</p>
      </div>

      {error && (
        <div className="p-3 bg-status-alert/10 border border-status-alert/20 rounded-card text-sm text-status-alert">
          {error}
        </div>
      )}

      {saved && (
        <div className="p-3 bg-status-online/10 border border-status-online/20 rounded-card text-sm text-status-online">
          Settings saved successfully
        </div>
      )}

      {/* Feature flags */}
      <div className="bg-bg-panel border border-border rounded-card p-4">
        <h2 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-4">Feature Flags</h2>
        <div className="space-y-4">
          <Toggle
            label="Local Storage"
            description="On-prem agent writes recordings to local disk"
            checked={settings.localStorageEnabled}
            onChange={(v) => setSettings({ ...settings, localStorageEnabled: v })}
          />
          <Toggle
            label="Cloud Storage"
            description="Upload clips and snapshots to cloud (R2)"
            checked={settings.cloudStorageEnabled}
            onChange={(v) => setSettings({ ...settings, cloudStorageEnabled: v })}
          />
          <Toggle
            label="Remote Access"
            description="Allow school users to log in from outside the school network"
            checked={settings.remoteAccessEnabled}
            onChange={(v) => setSettings({ ...settings, remoteAccessEnabled: v })}
          />
          <Toggle
            label="Local View"
            description="Enable live camera feed viewing"
            checked={settings.localViewEnabled}
            onChange={(v) => setSettings({ ...settings, localViewEnabled: v })}
          />
        </div>
      </div>

      {/* Limits */}
      <div className="bg-bg-panel border border-border rounded-card p-4">
        <h2 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-4">Limits</h2>
        <div className="grid grid-cols-3 gap-4">
          <NumberInput
            label="Retention Days"
            value={settings.retentionDays}
            onChange={(v) => setSettings({ ...settings, retentionDays: v })}
            min={1}
            max={365}
          />
          <NumberInput
            label="Max Cameras"
            value={settings.maxCameras}
            onChange={(v) => setSettings({ ...settings, maxCameras: v })}
            min={1}
            max={128}
          />
          <NumberInput
            label="Max Users"
            value={settings.maxUsers}
            onChange={(v) => setSettings({ ...settings, maxUsers: v })}
            min={1}
            max={100}
          />
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-sm bg-accent hover:bg-accent-hover text-white rounded-md transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm text-text-primary">{label}</div>
        <div className="text-2xs text-text-muted">{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          checked ? "bg-status-online" : "bg-bg-card border border-border"
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <label className="block text-2xs text-text-muted mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value) || min;
          onChange(Math.max(min, Math.min(max, v)));
        }}
        min={min}
        max={max}
        className="w-full px-3 py-1.5 bg-bg-app border border-border rounded text-sm text-text-primary font-mono focus:outline-none focus:border-accent"
      />
    </div>
  );
}
