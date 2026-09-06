// Assets and API share the page mount point, including /mp3maker/.
window.BASE_PATH = new URL('.', document.currentScript.src).pathname.replace(/\/$/, '');
