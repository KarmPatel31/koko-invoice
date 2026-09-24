import { createServer } from 'vite';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { readFile, writeFile } from 'node:fs/promises';
const server = await createServer({ server: { middlewareMode: true, ws: false, hmr: false, watch: null }, appType: 'custom' });
try {
  const { default: LandingPage } = await server.ssrLoadModule('/src/components/LandingPage.jsx');
  const html = await readFile('dist/index.html', 'utf8');
  await writeFile('dist/index.html', html.replace('<div id="root"></div>', `<div id="root">${renderToString(React.createElement(LandingPage))}</div>`));
  console.log('Public landing page prerendered for search engines and no-JavaScript visitors.');
} finally { await server.close(); }
