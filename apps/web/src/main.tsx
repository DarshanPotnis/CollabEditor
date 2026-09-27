import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';

const container = document.getElementById('root');

async function bootstrap(): Promise<void> {
  if (!container) throw new Error('index.html is missing its #root element');

  // Imported after the container check so a configuration error (which throws
  // at module scope) can be shown in the page rather than only in the console.
  const { App } = await import('./app/App.js');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown start-up error';
  if (container) {
    container.textContent = message;
    container.className = 'flex h-full items-center justify-center p-6 text-center text-red-300';
  }
});
