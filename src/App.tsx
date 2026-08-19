import { lazy, Suspense } from 'react';
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
import { AboutPage } from './components/Room/AboutPage';
import { GuestbookPage } from './components/Room/GuestbookPage';
import { Landing } from './components/Room/Landing';
import { ModeratorLogin } from './components/Room/ModeratorLogin';
import { RoomViewer } from './components/Room/RoomViewer';
import { SoloEditor } from './components/Room/SoloEditor';
import { SoloViewer } from './components/Room/SoloViewer';
import { validateRoomId } from './domain/roomId';
import './App.css';
import './styles/teletext.css';
// After `teletext.css`, because the exhibition screen unframes the same
// `.teletext-screen` the CRT does and has to win the same way `.crt-raster`
// does. It touches nothing else: every rule in it is under `.exhibit`.
import './styles/exhibit.css';
// Last, so the editor console's own surface wins over the shared editor
// layout it borrows from `teletext.css`. See the note at the top of the file.
import './styles/console.css';

// Lazy: carries the glyph atlas, which only this rarely-visited admin page
// needs — no reason to put it in the bundle every visitor downloads.
const ImportArchivePage = lazy(() => import('./components/Room/ImportArchivePage'));

// Lazy for the same reason: an admin-only screen no visitor ever opens.
const ManageArchivePage = lazy(() => import('./components/Room/ManageArchivePage'));

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
          {/* Landing: watch solo, watch together, or edit. */}
          <Route path="/" element={<Landing />} />

          {/* Watching on your own — no chat, no vote, no name needed. The
              optional third segment is the subpage, so a link can point at one
              screen of a carousel rather than only at the page it starts on. */}
          <Route path="/watch" element={<SoloViewer />} />
          <Route path="/watch/:pageNumber" element={<SoloViewer />} />
          <Route path="/watch/:pageNumber/:subpage" element={<SoloViewer />} />

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
          <Route path="/edit/:pageNumber/:subpage" element={<SoloEditor />} />

          {/* The prose: what this is, and why. Reached from "sobre". */}
          <Route path="/about" element={<AboutPage />} />

          {/* The book of signatures: a name and eight rows of teletext. */}
          <Route path="/guestbook" element={<GuestbookPage />} />

          {/* Moderator sign-in (device-local; see collab/moderator.ts). */}
          <Route path="/moderator" element={<ModeratorLogin />} />

          {/* Convert an archive render into a page (see domain/archiveImport.ts). */}
          <Route
            path="/import"
            element={
              <Suspense fallback={null}>
                <ImportArchivePage />
              </Suspense>
            }
          />

          {/* Choose which archive captures are published to which page numbers. */}
          <Route
            path="/manage"
            element={
              <Suspense fallback={null}>
                <ManageArchivePage />
              </Suspense>
            }
          />

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
