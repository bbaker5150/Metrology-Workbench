import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import './index.css';
// Side-effect import: configures the global axios singleton (retry/backoff)
// once at boot for every module.
import './shared/apiClient';
import { ThemeProvider } from './shared/ThemeContext';
import { NotificationProvider } from './shared/NotificationContext';
import ZoomToast from './shared/ZoomToast';
import { router } from './app/routes';

// Apply the persisted theme to <body> before first paint. The AC-Shunt
// module's ThemeProvider also does this once it mounts, but the workbench
// launcher renders outside that provider, so we set the body class here so
// the launcher (and any future module) is themed from the very first frame.
const initialTheme = (() => {
  try {
    return localStorage.getItem('theme') || 'light';
  } catch (_) {
    return 'light';
  }
})();
document.body.classList.add(`${initialTheme}-mode`);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <NotificationProvider>
        <RouterProvider router={router} />
        <ZoomToast />
      </NotificationProvider>
    </ThemeProvider>
  </React.StrictMode>
);
