import React from 'react';
import { createRoot } from 'react-dom/client';
import PopupApp from './PopupApp';
import '@/dashboard/globals.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <PopupApp />
    </React.StrictMode>
  );
}
