import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import SharedReplay from './SharedReplay.svelte';
import { installDesktopLinkHandler } from './mvp/desktop.js';
import { FLAGS } from './mvp/flags.js';

// Desktop only: route external link clicks (Wowhead, etc.) to the system browser — a webview drops
// plain target="_blank" anchors. No-op on the web. Installed for BOTH roots below.
installDesktopLinkHandler();

// Tiny path-split router (no router dep). The MVP analyzer lives at `/`; a PUBLIC shared replay at
// `/r/<code>` (anyone with the link, no sign-in) for full app builds. The hosted web app is bounded to
// the analyzer shell, so share/comment links are not mounted there.
// (Static-host deploys need an index.html fallback for `/r/...`; the CloudFront SPA config serves
// index.html for unknown routes.)
const path = window.location.pathname.replace(/\/+$/, '');

const shareMatch = FLAGS.demo ? null : path.match(/\/r\/([A-Za-z0-9_-]+)$/);
const target = document.getElementById('root')!;

const app = shareMatch
  ? mount(SharedReplay, { target, props: { code: shareMatch[1]! } })
  : mount(App, { target });

export default app;
