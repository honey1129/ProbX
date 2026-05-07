const projectDir = process.env.PROBX_PROJECT_DIR || "/root/ProbX";
const frontendPort = process.env.PROBX_FRONTEND_PORT || "3001";

module.exports = {
  apps: [
    {
      name: "probx-api",
      cwd: `${projectDir}/backend`,
      script: "./probx-api",
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "probx-frontend",
      cwd: `${projectDir}/frontend`,
      script: "node_modules/next/dist/bin/next",
      args: `start -H 0.0.0.0 -p ${frontendPort}`,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
