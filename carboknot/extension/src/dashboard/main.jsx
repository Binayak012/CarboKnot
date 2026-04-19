import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { FallingLeaves } from './components/FallingLeaves.tsx';
import './globals.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <FallingLeaves />
    <App />
  </React.StrictMode>
);
