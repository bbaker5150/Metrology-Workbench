// ---------------------------------------------------------------------------
// Standalone SharePoint entry point.
// ---------------------------------------------------------------------------
// Boots the uncertainty module as a self-contained page hosted inside a
// SharePoint site, with no workbench shell, no router, and no Django backend.
//
// The module tree itself is untouched: `App.jsx` and everything under it is the
// same code the Electron/Django build runs. The only substitution happens at
// the network boundary, where an axios adapter serves the module's REST calls
// from SharePoint lists instead.

import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';

import '../index.css';
import { ThemeProvider } from '../shared/ThemeContext';
import { NotificationProvider } from '../shared/NotificationContext';
import ZoomToast from '../shared/ZoomToast';
import { UncertaintyProvider } from '../modules/uncertainty/contexts/UncertaintyContext';
import UncertalyticsApp from '../modules/uncertainty/App';
import '../modules/uncertainty/UncertaintyApp.css';
import { UNCERTAINTY_API } from '../modules/uncertainty/constants/constants';

import { SharePointStore, DEFAULT_PREFIX } from './sharepoint/spStore';
import { resolveWebUrl } from './sharepoint/spContext';
import { createSharePointAdapter } from './sharepoint/axiosSharePointAdapter';
import StorageGate from './StorageGate';
import installFormSubmitShim from './formSubmitShim';
import './standalone.css';

// The hosting page can override these without a rebuild, which matters because
// the deployed artifact is a static file in a document library:
//   <script>window.UNCERTAINTY_CONFIG = { listPrefix: 'LabB' }</script>
const config = (typeof window !== 'undefined' && window.UNCERTAINTY_CONFIG) || {};
const webUrl = config.webUrl || resolveWebUrl();
const prefix = config.listPrefix || DEFAULT_PREFIX;

const store = new SharePointStore({ webUrl, prefix });

// Install the adapter before anything renders, so the module's very first
// request on mount already goes to SharePoint.
const defaultAdapter = axios.defaults.adapter;
axios.defaults.adapter = createSharePointAdapter({
  store,
  apiRoot: UNCERTAINTY_API,
  fallback: defaultAdapter,
});

// The module's design tokens are scoped to `.uncertainty-active` on <body>,
// because in the workbench they have to reach modals that portal outside the
// module subtree. Nothing unmounts this build, so it is set once.
const initialTheme = (() => {
  try {
    return localStorage.getItem('theme') || 'light';
  } catch {
    return 'light';
  }
})();
document.body.classList.add(`${initialTheme}-mode`, 'uncertainty-active');

// Covers the forms inside bundled dependencies; ours do not use submission.
installFormSubmitShim();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <NotificationProvider>
        <StorageGate store={store}>
          <UncertaintyProvider>
            <UncertalyticsApp />
          </UncertaintyProvider>
        </StorageGate>
        <ZoomToast />
      </NotificationProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
