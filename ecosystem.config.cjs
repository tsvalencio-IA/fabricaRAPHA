module.exports = {
  apps: [
    {
      name: 'smartsat-gps',
      script: 'server.js',
      cwd: '/opt/smartsat-gps',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'production',
        PORT: '3000'
      }
    }
  ]
};
