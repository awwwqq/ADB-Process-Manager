// Apply the saved theme before the document paints.
try { document.documentElement.dataset.theme = localStorage.getItem('phone-task-manager-theme') === 'light' ? 'light' : 'dark'; }
catch { document.documentElement.dataset.theme = 'dark'; }
