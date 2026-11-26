import { initializeForm, processForm } from './js/formHandler';
import './styles/main.scss';

initializeForm(document);

if ('serviceWorker' in navigator) {
  window.addEventListener(
    'load',
    () => {
      void navigator.serviceWorker.register('/service-worker.js').catch(() => {
        document.querySelector('#offline-status').textContent =
          'Offline setup unavailable.';
      });
    },
    { once: true },
  );
}

export { processForm };
