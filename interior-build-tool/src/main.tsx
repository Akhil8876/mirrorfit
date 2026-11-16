import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { saveNow } from './store';
import './styles.css';

window.addEventListener('beforeunload', saveNow);
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
