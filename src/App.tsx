import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { TeletextProvider } from './context/TeletextContext';
import { PageGrid } from './components/PageGrid/PageGrid';
import { ViewerPage } from './components/ViewerPage';
import { EditorPage } from './components/EditorPage';
import './App.css';
import './styles/teletext.css';

function RedirectViewByNumber() {
  const { pageNumber } = useParams<{ pageNumber: string }>();
  const num = pageNumber != null ? parseInt(pageNumber, 10) : NaN;
  const valid = Number.isInteger(num) && num >= 100 && num <= 900;
  const rounded = Math.round(num / 100) * 100;
  return valid ? <Navigate to={`/view?page=${rounded}`} replace /> : <Navigate to="/" replace />;
}

function App() {
  return (
    <TeletextProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PageGrid />} />
          <Route path="/view" element={<ViewerPage />} />
          <Route path="/view/:pageNumber" element={<RedirectViewByNumber />} />
          <Route path="/edit/:pageNumber" element={<EditorPage />} />
        </Routes>
      </BrowserRouter>
    </TeletextProvider>
  );
}

export default App;
