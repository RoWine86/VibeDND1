import { Routes, Route } from 'react-router-dom';
import Lobby from './pages/Lobby';
import DmPage from './pages/DmPage';
import BoardPage from './pages/BoardPage';
import PlayerPage from './pages/PlayerPage';
import CharacterLibrary from './pages/CharacterLibrary';
import CharacterEdit from './pages/CharacterEdit';
import CharacterNew from './pages/CharacterNew';
import AdventureLibrary from './pages/AdventureLibrary';
import AdventureEdit from './pages/AdventureEdit';
import SessionPage from './pages/SessionPage';
import EntityLibrary from './pages/EntityLibrary';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Lobby />} />
      <Route path="/dm" element={<DmPage />} />
      <Route path="/board/:sessionId" element={<BoardPage />} />
      <Route path="/player/:sessionId/:characterId?" element={<PlayerPage />} />
      <Route path="/characters" element={<CharacterLibrary />} />
      <Route path="/characters/new" element={<CharacterNew />} />
      <Route path="/characters/:id/edit" element={<CharacterEdit />} />
      <Route path="/adventures" element={<AdventureLibrary />} />
      <Route path="/adventures/:id/edit" element={<AdventureEdit />} />
      <Route path="/entities/:kind" element={<EntityLibrary />} />
      <Route path="/session/:id" element={<SessionPage />} />
    </Routes>
  );
}
