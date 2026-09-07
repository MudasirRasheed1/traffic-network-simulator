import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import DocsPage from './components/DocsPage.jsx';
import LandingPage from './components/LandingPage.jsx';
import SavedSimulationsPage from './components/SavedSimulationsPage.jsx';
import ContactPage from './components/ContactPage.jsx';
import DemoPage from './components/DemoPage.jsx';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/simulator" element={<App />} />
        <Route path="/saved-simulations" element={<SavedSimulationsPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
