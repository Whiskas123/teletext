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
import { LanguageProvider } from './components/Room/LanguageProvider';
import { Landing } from './components/Room/Landing';
import { ModeratorLogin } from './components/Room/ModeratorLogin';
import { NotFound } from './components/Room/NotFound';
import { RoomViewer } from './components/Room/RoomViewer';
import { SoloEditor } from './components/Room/SoloEditor';
import { SoloViewer } from './components/Room/SoloViewer';
import { validateRoomId } from './domain/roomId';
import { useNoIndex } from './utils/useNoIndex';
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
 * Marks the screen inside it as one search engines should not list.
 *
 * A wrapper rather than a `useNoIndex()` call inside each of the three admin
 * screens, because being unlisted is a fact about the *route* — it is the same
 * decision `public/robots.txt` records for the same three paths, and keeping
 * both in one place means adding a fourth admin screen is two lines that sit
 * next to what they have to agree with, rather than a hook someone forgets.
 */
function NoIndex({ children }: { children: React.ReactNode }) {
  useNoIndex();
  return children;
}

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

/**
 * Every route the site has, mounted once per language by {@link App}.
 *
 * The paths here are *relative*, which is what lets one tree serve both: under
 * `/en/*` react-router resolves `about` to `/en/about`, and under `/*` to
 * `/about`. Writing them absolutely would need a second, parallel copy of this
 * list — and a route added to one and not the other is a page that exists in
 * Portuguese and 404s in English, which nothing would catch.
 */
function LanguageRoutes() {
  return (
    <Routes>
      {/* Landing: watch solo, watch together, or edit. */}
      <Route index element={<Landing />} />

      {/* Watching on your own — no chat, no vote, no name needed. The
          optional third segment is the subpage, so a link can point at one
          screen of a carousel rather than only at the page it starts on. */}
      <Route path="watch" element={<SoloViewer />} />
      <Route path="watch/:pageNumber" element={<SoloViewer />} />
      <Route path="watch/:pageNumber/:subpage" element={<SoloViewer />} />

      {/* Watch-only co-watching in a room (Req 3–5, 9). */}
      <Route
        path="room/:roomId"
        element={
          <RoomRoute>
            <RoomViewer />
          </RoomRoute>
        }
      />

      {/* Solo editing of the global teletext pages/titles. */}
      <Route path="edit" element={<SoloEditor />} />
      <Route path="edit/:pageNumber" element={<SoloEditor />} />
      <Route path="edit/:pageNumber/:subpage" element={<SoloEditor />} />

      {/* The prose: what this is, and why. Reached from "sobre". */}
      <Route path="about" element={<AboutPage />} />

      {/* The book of signatures: a name and eight rows of teletext. */}
      <Route path="guestbook" element={<GuestbookPage />} />

      {/* The three admin screens. Each is also named in `public/robots.txt`;
          see {@link NoIndex} for why it takes both to keep them unlisted. */}

      {/* Moderator sign-in (device-local; see collab/moderator.ts). */}
      <Route
        path="moderator"
        element={
          <NoIndex>
            <ModeratorLogin />
          </NoIndex>
        }
      />

      {/* Convert an archive render into a page (see domain/archiveImport.ts). */}
      <Route
        path="import"
        element={
          <NoIndex>
            <Suspense fallback={null}>
              <ImportArchivePage />
            </Suspense>
          </NoIndex>
        }
      />

      {/* Choose which archive captures are published to which page numbers. */}
      <Route
        path="manage"
        element={
          <NoIndex>
            <Suspense fallback={null}>
              <ManageArchivePage />
            </Suspense>
          </NoIndex>
        }
      />

      {/* Legacy redirects so old links don't 404. These are real routes that
          really moved, which is what makes redirecting them right — unlike
          the catch-all below, where there is nothing to redirect *to*. */}
      <Route path="view" element={<Navigate to="/" replace />} />
      <Route
        path="view/:pageNumber"
        element={<Navigate to="/" replace />}
      />

      {/* Anything else says so, rather than silently becoming the front
          page. See {@link NotFound}: as a redirect this was a soft 404, and
          every mistyped URL was indexed as a copy of `/`. */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      {/* One global playhtml document for the whole app (pages/titles are
          global; room coordination is keyed by Room_ID inside it). */}
      <GlobalProvider>
        {/*
          * One tree, mounted twice: English under `/en`, Portuguese bare.
          *
          * Portuguese keeps the unprefixed paths because the site is already
          * live and every link to it that exists, anywhere, is unprefixed —
          * giving it a `/pt` prefix would break all of them at once. The
          * English mount comes first because `/*` matches everything,
          * `/en/about` included, and would otherwise win.
          */}
        <Routes>
          <Route
            path="/en/*"
            element={
              <LanguageProvider language="en">
                <LanguageRoutes />
              </LanguageProvider>
            }
          />
          <Route
            path="/*"
            element={
              <LanguageProvider language="pt">
                <LanguageRoutes />
              </LanguageProvider>
            }
          />
        </Routes>
      </GlobalProvider>
      <Analytics />
    </BrowserRouter>
  );
}

export default App;
