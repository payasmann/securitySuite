// ─── PM2 Ecosystem Configuration ────────────────────────────────────────────
// Usage:
//   pm2 start ecosystem.config.js            — start all processes
//   pm2 start ecosystem.config.js --only cloud-dashboard
//   pm2 start ecosystem.config.js --only school-agent
//   pm2 restart all                           — restart all
//   pm2 logs                                  — view all logs
//   pm2 monit                                 — real-time monitor
//
// First-time setup:
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup                               — auto-start on reboot
// ────────────────────────────────────────────────────────────────────────────

module.exports = {
  apps: [
    // ─── Cloud Dashboard (Company Server) ─────────────────
    {
      name: "cloud-dashboard",
      script: "npx",
      args: "tsx server.ts",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "1G",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/cloud-error.log",
      out_file: "./logs/cloud-out.log",
      merge_logs: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "10s",
      // Health check — PM2 will restart if this URL returns non-200
      // Requires: pm2 install pm2-health (optional)
    },

    // ─── On-Premises Agent (School Server) ─────────────────
    // Uncomment and configure this on school agent machines.
    // This section is here as a reference — the agent runs on
    // a different machine than the cloud dashboard.
    //
    // {
    //   name: "school-agent",
    //   script: "npx",
    //   args: "tsx index.ts",
    //   cwd: __dirname + "/agent",
    //   env: {
    //     NODE_ENV: "production",
    //   },
    //   instances: 1,
    //   exec_mode: "fork",
    //   max_memory_restart: "512M",
    //   log_date_format: "YYYY-MM-DD HH:mm:ss",
    //   error_file: "./logs/agent-error.log",
    //   out_file: "./logs/agent-out.log",
    //   merge_logs: true,
    //   restart_delay: 5000,
    //   max_restarts: 15,
    //   min_uptime: "10s",
    // },
  ],
};
