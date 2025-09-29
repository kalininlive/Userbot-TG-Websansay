/**
 * PM2 ecosystem configuration for the tgapi service.
 * Keep this in sync with install_tgapi.sh so automated installs ship the same setup.
 */
module.exports = {
  apps: [
    {
      name: 'tgapi',
      cwd: '/opt/tgapi',
      script: 'src/server.js',
      env: {
        NODE_ENV: 'development',
        PORT: '3000',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
    },
  ],
};
