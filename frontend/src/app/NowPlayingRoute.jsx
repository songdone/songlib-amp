import NowPlayingPage from "../features/now-playing/NowPlayingPage";
import { usePlayer } from "../features/player/PlayerProvider";

export function NowPlayingRoute({ navigate, playerSettings }) {
  const player = usePlayer();
  return (
    <NowPlayingPage
      player={player}
      navigate={navigate}
      playerSettings={playerSettings}
    />
  );
}
