// pm2-Beschreibung für die openGym-API auf dem Hetzner. Start: pm2 start /opt/opengym/ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "opengym-api",
      cwd: "/opt/opengym/api",
      script: "server.js",
      node_args: "--env-file=/opt/opengym/.env",
      env: { TZ: "Europe/Berlin", NODE_ENV: "production" },
      max_restarts: 20,
      restart_delay: 2000,
    },
  ],
};
