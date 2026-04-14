// ─── PM2 Ecosystem Configuration — School Agent ─────────────────────────────
// Deploy this file on each school's agent machine.
//
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup       — auto-start on reboot
//   pm2 logs school-agent         — view agent logs
//   pm2 restart school-agent      — restart the agent
// ────────────────────────────────────────────────────────────────────────────

module.exports = {
  apps: [
    {
      name: "school-agent",
      script: "npx",
      args: "tsx index.ts",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/agent-error.log",
      out_file: "./logs/agent-out.log",
      merge_logs: true,
      restart_delay: 5000,
      max_restarts: 15,
      min_uptime: "10s",
    },
  ],
};
