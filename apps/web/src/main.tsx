import 'maplibre-gl/dist/maplibre-gl.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import './ui/tokens.css';
import './ui/app.css';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { LegalPage } from './legal/LegalPage';
import { legalPageForPath } from './legal/legalPages';

const legalPage = legalPageForPath(window.location.pathname);
const root = createRoot(document.getElementById('root')!);

if (legalPage) {
  root.render(
    <StrictMode>
      <LegalPage page={legalPage} />
    </StrictMode>,
  );
} else {
  void import('./ui/App').then(({ App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
