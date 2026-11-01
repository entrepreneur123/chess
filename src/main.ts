import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import './styles/tokens.css';
import './styles/app.css';
import './styles/ux.css';
import './styles/skin.css';
import { APP_NAME } from './meta/economy';
import { getProfile } from './meta/profile';
import { Router } from './ui/router';
import { collectionScreen } from './ui/screens/collection';
import { formationScreen } from './ui/screens/formation';
import { gameScreen } from './ui/screens/game';
import { lobbyScreen } from './ui/screens/lobby';
import { matchmakingScreen } from './ui/screens/matchmaking';
import { shopScreen } from './ui/screens/shop';

document.title = APP_NAME;

// Block long-press context menus and double-tap zoom on the app shell (WebView feel).
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

getProfile(); // load + sanitize persisted data early

const outlet = document.getElementById('app')!;
const router = new Router(outlet)
  .register('lobby', lobbyScreen)
  .register('formation', formationScreen)
  .register('collection', collectionScreen)
  .register('shop', shopScreen)
  .register('matchmaking', matchmakingScreen)
  .register('game', gameScreen);

router.home();

// Android hardware back. Capacitor core has no back handling (the activity would just finish),
// so route it through the WebView history, which the Router intercepts via popstate (resign
// confirm, closing dialogs, ...). At the root there is no history left: exit the app.
if (Capacitor.isNativePlatform()) {
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) history.back();
    else void App.exitApp();
  });
}

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__router = router;
}
