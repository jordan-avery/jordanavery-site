import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { isAuthenticated } from './api.js';
import AccessGate from './components/AccessGate.jsx';
import Dashboard from './components/Dashboard.jsx';
import Demo from './components/Demo.jsx';
import UploadWizard from './components/UploadWizard.jsx';

function RequireAuth({ children }) {
  return isAuthenticated() ? children : <Navigate to="/access" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<Demo />} />
        <Route path="/access"    element={<AccessGate />} />
        <Route path="/upload"    element={<RequireAuth><UploadWizard /></RequireAuth>} />
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="*"          element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
