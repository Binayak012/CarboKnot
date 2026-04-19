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
    default_title: 'Carboknot',
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png'
    }
  },
  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png'
  },
  permissions: ['storage', 'alarms'],
  host_permissions: [
    'https://www.amazon.com/*',
    'https://www.ebay.com/*',
    'https://generativelanguage.googleapis.com/*',
    'http://localhost:8787/*'
  ],
  background: {
    service_worker: 'src/background/service-worker.js',
    type: 'module'
  },
  content_scripts: [
    {
      // Retail footprint the dispatcher runs on. Kept alphabetical per
      // group so diffs are scannable. Every host here either has a
      // dedicated adapter in src/content/adapters/ or falls back to the
      // generic schema.org/OpenGraph extractor. We deliberately avoid
      // <all_urls> to keep the Chrome Web Store reviewer happy and the
      // user-visible permission blurb tight.
      matches: [
        'https://*.adidas.com/*',
        'https://*.apple.com/*',
        'https://*.backmarket.com/*',
        'https://*.bhphotovideo.com/*',
        'https://*.costco.com/*',
        'https://*.homedepot.com/*',
        'https://*.kohls.com/*',
        'https://*.lowes.com/*',
        'https://*.macys.com/*',
        'https://*.myshopify.com/*',
        'https://*.nike.com/*',
        'https://*.nordstrom.com/*',
        'https://*.rei.com/*',
        'https://*.sephora.com/*',
        'https://*.wayfair.com/*',
        'https://www.amazon.com/*',
        'https://www.bestbuy.com/*',
        'https://www.ebay.com/*',
        'https://www.etsy.com/*',
        'https://www.target.com/*',
        'https://www.walmart.com/*'
      ],
      js: ['src/content/dispatcher.js'],
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
