import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import App from './App';
import LiveApp from './LiveApp';
import './styles.css';
import './live.css';
import './motion.css';

const demo = new URLSearchParams(window.location.search).get('demo') === '1';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{demo ? <App /> : <LiveApp />}</React.StrictMode>,
);
