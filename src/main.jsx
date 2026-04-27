import { Buffer } from 'buffer';
window.Buffer = window.Buffer || Buffer;
window.global = window.global || window;
window.process = window.process || { env: {} };

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);