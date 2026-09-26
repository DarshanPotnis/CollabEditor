import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary.js';
import { LandingPage } from '../features/landing/LandingPage.js';
import { WorkspacePage } from '../features/workspace/WorkspacePage.js';
import { NotFoundPage } from '../features/workspace/NotFoundPage.js';

/** Old /room/:id links keep working. */
function LegacyRoomRedirect(): React.ReactElement {
  const { roomId } = useParams();
  return <Navigate to={`/p/${roomId ?? ''}`} replace />;
}

export function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/p/:projectId" element={<WorkspacePage />} />
          <Route path="/room/:roomId" element={<LegacyRoomRedirect />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
