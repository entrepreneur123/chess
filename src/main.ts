import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/lobby.css';
import './styles/collection.css';
import './styles/formation.css';
import './styles/matchmaking.css';
import './styles/overlays.css';
import './styles/game.css';
import './styles/nav.css';
import { installAudio } from './audio/sfx';
import { APP_NAME } from './meta/economy';
import { getProfile } from './meta/profile';
import { createTabBar } from './ui/components/tabBar';
import { Router } from './ui/router';
import { collectionScreen } from './ui/screens/collection';
import { formationScreen } from './ui/screens/formation';
import { gameScreen } from './ui/screens/game';
import { lobbyScreen } from './ui/screens/lobby';
import { matchmakingScreen } from './ui/screens/matchmaking';

document.title = APP_NAME;

// Block long-press context menus and double-tap zoom on the app shell (WebView feel).
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

getProfile(); // load + sanitize persisted data early
// Create/resume the AudioContext on the first gesture (autoplay policy); without this the game stays silent.
installAudio();

const outlet = document.getElementById('app')!;
const router = new Router(outlet)
  .register('lobby', lobbyScreen)
  .register('formation', formationScreen)
  .register('collection', collectionScreen)
  .register('matchmaking', matchmakingScreen)
  .register('game', gameScreen);
router.useTabBar(createTabBar((name) => void router.switchTab(name)));

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
