"use client";

import { useState, useEffect } from "react";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: string;
  school: { id: string; name: string } | null;
}

export default function OpsUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUsers() {
      try {
        const res = await fetch("/api/users");
        if (res.ok) {
          const data = await res.json();
          setUsers(data.users);
        }
      } catch {
        // keep empty
      } finally {
        setLoading(false);
      }
    }
    fetchUsers();
  }, []);

  const activeUsers = users.filter((u) => u.active).length;

  function formatRole(role: string) {
    return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function getRoleBadge(role: string) {
    if (role === "SUPER_ADMIN")
      return "bg-status-warning/10 text-status-warning border-status-warning/20";
    if (role === "OPS_VIEWER")
      return "bg-accent/10 text-accent border-accent/20";
    if (role === "SCHOOL_ADMIN")
      return "bg-status-online/10 text-status-online border-status-online/20";
    return "bg-bg-card text-text-muted border-border";
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-text-primary mb-4">
        All Users
        <span className="text-sm font-normal text-text-muted ml-2">
          {activeUsers} active of {users.length} total
        </span>
      </h1>

      <div className="bg-bg-panel border border-border rounded-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">Name</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">Email</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">Role</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">School</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {[...Array(5)].map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="skeleton h-4 w-20" /></td>
                    ))}
                  </tr>
                ))
              : users.map((user) => (
                  <tr key={user.id} className="border-b border-border last:border-0 hover:bg-bg-hover/30 transition-colors">
                    <td className="px-4 py-3 text-sm text-text-primary">{user.name}</td>
                    <td className="px-4 py-3 text-xs text-text-muted font-mono">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-2xs font-medium border ${getRoleBadge(user.role)}`}>
                        {formatRole(user.role)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {user.school?.name || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-2xs ${user.active ? "text-status-online" : "text-text-muted"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${user.active ? "bg-status-online" : "bg-text-muted"}`} />
                        {user.active ? "Active" : "Inactive"}
                      </span>
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
