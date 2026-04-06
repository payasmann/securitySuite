"use client";

import { useState, useEffect, useCallback } from "react";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: string;
}

interface UserManagementProps {
  currentUserId: string;
  assignableRoles: string[];
}

export default function UserManagement({ currentUserId, assignableRoles: initialRoles }: UserManagementProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [assignableRoles, setAssignableRoles] = useState<string[]>(initialRoles);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", email: "", password: "", role: "" });
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
        if (data.assignableRoles) {
          setAssignableRoles(data.assignableRoles);
        }
      }
    } catch {
      // keep existing
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        setShowAddForm(false);
        setFormData({ name: "", email: "", password: "", role: "" });
        fetchUsers();
      } else {
        const data = await res.json();
        setFormError(data.error || "Failed to create user");
      }
    } catch {
      setFormError("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(userId: string) {
    if (!confirm("Are you sure you want to deactivate this user?")) return;

    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      if (res.ok) {
        fetchUsers();
      }
    } catch {
      // silently fail
    }
  }

  async function handleReactivate(userId: string) {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
      });
      if (res.ok) {
        fetchUsers();
      }
    } catch {
      // silently fail
    }
  }

  function formatRole(role: string): string {
    return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-text-primary">
          User Management
          <span className="text-sm font-normal text-text-muted ml-2">
            {users.filter((u) => u.active).length} active users
          </span>
        </h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
        >
          {showAddForm ? "Cancel" : "+ Add User"}
        </button>
      </div>

      {/* Add user form */}
      {showAddForm && (
        <div className="bg-bg-panel border border-border rounded-card p-4 mb-4">
          <h3 className="text-sm font-medium text-text-primary mb-3">New User</h3>
          {formError && (
            <div className="mb-3 p-2 bg-status-alert/10 border border-status-alert/20 rounded text-xs text-status-alert">
              {formError}
            </div>
          )}
          <form onSubmit={handleAddUser} className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-2xs text-text-muted mb-1">Full Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                className="w-full px-3 py-1.5 bg-bg-app border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                placeholder="John Smith"
              />
            </div>
            <div>
              <label className="block text-2xs text-text-muted mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
                className="w-full px-3 py-1.5 bg-bg-app border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                placeholder="user@school.edu"
              />
            </div>
            <div>
              <label className="block text-2xs text-text-muted mb-1">Password</label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                minLength={8}
                className="w-full px-3 py-1.5 bg-bg-app border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                placeholder="Min 8 characters"
              />
            </div>
            <div>
              <label className="block text-2xs text-text-muted mb-1">Role</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                required
                className="w-full px-3 py-1.5 bg-bg-app border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="">Select role</option>
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>
                    {formatRole(r)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded-md transition-colors disabled:opacity-50"
              >
                {submitting ? "Creating..." : "Create User"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users table */}
      <div className="bg-bg-panel border border-border rounded-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">Name</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">Email</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">Role</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">Status</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {[...Array(5)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="skeleton h-4 w-20" />
                      </td>
                    ))}
                  </tr>
                ))
              : users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-border last:border-0 hover:bg-bg-hover/30 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-text-primary">{user.name}</td>
                    <td className="px-4 py-3 text-xs text-text-muted font-mono">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-text-secondary">{formatRole(user.role)}</span>
                    </td>
                    <td className="px-4 py-3">
                      {user.active ? (
                        <span className="inline-flex items-center gap-1.5 text-2xs text-status-online">
                          <span className="w-1.5 h-1.5 rounded-full bg-status-online" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-2xs text-text-muted">
                          <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {user.id !== currentUserId && (
                        user.active ? (
                          <button
                            onClick={() => handleDeactivate(user.id)}
                            className="text-2xs text-status-alert hover:text-status-alert/80 transition-colors"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => handleReactivate(user.id)}
                            className="text-2xs text-status-online hover:text-status-online/80 transition-colors"
                          >
                            Reactivate
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>

        {!loading && users.length === 0 && (
          <div className="p-8 text-center text-text-muted text-sm">No users found</div>
        )}
      </div>
    </div>
  );
}
