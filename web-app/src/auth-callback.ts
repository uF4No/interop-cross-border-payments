import { handleAuthCallback } from 'prividium';

handleAuthCallback((error) => {
  console.error('Auth callback error:', error);
  const errorElement = document.getElementById('error-message');
  const errorContainer = document.getElementById('error-container');

  if (errorElement && errorContainer && error) {
    errorElement.textContent = error;
    errorContainer.style.display = 'block';
  }
});
