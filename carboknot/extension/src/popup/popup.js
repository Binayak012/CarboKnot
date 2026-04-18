document.getElementById('open-dashboard').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'open_dashboard' });
  window.close();
});
