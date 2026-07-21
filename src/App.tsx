import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
} from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { GlobalProvider } from './collab/GlobalProvider';
import { RoomContext } from './collab/RoomContext';
import { Landing } from './components/Room/Landing';
import { RoomViewer } from './components/Room/RoomViewer';
import { SoloEditor } from './components/Room/SoloEditor';
import { validateRoomId } from './domain/roomId';
import './App.css';
import './styles/teletext.css';

/**
 * Guards the `:roomId` route param: validates the Room_ID *before* entering the
 * room (Req 1.4). An invalid Room_ID redirects back to the entry screen
 * (Req 1.5). On success it provides {@link RoomContext} so the room-scoped hooks
 * resolve the active Room_ID without prop-threading.
 */
function RoomRoute({ children }: { children: React.ReactNode }) {
  const { roomId } = useParams<{ roomId: string }>();

  if (roomId == null || !validateRoomId(roomId)) {
    return <Navigate to="/" replace />;
  }

  return <RoomContext value={roomId}>{children}</RoomContext>;
}

function App() {
  return (
    <BrowserRouter>
      {/* One global playhtml document for the whole app (pages/titles are
          global; room coordination is keyed by Room_ID inside it). */}
      <GlobalProvider>
        <Routes>
          {/* Landing: capture the member's name, then watch or edit. */}
          <Route path="/" element={<Landing />} />

          {/* Watch-only co-watching in a room (Req 3–5, 9). */}
          <Route
            path="/room/:roomId"
            element={
              <RoomRoute>
                <RoomViewer />
              </RoomRoute>
            }
          />

          {/* Solo editing of the global teletext pages/titles. */}
          <Route path="/edit" element={<SoloEditor />} />
          <Route path="/edit/:pageNumber" element={<SoloEditor />} />

          {/* Legacy redirects so old links don't 404. */}
          <Route path="/view" element={<Navigate to="/" replace />} />
          <Route
            path="/view/:pageNumber"
            element={<Navigate to="/" replace />}
          />

          {/* Anything else falls back to the entry screen. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </GlobalProvider>
      <Analytics />
    </BrowserRouter>
  );
}

export default App;
