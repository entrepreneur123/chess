import './styles/tokens.css';
import './styles/app.css';
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

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__router = router;
}
