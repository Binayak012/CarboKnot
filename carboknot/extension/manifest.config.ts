import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Carboknot',
  description:
    'Zero-trust carbon footprint for every purchase. On-device LCA math, interpretability by default.',
  version: pkg.version,
  action: {
    default_popup: 'src/popup/popup.html',
    default_title: 'Carboknot'
  },
  permissions: ['storage', 'alarms'],
  host_permissions: [
    'https://www.amazon.com/*',
    'https://www.ebay.com/*',
    // Dedalus swarm status + K2 Think reasoning proxy. Keep in sync with
    // PROXY_ORIGIN in src/background/service-worker.js. Add the Render URL
    // here once the proxy is deployed.
    'http://localhost:8787/*'
  ],
  background: {
    service_worker: 'src/background/service-worker.js',
    type: 'module'
  },
  content_scripts: [
    {
      matches: ['https://www.amazon.com/*'],
      js: ['src/content/amazon.js'],
      css: ['src/content/badge.css'],
      run_at: 'document_idle'
    },
    {
      matches: ['https://www.ebay.com/*'],
      js: ['src/content/ebay.js'],
      css: ['src/content/badge.css'],
      run_at: 'document_idle'
    }
  ],
  web_accessible_resources: [
    {
      resources: ['src/dashboard/index.html', 'assets/*'],
      matches: ['<all_urls>']
    }
  ]
});
